export interface GatewayChallenge {
  payTo: string;
  amount: string;
  currency: string;
  chain?: string;
  network?: string;
  tokenAddress?: string;
  scheme?: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
  x402Version?: number;
  resource?: string;
}

export interface PaidRequestInput<TPayload> {
  baseUrl: string;
  endpoint: string;
  payload: TPayload;
  buyerKey: "pi" | "literature" | "drugdb" | "pathway";
}

export interface PaidServiceVerification {
  ok?: boolean;
  status?: string;
  detail?: string;
  payer?: string;
  transaction?: string;
  network?: string;
}

export interface PaidServicePaymentResponse {
  settled?: boolean;
  mode?: string;
  endpoint?: string;
  transaction?: string;
  payer?: string;
  network?: string;
}

export interface PaidServiceAuthorization {
  buyerWalletId?: string;
  payer?: string;
  payTo?: string;
  amount?: string;
  validAfter?: string;
  validBefore?: string;
  nonce?: string;
  x402Version?: number;
  resourceUrl?: string;
}

export interface PaidServiceResponse<TData> {
  status: "ok";
  data: TData;
  endpoint?: string;
  servicePath?: string;
  seller?: string;
  verification?: PaidServiceVerification;
  paymentResponse?: PaidServicePaymentResponse;
  authorization?: PaidServiceAuthorization;
}
