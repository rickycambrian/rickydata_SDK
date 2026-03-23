import type { PendingGeoTransaction, GeoTxResult, GeoTxSignerConfig } from './types.js';

/**
 * Thin wrapper that delegates Geo transaction signing to a caller-provided callback.
 *
 * The consuming app supplies `signTransaction` (from wagmi, ethers, viem, etc.)
 * and an optional `onApprovalRequired` callback for user-facing approval UI.
 */
export class GeoTransactionSigner {
  private config: GeoTxSignerConfig;

  constructor(config: GeoTxSignerConfig) {
    this.config = config;
  }

  /** The wallet address this signer is configured for. */
  get address(): string {
    return this.config.walletAddress;
  }

  /**
   * Sign and submit a pending Geo transaction.
   *
   * 1. If `onApprovalRequired` is configured, calls it first — throws if rejected.
   * 2. Delegates to `signTransaction` callback with `{ to, data, value }`.
   * 3. Returns `{ txHash }`.
   */
  async submitTransaction(pendingTx: PendingGeoTransaction): Promise<GeoTxResult> {
    // Approval gate
    if (this.config.onApprovalRequired) {
      const approved = await this.config.onApprovalRequired(pendingTx);
      if (!approved) {
        throw new Error(
          `Transaction rejected by user: ${pendingTx.description} (${pendingTx.id})`,
        );
      }
    }

    const txHash = await this.config.signTransaction({
      to: pendingTx.to,
      data: pendingTx.data,
      value: pendingTx.value,
    });

    return { txHash };
  }
}
