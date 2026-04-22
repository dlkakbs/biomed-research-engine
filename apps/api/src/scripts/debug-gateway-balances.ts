import "dotenv/config";

import { CircleWalletClient } from "@biomed/payments";

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

async function main() {
  const circle = CircleWalletClient.fromEnv();
  const buyers: BuyerKey[] = ["pi", "literature", "drugdb"];
  const wallets = await Promise.all(
    buyers.map(async (key) => ({
      key,
      wallet: await circle.getWallet(resolveWalletId(key))
    }))
  );

  const response = await fetch("https://gateway-api-testnet.circle.com/v1/balances", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      token: "USDC",
      sources: wallets.map(({ wallet }) => ({
        domain: 26,
        depositor: wallet.address
      }))
    })
  });

  if (!response.ok) {
    throw new Error(`Gateway balances failed: ${response.status} ${await response.text()}`);
  }

  const payload = (await response.json()) as {
    token: string;
    balances: Array<{
      domain: number;
      depositor: string;
      balance: string;
    }>;
  };

  console.log(
    JSON.stringify(
      {
        token: payload.token,
        balances: wallets.map(({ key, wallet }) => ({
          key,
          walletId: wallet.id,
          address: wallet.address,
          gatewayBalance:
            payload.balances.find((item) => item.depositor.toLowerCase() === wallet.address.toLowerCase())
              ?.balance ?? "0.000000"
        }))
      },
      null,
      2
    )
  );
}

void main();
