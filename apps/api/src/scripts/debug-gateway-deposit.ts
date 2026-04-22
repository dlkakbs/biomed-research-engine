import "dotenv/config";

import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { CircleWalletClient } from "@biomed/payments";
import { ARC_ERC20_USDC, ARC_GATEWAY_WALLET } from "@biomed/shared";

type BuyerKey = "pi" | "literature" | "drugdb";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function resolveWalletId(key: BuyerKey): string {
  const envName =
    key === "pi"
      ? "PI_AGENT_WALLET_ID"
      : key === "literature"
        ? "LITERATURE_AGENT_WALLET_ID"
        : "DRUGDB_AGENT_WALLET_ID";
  return requireEnv(envName);
}

function parseToBaseUnits(value: string): string {
  const [whole, decimal = ""] = value.split(".");
  return (whole || "0") + (decimal + "000000").slice(0, 6);
}

async function waitForTxCompletion(
  client: ReturnType<typeof initiateDeveloperControlledWalletsClient>,
  txId: string,
  label: string
) {
  const terminalStates = new Set(["COMPLETE", "CONFIRMED", "FAILED", "DENIED", "CANCELLED"]);

  while (true) {
    const { data } = await client.getTransaction({ id: txId });
    const state = data?.transaction?.state;

    if (state && terminalStates.has(state)) {
      if (state !== "COMPLETE" && state !== "CONFIRMED") {
        throw new Error(`${label} did not complete (state=${state})`);
      }
      return data.transaction;
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

async function main() {
  const buyerKey = (process.env.DEBUG_BUYER_KEY?.trim() as BuyerKey | undefined) ?? "pi";
  const depositAmount = process.env.DEBUG_DEPOSIT_AMOUNT_USDC?.trim() || "2";

  const apiKey = requireEnv("CIRCLE_API_KEY");
  const entitySecret = requireEnv("CIRCLE_ENTITY_SECRET");

  const circle = CircleWalletClient.fromEnv();
  const wallet = await circle.getWallet(resolveWalletId(buyerKey));

  const client = initiateDeveloperControlledWalletsClient({
    apiKey,
    entitySecret
  });

  const amount = parseToBaseUnits(depositAmount);

  console.log(
    JSON.stringify(
      {
        buyerKey,
        walletId: wallet.id,
        walletAddress: wallet.address,
        depositAmountUsdc: depositAmount,
        gatewayWallet: ARC_GATEWAY_WALLET,
        usdc: ARC_ERC20_USDC.address
      },
      null,
      2
    )
  );

  const approveTx = await client.createContractExecutionTransaction({
    walletAddress: wallet.address,
    blockchain: "ARC-TESTNET",
    contractAddress: ARC_ERC20_USDC.address,
    abiFunctionSignature: "approve(address,uint256)",
    abiParameters: [ARC_GATEWAY_WALLET, amount],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } }
  });

  const approveTxId = approveTx.data?.id;
  if (!approveTxId) throw new Error("Failed to create approve transaction");
  await waitForTxCompletion(client, approveTxId, "USDC approve");

  const depositTx = await client.createContractExecutionTransaction({
    walletAddress: wallet.address,
    blockchain: "ARC-TESTNET",
    contractAddress: ARC_GATEWAY_WALLET,
    abiFunctionSignature: "deposit(address,uint256)",
    abiParameters: [ARC_ERC20_USDC.address, amount],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } }
  });

  const depositTxId = depositTx.data?.id;
  if (!depositTxId) throw new Error("Failed to create deposit transaction");
  const transaction = await waitForTxCompletion(client, depositTxId, "Gateway deposit");

  console.log(JSON.stringify({ approveTxId, depositTxId, transaction }, null, 2));
}

void main();
