export interface PublicTransaction {
  txHash: string;
  sender: string;
  recipient: string;
  amount: string;
  endpoint: string;
  timestamp: string;
}

export interface PrivateVerification {
  payment_valid: boolean;
  sender: string;
  amount: string;
  endpoint: string;
  /** Spend tag — the only per-payment value that ever touches the chain. */
  nullifier: string;
  /** Verifier reference safe to display (no sensitive data). */
  proofRef: string;
  /** "soroban" = real on-chain Groth16. "dev" = local scaffold. */
  privacyMode: "dev" | "soroban";
}

export interface DemoTriggerResponse {
  publicObservable: PublicTransaction;
  privateVerified: PrivateVerification;
  comparison: {
    publicExposes: string[];
    privateExposes: string[];
    hiddenByNull402: string[];
  };
}

export interface FeedEntry {
  id: string;
  type: "public" | "private";
  data: PublicTransaction | PrivateVerification;
  receivedAt: string;
}
