import { CircleGatewayApiClient } from "@biomed/payments";

export async function getSupportedX402Kinds() {
  const client = new CircleGatewayApiClient();
  return client.getSupportedPaymentKinds();
}

export async function verifyX402Envelope(input: {
  paymentPayload: {
    x402Version: number;
    accepted: {
      scheme: string;
      network: string;
      asset: string;
      amount: string;
      payTo: string;
      maxTimeoutSeconds?: number;
      extra?: Record<string, unknown>;
    };
    payload: Record<string, unknown>;
    resource: {
      url: string;
      description?: string;
      mimeType?: string;
    };
    extensions?: Record<string, unknown>;
  };
  paymentRequirements: {
    scheme: string;
    network: string;
    asset: string;
    amount: string;
    payTo: string;
    maxTimeoutSeconds?: number;
    extra?: Record<string, unknown>;
  };
}) {
  const client = new CircleGatewayApiClient();
  return client.verifyX402Payment(input);
}

export async function settleX402Envelope(input: {
  paymentPayload: {
    x402Version: number;
    accepted: {
      scheme: string;
      network: string;
      asset: string;
      amount: string;
      payTo: string;
      maxTimeoutSeconds?: number;
      extra?: Record<string, unknown>;
    };
    payload: Record<string, unknown>;
    resource: string | { url: string; description?: string; mimeType?: string };
    extensions?: Record<string, unknown>;
  };
  paymentRequirements: {
    scheme: string;
    network: string;
    asset: string;
    amount: string;
    payTo: string;
    maxTimeoutSeconds?: number;
    extra?: Record<string, unknown>;
  };
}) {
  const client = new CircleGatewayApiClient();
  return client.settleX402Payment(input);
}
