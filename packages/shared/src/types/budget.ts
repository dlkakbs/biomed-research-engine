import type { PaymentSurface } from "../constants/payment.js";
import type { WalletRole } from "../constants/payment.js";

export interface JobBudget {
  jobId: string;
  allocatedUnits: bigint;
  surface: PaymentSurface;
}

export interface WalletBinding {
  role: WalletRole;
  address: `0x${string}`;
  surface: PaymentSurface;
}
