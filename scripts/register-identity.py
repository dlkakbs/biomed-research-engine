"""
Register current BioMed Research wallets in Arc Identity Registry.

This script is intentionally standalone so the public repo keeps identity
registration in the current scripts directory.
"""

import base64
import json
import os
import time
import uuid
from pathlib import Path

import requests
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from dotenv import load_dotenv
from web3 import Web3

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

API_KEY = os.getenv("CIRCLE_API_KEY", "").strip()
ENTITY_SECRET = os.getenv("CIRCLE_ENTITY_SECRET", "").strip()
BASE_URL = os.getenv("CIRCLE_BASE_URL", "https://api.circle.com/v1/w3s").rstrip("/")
RPC_URL = os.getenv("RPC_URL", os.getenv("ARC_TESTNET_RPC_URL", "https://rpc.testnet.arc.network"))
IDENTITY_REGISTRY = os.getenv("ARC_IDENTITY_REGISTRY", "0x8004A818BFB912233c491871b3d84c89A494BD9e")

_circle_public_key_cache: str | None = None

WALLETS_TO_REGISTER = [
    {
        "label": "PI Agent",
        "wallet_id": os.getenv("PI_AGENT_WALLET_ID", "").strip(),
        "address": os.getenv("PI_AGENT_ADDRESS", "").strip(),
        "role": "provider",
        "name": "BioMed PI Agent",
        "description": "Pipeline orchestrator for biomedical research",
    },
    {
        "label": "Finalizer",
        "wallet_id": os.getenv("FINALIZER_WALLET_ID", "").strip(),
        "address": os.getenv("FINALIZER_ADDRESS", "").strip(),
        "role": "finalizer",
        "name": "BioMed Finalizer Agent",
        "description": "On-chain adjudicator that executes complete or reject on ERC-8183",
    },
    {
        "label": "Review Seller",
        "wallet_id": os.getenv("REVIEW_SELLER_WALLET_ID", "").strip(),
        "address": (os.getenv("REVIEW_PAYMENT_ADDRESS", "") or os.getenv("REVIEW_SELLER_ADDRESS", "")).strip(),
        "role": "review",
        "name": "BioMed Review Seller",
        "description": "Paid peer-review service for final research evaluation",
    },
    {
        "label": "Critics Seller",
        "wallet_id": (os.getenv("RED_TEAM_SELLER_WALLET_ID", "") or os.getenv("RED_TEAM_AGENT_WALLET_ID", "")).strip(),
        "address": (
            os.getenv("RED_TEAM_PAYMENT_ADDRESS", "")
            or os.getenv("RED_TEAM_SELLER_ADDRESS", "")
            or os.getenv("RED_TEAM_AGENT_ADDRESS", "")
        ).strip(),
        "role": "critics",
        "name": "BioMed Critics Seller",
        "description": "Paid critical review service with adversarial counter-arguments",
    },
]


def _headers() -> dict[str, str]:
    if not API_KEY:
        raise ValueError("CIRCLE_API_KEY is not set")
    return {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }


def _idempotency_key() -> str:
    return str(uuid.uuid4())


def _fetch_circle_public_key() -> str:
    response = requests.get(
        f"{BASE_URL}/config/entity/publicKey",
        headers=_headers(),
        timeout=30,
    )
    response.raise_for_status()
    return response.json()["data"]["publicKey"]


def _entity_secret_ciphertext() -> str:
    global _circle_public_key_cache
    if not ENTITY_SECRET:
        raise ValueError("CIRCLE_ENTITY_SECRET is not set")
    if _circle_public_key_cache is None:
        _circle_public_key_cache = _fetch_circle_public_key()

    pub_key = serialization.load_pem_public_key(_circle_public_key_cache.encode())
    plaintext = bytes.fromhex(ENTITY_SECRET)
    ciphertext = pub_key.encrypt(
        plaintext,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )
    return base64.b64encode(ciphertext).decode()


def _post(path: str, body: dict) -> dict:
    response = requests.post(
        f"{BASE_URL}{path}",
        headers=_headers(),
        json=body,
        timeout=30,
    )
    if not response.ok:
        raise RuntimeError(f"Circle API {response.status_code}: {response.text}")
    return response.json()


def _get(path: str) -> dict:
    response = requests.get(
        f"{BASE_URL}{path}",
        headers=_headers(),
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


def execute_contract_and_wait(
    *,
    wallet_id: str,
    contract_address: str,
    abi_function_signature: str,
    abi_parameters: list[str],
    ref_id: str,
    timeout: int = 240,
    poll_interval: int = 4,
) -> dict:
    payload = {
        "idempotencyKey": _idempotency_key(),
        "entitySecretCiphertext": _entity_secret_ciphertext(),
        "walletId": wallet_id,
        "contractAddress": Web3.to_checksum_address(contract_address),
        "abiFunctionSignature": abi_function_signature,
        "abiParameters": abi_parameters,
        "feeLevel": "MEDIUM",
        "refId": ref_id,
    }
    data = _post("/developer/transactions/contractExecution", payload).get("data", {})
    transaction_id = data.get("id") or data.get("transaction", {}).get("id")
    if not transaction_id:
        raise RuntimeError(f"Missing Circle transaction id: {data}")

    deadline = time.time() + timeout
    while time.time() < deadline:
        tx = _get(f"/transactions/{transaction_id}").get("data", {}).get("transaction", {})
        state = str(tx.get("state", "")).upper()
        if state in {"COMPLETE", "FAILED", "DENIED", "CANCELLED"}:
            return tx
        time.sleep(poll_interval)

    raise TimeoutError(f"Circle transaction {transaction_id} timed out")


def build_agent_uri(address: str, name: str, description: str, role: str) -> str:
    payload = {
        "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
        "name": name,
        "description": description,
        "image": "",
        "services": [
            {
                "name": "biomed-research",
                "description": description,
                "credentials": [{"type": "evmAddress", "value": address}],
                "capabilities": [role],
                "endpoint": {"uri": "https://biomed-research.local"},
            }
        ],
        "supportedTrust": ["identity", "reputation", "validation"],
        "project": "biomed-research",
        "role": role,
        "version": "1.0.0",
    }
    body = json.dumps(payload, ensure_ascii=True).encode()
    return f"data:application/json;base64,{base64.b64encode(body).decode()}"


def main() -> None:
    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    print(f"Identity Registry: {IDENTITY_REGISTRY}")
    print(f"Arc gas price: {w3.eth.gas_price} wei\n")

    any_failed = False
    for wallet in WALLETS_TO_REGISTER:
        wallet_id = wallet["wallet_id"]
        address = wallet["address"]
        if not wallet_id or not address:
            print(f"  SKIP {wallet['label']} — wallet id or address missing")
            continue

        agent_uri = build_agent_uri(
            address=address,
            name=wallet["name"],
            description=wallet["description"],
            role=wallet["role"],
        )
        print(f"  Registering {wallet['label']} ({address[:10]}...) via Circle DCW...")
        try:
            tx = execute_contract_and_wait(
                wallet_id=wallet_id,
                contract_address=IDENTITY_REGISTRY,
                abi_function_signature="register(string)",
                abi_parameters=[agent_uri],
                ref_id=f"reg-{wallet['role']}-{wallet_id[:8]}",
            )
            state = tx.get("state", "")
            tx_hash = tx.get("txHash") or tx.get("transactionHash", "")
            if state == "COMPLETE":
                print(f"    OK — state={state} tx={tx_hash}")
            else:
                print(f"    FAILED — state={state} error={tx.get('errorReason') or tx.get('errorMessage') or tx}")
                any_failed = True
        except Exception as exc:
            print(f"    ERROR — {exc}")
            any_failed = True

    if any_failed:
        raise SystemExit(1)

    print("\nDone.")


if __name__ == "__main__":
    main()
