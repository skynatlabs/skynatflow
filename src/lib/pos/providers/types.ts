// Common interface every card-payment provider implements, so adding a
// new region/provider is one new file, never a change to checkout code.

export interface PosChargeResult {
  ok: boolean;
  reference?: string;
  error?: string;
}

export interface PosCardProvider {
  charge(amountCents: number, meta?: Record<string, string>): Promise<PosChargeResult>;
}
