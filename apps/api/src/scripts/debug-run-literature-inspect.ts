import "dotenv/config";

import {
  CircleWalletClient,
  buildGatewayTypedData,
  createBuyerPaymentPlan,
  readGatewayChallenge
} from "@biomed/payments";

async function main() {
  const apiUrl = (process.env.API_URL || "http://localhost:3002").replace(/\/$/, "");
  const initial = await fetch(`${apiUrl}/api/paid/literature/search`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ query: "glioblastoma EGFR resistance" })
  });

  const challenge = await readGatewayChallenge(initial);
  const plan = createBuyerPaymentPlan("literature");
  const circle = CircleWalletClient.fromEnv();
  const buyerAddress =
    plan.buyerAddress ??
    (plan.buyerWalletId ? (await circle.getWallet(plan.buyerWalletId)).address : null);
  const typedData = buildGatewayTypedData({
    challenge,
    buyerAddress: buyerAddress ?? "0x0000000000000000000000000000000000000000"
  });

  console.log(
    JSON.stringify(
      {
        status: initial.status,
        challenge,
        plan,
        buyerAddress,
        typedData
      },
      null,
      2
    )
  );
}

void main();
