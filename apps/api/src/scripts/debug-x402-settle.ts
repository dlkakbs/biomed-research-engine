const API_URL = (process.env.API_URL || "http://localhost:3001").replace(/\/$/, "");

const body = {
  paymentPayload: {
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: "eip155:5042002",
      asset: "0x3600000000000000000000000000000000000000",
      amount: "2000",
      payTo: "0x0000000000000000000000000000000000000001",
      maxTimeoutSeconds: 345600,
      extra: {
        name: "GatewayWalletBatched",
        version: "1",
        verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9"
      }
    },
    payload: {
      authorization: {
        from: "0x0000000000000000000000000000000000000002",
        to: "0x0000000000000000000000000000000000000001",
        value: "2000",
        validAfter: "0",
        validBefore: "9999999999",
        nonce: "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      signature:
        "0x111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111b"
    },
    resource: {
      url: "https://example.com/paid-resource",
      description: "debug settlement payload",
      mimeType: "application/json"
    },
    extensions: {}
  },
  paymentRequirements: {
    scheme: "exact",
    network: "eip155:5042002",
    asset: "0x3600000000000000000000000000000000000000",
    amount: "2000",
    payTo: "0x0000000000000000000000000000000000000001",
    maxTimeoutSeconds: 345600,
    extra: {
      name: "GatewayWalletBatched",
      version: "1",
      verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9"
    }
  }
};

async function main() {
  const response = await fetch(`${API_URL}/api/debug/x402/settle`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  console.log(`status=${response.status}`);
  console.log(text);
}

void main();
