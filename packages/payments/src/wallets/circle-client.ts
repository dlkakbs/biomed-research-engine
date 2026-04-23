import { generateEntitySecretCiphertext } from "@circle-fin/developer-controlled-wallets";

const DEFAULT_CIRCLE_BASE_URL = "https://api.circle.com/v1/w3s";

export interface CircleClientConfig {
  apiKey: string;
  entitySecret: string;
  baseUrl?: string;
}

export interface CircleTransferResult {
  id: string;
  state?: string;
  txHash?: string;
  raw: unknown;
}

export interface CircleTransactionResult {
  id: string;
  state?: string;
  txHash?: string;
  raw: unknown;
}

export interface CircleWalletRecord {
  id: string;
  address: string;
  blockchain?: string;
  state?: string;
  accountType?: string;
  raw: unknown;
}

function jsonHeaders(apiKey: string): Headers {
  return new Headers({
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json"
  });
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for Circle wallet operations`);
  }
  return value;
}

function getFirstPresentEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`${names.join(" or ")} is required for Circle wallet operations`);
}

function createIdempotencyKey(): string {
  return crypto.randomUUID();
}

function formatUsdcAmountFromUnits(amountUnits: bigint): string {
  const whole = amountUnits / 1_000_000n;
  const fractional = amountUnits % 1_000_000n;
  return `${whole}.${fractional.toString().padStart(6, "0")}`;
}

function getTransactionId(payload: Record<string, unknown>): string {
  const direct = payload.id ?? payload.transactionId ?? payload.transaction_id;
  if (typeof direct === "string" && direct) return direct;

  const nested = payload.transaction as Record<string, unknown> | undefined;
  const nestedId = nested?.id ?? nested?.transactionId ?? nested?.transaction_id;
  return typeof nestedId === "string" ? nestedId : "";
}

function getTransactionHash(payload: Record<string, unknown>): string {
  const direct =
    payload.txHash ??
    payload.transactionHash ??
    payload.blockchainTxHash ??
    payload.tx_hash ??
    payload.txhash;
  if (typeof direct === "string" && direct) return direct;

  const nested =
    (payload.tx as Record<string, unknown> | undefined) ??
    (payload.transaction as Record<string, unknown> | undefined);
  const nestedHash =
    nested?.txHash ??
    nested?.transactionHash ??
    nested?.blockchainTxHash ??
    nested?.tx_hash ??
    nested?.txhash;
  return typeof nestedHash === "string" ? nestedHash : "";
}

export class CircleWalletClient {
  readonly apiKey: string;
  readonly entitySecret: string;
  readonly baseUrl: string;

  constructor(config: CircleClientConfig) {
    this.apiKey = config.apiKey;
    this.entitySecret = config.entitySecret;
    this.baseUrl = config.baseUrl ?? DEFAULT_CIRCLE_BASE_URL;
  }

  async getEntitySecretCiphertext(): Promise<string> {
    return generateEntitySecretCiphertext({
      apiKey: this.apiKey,
      entitySecret: this.entitySecret
    });
  }

  static fromEnv(): CircleWalletClient {
    return new CircleWalletClient({
      apiKey: getFirstPresentEnv("CIRCLE_API_KEY_DIRECT", "CIRCLE_API_KEY"),
      entitySecret: getRequiredEnv("CIRCLE_ENTITY_SECRET"),
      baseUrl: process.env.CIRCLE_BASE_URL || DEFAULT_CIRCLE_BASE_URL
    });
  }

  async get(path: string, params?: Record<string, string>): Promise<Record<string, unknown>> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url, {
      method: "GET",
      headers: jsonHeaders(this.apiKey)
    });

    if (!response.ok) {
      throw new Error(`Circle GET ${path} failed: ${response.status} ${await response.text()}`);
    }

    return (await response.json()) as Record<string, unknown>;
  }

  async post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: jsonHeaders(this.apiKey),
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`Circle POST ${path} failed: ${response.status} ${await response.text()}`);
    }

    return (await response.json()) as Record<string, unknown>;
  }

  async getWalletBalances(walletId: string): Promise<Record<string, unknown>> {
    return this.get(`/wallets/${walletId}/balances`);
  }

  async getWallet(walletId: string): Promise<CircleWalletRecord> {
    const payload = await this.get(`/wallets/${walletId}`);
    const data = (payload.data as Record<string, unknown> | undefined) ?? payload;
    const wallet = (data.wallet as Record<string, unknown> | undefined) ?? data;

    const id = wallet.id;
    const address = wallet.address;
    if (typeof id !== "string" || typeof address !== "string") {
      throw new Error(`Circle wallet lookup for ${walletId} did not return id/address`);
    }

    return {
      id,
      address,
      blockchain: typeof wallet.blockchain === "string" ? wallet.blockchain : undefined,
      state: typeof wallet.state === "string" ? wallet.state : undefined,
      accountType: typeof wallet.accountType === "string" ? wallet.accountType : undefined,
      raw: payload
    };
  }

  async signTypedData(input: {
    walletId: string;
    typedData: Record<string, unknown>;
    memo?: string;
  }): Promise<Record<string, unknown>> {
    const entitySecretCiphertext = await this.getEntitySecretCiphertext();
    return this.post("/developer/sign/typedData", {
      entitySecretCiphertext,
      walletId: input.walletId,
      data: JSON.stringify(input.typedData),
      memo: input.memo
    });
  }

  async transferToken(input: {
    walletId: string;
    destinationAddress: string;
    amounts: string[];
    tokenId: string;
    feeLevel?: "LOW" | "MEDIUM" | "HIGH";
  }): Promise<CircleTransferResult> {
    const entitySecretCiphertext = await this.getEntitySecretCiphertext();
    const payload = await this.post("/developer/transactions/transfer", {
      idempotencyKey: createIdempotencyKey(),
      entitySecretCiphertext,
      walletId: input.walletId,
      destinationAddress: input.destinationAddress,
      amounts: input.amounts,
      tokenId: input.tokenId,
      feeLevel: input.feeLevel ?? "MEDIUM"
    });

    const data = (payload.data as Record<string, unknown> | undefined) ?? payload;
    return {
      id: getTransactionId(data),
      state: typeof data.state === "string" ? data.state : undefined,
      txHash: getTransactionHash(data) || undefined,
      raw: payload
    };
  }

  async transferTokenAndWait(input: {
    walletId: string;
    destinationAddress: string;
    amounts: string[];
    tokenId: string;
    feeLevel?: "LOW" | "MEDIUM" | "HIGH";
    timeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<CircleTransferResult> {
    const started = await this.transferToken(input);
    if (!started.id) {
      throw new Error("Circle token transfer did not return a transaction id");
    }

    const completed = await this.waitForTransaction(started.id, {
      timeoutMs: input.timeoutMs,
      pollIntervalMs: input.pollIntervalMs
    });
    const state = String(completed.state ?? "").toUpperCase();
    if (state !== "COMPLETE") {
      throw new Error(`Circle token transfer ${started.id} ended in state ${completed.state ?? "UNKNOWN"}`);
    }

    return {
      id: started.id,
      state: completed.state as string | undefined,
      txHash: getTransactionHash(completed) || started.txHash,
      raw: completed
    };
  }

  async getTransaction(transactionId: string): Promise<Record<string, unknown>> {
    const payload = await this.get(`/transactions/${transactionId}`);
    const data = (payload.data as Record<string, unknown> | undefined) ?? payload;
    return ((data.transaction as Record<string, unknown> | undefined) ?? data) as Record<string, unknown>;
  }

  async waitForTransaction(
    transactionId: string,
    options?: { timeoutMs?: number; pollIntervalMs?: number }
  ): Promise<Record<string, unknown>> {
    const timeoutMs = options?.timeoutMs ?? 180_000;
    const pollIntervalMs = options?.pollIntervalMs ?? 3_000;
    const deadline = Date.now() + timeoutMs;
    const terminalStates = new Set(["COMPLETE", "FAILED", "DENIED", "CANCELLED"]);

    while (Date.now() < deadline) {
      const transaction = await this.getTransaction(transactionId);
      const state = String(transaction.state ?? "").toUpperCase();
      if (terminalStates.has(state)) {
        return transaction;
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Circle transaction ${transactionId} did not complete within ${timeoutMs}ms`);
  }

  async executeContract(input: {
    walletId: string;
    contractAddress: string;
    abiFunctionSignature: string;
    abiParameters: Array<string>;
    amount?: string;
    feeLevel?: "LOW" | "MEDIUM" | "HIGH";
    refId?: string;
  }): Promise<CircleTransactionResult> {
    const entitySecretCiphertext = await this.getEntitySecretCiphertext();
    const payload = await this.post("/developer/transactions/contractExecution", {
      idempotencyKey: createIdempotencyKey(),
      entitySecretCiphertext,
      walletId: input.walletId,
      contractAddress: input.contractAddress,
      abiFunctionSignature: input.abiFunctionSignature,
      abiParameters: input.abiParameters,
      amount: input.amount,
      feeLevel: input.feeLevel ?? "MEDIUM",
      refId: input.refId
    });

    const data = (payload.data as Record<string, unknown> | undefined) ?? payload;
    return {
      id: getTransactionId(data),
      state: typeof data.state === "string" ? data.state : undefined,
      txHash: getTransactionHash(data) || undefined,
      raw: payload
    };
  }

  async executeContractAndWait(input: {
    walletId: string;
    contractAddress: string;
    abiFunctionSignature: string;
    abiParameters: Array<string>;
    amount?: string;
    feeLevel?: "LOW" | "MEDIUM" | "HIGH";
    refId?: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<CircleTransactionResult> {
    const started = await this.executeContract(input);
    if (!started.id) {
      throw new Error("Circle contract execution did not return a transaction id");
    }

    const completed = await this.waitForTransaction(started.id, {
      timeoutMs: input.timeoutMs,
      pollIntervalMs: input.pollIntervalMs
    });
    const state = String(completed.state ?? "").toUpperCase();
    if (state !== "COMPLETE") {
      throw new Error(`Circle contract execution ${started.id} ended in state ${completed.state ?? "UNKNOWN"}`);
    }

    return {
      id: started.id,
      state: completed.state as string | undefined,
      txHash: getTransactionHash(completed) || started.txHash,
      raw: completed
    };
  }
}

export async function transferUsdcAndWait(input: {
  fromWalletId: string;
  toAddress: string;
  amountUnits: bigint | number;
  tokenId?: string;
  feeLevel?: "LOW" | "MEDIUM" | "HIGH";
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<CircleTransferResult> {
  const tokenId = input.tokenId ?? getRequiredEnv("ARC_USDC_TOKEN_ID");
  const amountUnits = typeof input.amountUnits === "bigint" ? input.amountUnits : BigInt(input.amountUnits);
  const client = CircleWalletClient.fromEnv();
  return client.transferTokenAndWait({
    walletId: input.fromWalletId,
    destinationAddress: input.toAddress,
    amounts: [formatUsdcAmountFromUnits(amountUnits)],
    tokenId,
    feeLevel: input.feeLevel ?? "MEDIUM",
    timeoutMs: input.timeoutMs,
    pollIntervalMs: input.pollIntervalMs
  });
}
