/** Represents an unsigned Geo transaction waiting for wallet signature. */
export interface PendingGeoTransaction {
  /** Dashless UUID from geo_mcp_server */
  id: string;
  /** Contract address (0x...) */
  to: string;
  /** Encoded calldata (0x...) */
  data: string;
  /** Wei amount as string (optional) */
  value?: string;
  /** Human-readable description, e.g. "Publish edit to personal space" */
  description: string;
  /** MCP tool that generated this: "publish_edit", "propose_dao_edit", etc. */
  toolName: string;
  /** Extra context: editId, cid, proposalId, etc. */
  metadata?: Record<string, unknown>;
}

/** Result of submitting a signed Geo transaction. */
export interface GeoTxResult {
  txHash: string;
  receipt?: unknown;
  /** Next transaction in a multi-tx flow (e.g. vote after propose). */
  continuation?: PendingGeoTransaction;
}

/** Configuration for GeoTransactionSigner. */
export interface GeoTxSignerConfig {
  walletAddress: string;
  /** Callback that signs and submits a transaction, returns txHash. */
  signTransaction: (tx: { to: string; data: string; value?: string }) => Promise<string>;
  /** Optional callback for approval UI — returns true to proceed, false to reject. */
  onApprovalRequired?: (tx: PendingGeoTransaction) => Promise<boolean>;
}
