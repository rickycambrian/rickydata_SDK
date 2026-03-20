/**
 * SiYuan proxy adapter for KFDB authentication.
 *
 * Wraps SiYuan's /api/auth/wallet/* endpoints which proxy to KFDB,
 * handling the SiYuan-specific {code, msg, data} response envelope.
 *
 * This adapter is used when KFDB auth happens through a SiYuan backend
 * (e.g., when SiYuan is loaded in an iframe or as a standalone app).
 */

import type { WalletAdapter } from './wallet-adapter.js';

export interface SiYuanAuthConfig {
  /** SiYuan backend base URL (e.g., 'http://localhost:6806' or '' for same-origin) */
  baseUrl?: string;
}

export interface SiYuanAuthResult {
  token: string;
  expiresAt: number;
  wallet: string;
}

/**
 * Authenticate through SiYuan's wallet proxy endpoints.
 *
 * Flow:
 * 1. GET /api/auth/wallet/challenge -> {code:0, data: {challengeId, message, typedData}}
 * 2. Sign the message with the wallet adapter
 * 3. POST /api/auth/wallet/verify -> {code:0, data: {token, expiresAt, wallet}}
 *
 * @param adapter - WalletAdapter (e.g., from createPrivyAdapter)
 * @param config - Optional SiYuan connection config
 * @returns Authentication result with token and wallet address
 */
export async function authenticateViaSiYuan(
  adapter: WalletAdapter,
  config?: SiYuanAuthConfig,
): Promise<SiYuanAuthResult> {
  const baseUrl = config?.baseUrl ?? '';
  const address = adapter.getAddress();
  if (!address) {
    throw new Error('Wallet not connected');
  }

  // Step 1: Get challenge from SiYuan proxy
  const challengeResp = await fetch(`${baseUrl}/api/auth/wallet/challenge`);
  const challengeResult = await challengeResp.json();
  if (challengeResult.code !== 0) {
    throw new Error(challengeResult.msg || 'Failed to get challenge');
  }
  const { challengeId, message } = challengeResult.data;

  // Step 2: Sign the challenge message
  const signature = await adapter.signMessage(message);

  // Step 3: Verify signature through SiYuan proxy
  const verifyResp = await fetch(`${baseUrl}/api/auth/wallet/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      challengeId,
      signature,
      wallet: address,
    }),
  });
  const verifyResult = await verifyResp.json();
  if (verifyResult.code !== 0) {
    throw new Error(verifyResult.msg || 'Verification failed');
  }

  const authData = verifyResult.data as SiYuanAuthResult;
  return {
    token: authData.token,
    expiresAt: authData.expiresAt,
    wallet: authData.wallet || address,
  };
}

/**
 * Check tenant status through SiYuan's proxy.
 *
 * @param config - Optional SiYuan connection config
 * @returns Tenant info including plan
 */
export async function getSiYuanTenantStatus(
  config?: SiYuanAuthConfig,
): Promise<{ tenantId: string; plan: string; walletAddress: string | null }> {
  const baseUrl = config?.baseUrl ?? '';
  const resp = await fetch(`${baseUrl}/api/auth/wallet/tenant`);
  const result = await resp.json();
  if (result.code !== 0) {
    throw new Error(result.msg || 'Failed to get tenant status');
  }
  return result.data;
}

/**
 * Activate tenant (upgrade to paid plan) through SiYuan's proxy.
 *
 * @param paymentTxHash - On-chain USDC payment transaction hash
 * @param config - Optional SiYuan connection config
 * @returns Activation result
 */
export async function activateSiYuanTenant(
  paymentTxHash: string,
  config?: SiYuanAuthConfig,
): Promise<{ success: boolean; plan: string; message: string }> {
  const baseUrl = config?.baseUrl ?? '';
  const resp = await fetch(`${baseUrl}/api/auth/wallet/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentTxHash }),
  });
  const result = await resp.json();
  if (result.code !== 0) {
    throw new Error(result.msg || 'Activation failed');
  }
  return result.data;
}
