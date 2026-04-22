import { CircleGatewayApiClient, decodePaymentSignatureHeader } from "@biomed/payments";

export interface SellerVerificationInput {
  paymentHeader: string | null;
  sellerAddress: string;
}

export interface SellerVerificationResult {
  ok: boolean;
  status: "verified" | "missing" | "invalid";
  detail?: string;
  payer?: string;
  transaction?: string;
  network?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function buildVerifyRequestFromHeader(value: string) {
  const decoded = decodePaymentSignatureHeader(value);

  const paymentPayloadRaw = decoded;
  const accepted = isRecord(paymentPayloadRaw.accepted) ? paymentPayloadRaw.accepted : null;
  const payload = isRecord(paymentPayloadRaw.payload) ? paymentPayloadRaw.payload : null;

  if (!accepted || !payload) {
    throw new Error("Payment-Signature did not include accepted/payload objects");
  }

  const paymentPayload = {
    x402Version: Number(decoded.x402Version ?? 2),
    accepted: {
      scheme: asString(accepted.scheme) ?? "exact",
      network: asString(accepted.network) ?? "",
      asset: asString(accepted.asset) ?? "",
      amount: asString(accepted.amount) ?? "",
      payTo: asString(accepted.payTo) ?? "",
      maxTimeoutSeconds:
        typeof accepted.maxTimeoutSeconds === "number" ? accepted.maxTimeoutSeconds : undefined,
      extra: isRecord(accepted.extra) ? accepted.extra : {}
    },
    payload,
    resource:
      typeof decoded.resource === "string"
        ? {
            url: decoded.resource,
            description: "BioMed research step",
            mimeType: "application/json"
          }
        : isRecord(decoded.resource)
          ? {
              url: asString(decoded.resource.url) ?? "",
              description: asString(decoded.resource.description) ?? "BioMed research step",
              mimeType: asString(decoded.resource.mimeType) ?? "application/json"
            }
          : {
              url: "",
              description: "BioMed research step",
              mimeType: "application/json"
            },
    extensions: isRecord(decoded.extensions) ? decoded.extensions : {}
  };

  return {
    paymentPayload,
    paymentRequirements: paymentPayload.accepted
  };
}

export async function verifySellerPaymentLive(
  input: SellerVerificationInput
): Promise<SellerVerificationResult> {
  if (!input.paymentHeader) {
    return {
      ok: false,
      status: "missing",
      detail: "Missing payment header"
    };
  }

  let requestBody: ReturnType<typeof buildVerifyRequestFromHeader>;
  try {
    requestBody = buildVerifyRequestFromHeader(input.paymentHeader.trim());
  } catch (error) {
    return {
      ok: false,
      status: "invalid",
      detail: error instanceof Error ? error.message : "Unsupported payment header format"
    };
  }

  if (
    input.sellerAddress &&
    requestBody.paymentRequirements.payTo &&
    requestBody.paymentRequirements.payTo.toLowerCase() !== input.sellerAddress.toLowerCase()
  ) {
    return {
      ok: false,
      status: "invalid",
      detail: `Payment payTo mismatch: expected ${input.sellerAddress}, got ${requestBody.paymentRequirements.payTo}`
    };
  }

  const gateway = new CircleGatewayApiClient();
  const verify = await gateway.verifyX402Payment(requestBody);
  if (!verify.isValid) {
    return {
      ok: false,
      status: "invalid",
      detail: verify.invalidReason ?? "Gateway verify returned invalid",
      payer: verify.payer
    };
  }

  const settle = await gateway.settleX402Payment(requestBody);
  if (!settle.success) {
    return {
      ok: false,
      status: "invalid",
      detail: settle.errorReason ?? "Gateway settle returned unsuccessful response",
      payer: settle.payer,
      transaction: settle.transaction,
      network: settle.network
    };
  }

  return {
    ok: true,
    status: "verified",
    detail: "Payment verified and settled through Circle Gateway",
    payer: settle.payer ?? verify.payer,
    transaction: settle.transaction,
    network: settle.network
  };
}
