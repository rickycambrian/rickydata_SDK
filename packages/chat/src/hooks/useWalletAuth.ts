import { useCallback, useEffect, useRef, useState } from 'react';
import type { WalletAdapter } from '../types/wallet.js';

const STORAGE_KEY = 'rickydata-chat-gateway-token';
const TOKEN_REFRESH_MARGIN_MS = 2 * 60_000; // 2 minutes

interface CachedToken {
  token: string;
  expiresAt: number;
  walletAddress: string;
}

function normalize(addr: string | null | undefined): string | null {
  return addr ? addr.toLowerCase() : null;
}

function base64UrlDecodeToJson(b64url: string): unknown {
  const padLen = (4 - (b64url.length % 4)) % 4;
  const padded = b64url + '='.repeat(padLen);
  const b64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(b64));
}

function getTokenExpiresAtMs(token: string): number | null {
  try {
    if (token.startsWith('mcpwt_')) {
      const payload = base64UrlDecodeToJson(token.slice('mcpwt_'.length)) as { exp?: number };
      return payload?.exp ? payload.exp * 1000 : null;
    }
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = base64UrlDecodeToJson(parts[1]) as { exp?: number };
    return payload?.exp ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function isTokenStillValid(cached: CachedToken, walletAddress: string): boolean {
  const normalizedWallet = normalize(walletAddress);
  if (!normalizedWallet) return false;
  if (normalize(cached.walletAddress) !== normalizedWallet) return false;

  const expMs = getTokenExpiresAtMs(cached.token);
  if (expMs && expMs <= Date.now() + TOKEN_REFRESH_MARGIN_MS) return false;
  if (cached.expiresAt <= Date.now() + 60_000) return false;

  return true;
}

function loadPersistedToken(walletAddress: string): CachedToken | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<CachedToken>;
    if (
      typeof data.token === 'string' &&
      typeof data.expiresAt === 'number' &&
      typeof data.walletAddress === 'string' &&
      isTokenStillValid(data as CachedToken, walletAddress)
    ) {
      return data as CachedToken;
    }
    localStorage.removeItem(STORAGE_KEY);
    return null;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function persistToken(cached: CachedToken) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
}

export type WalletAuthStatus = 'idle' | 'authenticating' | 'authenticated' | 'error';

/**
 * Wallet-agnostic gateway auth hook.
 * Replaces the Privy-coupled useGatewayAuth from the research app.
 * Uses WalletAdapter interface for signing.
 */
export function useWalletAuth(wallet: WalletAdapter, gatewayUrl: string) {
  const [gatewayToken, setGatewayToken] = useState<string | null>(null);
  const [status, setStatus] = useState<WalletAuthStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef<CachedToken | null>(null);
  const refreshingRef = useRef(false);

  const walletAddress = normalize(wallet.getAddress());
  const isAuthenticated = !!gatewayToken;

  // Auto-load persisted token on wallet change
  useEffect(() => {
    if (!walletAddress) {
      setGatewayToken(null);
      tokenRef.current = null;
      setStatus('idle');
      setError(null);
      return;
    }

    const persisted = loadPersistedToken(walletAddress);
    if (persisted) {
      tokenRef.current = persisted;
      setGatewayToken(persisted.token);
      setStatus('authenticated');
      setError(null);
    }
  }, [walletAddress]);

  const refreshToken = useCallback(async (): Promise<void> => {
    if (!walletAddress || !wallet.isReady() || !gatewayUrl) return;
    if (refreshingRef.current) return;

    // Check cached token first
    if (tokenRef.current && isTokenStillValid(tokenRef.current, walletAddress)) {
      setGatewayToken(tokenRef.current.token);
      setStatus('authenticated');
      setError(null);
      return;
    }

    refreshingRef.current = true;
    setStatus('authenticating');
    setError(null);

    try {
      const base = gatewayUrl.replace(/\/$/, '');

      // Step 1: Get challenge from gateway
      const challengeRes = await fetch(
        `${base}/auth/challenge?walletAddress=${encodeURIComponent(walletAddress)}`,
      );
      if (!challengeRes.ok) throw new Error(`Gateway challenge failed: ${challengeRes.status}`);
      const { nonce, message } = await challengeRes.json();

      // Step 2: Sign with wallet adapter
      const signature = await wallet.signMessage(message);

      // Step 3: Verify with gateway
      const verifyRes = await fetch(`${base}/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress, signature, nonce }),
      });
      if (!verifyRes.ok) throw new Error(`Gateway auth verification failed: ${verifyRes.status}`);
      const data = await verifyRes.json();

      // Validate wallet match
      const verifiedWallet = normalize(data.walletAddress);
      if (verifiedWallet && verifiedWallet !== walletAddress) {
        throw new Error('Authenticated wallet does not match connected wallet');
      }

      // Parse expiry
      const expiresAt =
        typeof data.expiresAt === 'number' ? data.expiresAt : Date.parse(data.expiresAt);
      if (!Number.isFinite(expiresAt)) {
        throw new Error('Invalid token expiry from gateway auth response');
      }

      // Cache and persist
      const cached: CachedToken = { token: data.token, expiresAt, walletAddress };
      tokenRef.current = cached;
      persistToken(cached);
      setGatewayToken(data.token);
      setStatus('authenticated');
      setError(null);
    } catch (err) {
      tokenRef.current = null;
      setGatewayToken(null);
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Gateway authentication failed');
    } finally {
      refreshingRef.current = false;
    }
  }, [walletAddress, wallet, gatewayUrl]);

  // Auto-refresh when wallet is ready and no valid token exists
  useEffect(() => {
    if (!walletAddress || !wallet.isReady() || !gatewayUrl) return;
    if (tokenRef.current && isTokenStillValid(tokenRef.current, walletAddress)) return;

    refreshToken().catch(() => undefined);
  }, [walletAddress, wallet, gatewayUrl, refreshToken]);

  return { gatewayToken, refreshToken, isAuthenticated, status, error };
}
