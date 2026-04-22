const DEFAULT_GATEWAY_API_BASE_URL = "https://gateway-api-testnet.circle.com/v1";

export interface X402PaymentRequirements {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
}

export interface X402PaymentPayload {
  x402Version: number;
  accepted: X402PaymentRequirements;
  payload: Record<string, unknown>;
  resource:
    | string
    | {
        url: string;
        description?: string;
        mimeType?: string;
      };
  extensions?: Record<string, unknown>;
}

export interface VerifyX402Request {
  paymentPayload: X402PaymentPayload;
  paymentRequirements: X402PaymentRequirements;
}

export interface VerifyX402Response {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

export interface SettleX402Response {
  success: boolean;
  transaction?: string;
  network?: string;
  errorReason?: string;
  payer?: string;
}

export interface SupportedX402Kind {
  x402Version: number;
  scheme: string;
  network: string;
  extra?: {
    name?: string;
    version?: string;
    verifyingContract?: string;
    assets?: Array<{
      address: string;
      symbol: string;
      decimals: number;
    }>;
  };
}

export interface SupportedX402Response {
  kinds: SupportedX402Kind[];
  extensions?: string[];
  signers?: Record<string, string[]>;
}

export class CircleGatewayApiClient {
  readonly baseUrl: string;

  constructor(baseUrl = process.env.CIRCLE_GATEWAY_API_BASE_URL || DEFAULT_GATEWAY_API_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async getSupportedPaymentKinds(): Promise<SupportedX402Response> {
    const response = await fetch(`${this.baseUrl}/x402/supported`);
    if (!response.ok) {
      throw new Error(`Gateway supported kinds failed: ${response.status} ${await response.text()}`);
    }
    return (await response.json()) as SupportedX402Response;
  }

  async verifyX402Payment(body: VerifyX402Request): Promise<VerifyX402Response> {
    const response = await fetch(`${this.baseUrl}/x402/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(`Gateway verify failed: ${response.status} ${await response.text()}`);
    }
    return (await response.json()) as VerifyX402Response;
  }

  async settleX402Payment(body: VerifyX402Request): Promise<SettleX402Response> {
    const response = await fetch(`${this.baseUrl}/x402/settle`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(`Gateway settle failed: ${response.status} ${await response.text()}`);
    }
    return (await response.json()) as SettleX402Response;
  }
}
