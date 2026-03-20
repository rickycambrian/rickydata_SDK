// Types
export type { AuthSession, CachedToken, WalletTokenPayload } from './types.js';

// Errors
export { AuthErrorCode, AuthError } from './errors.js';

// Constants
export { STORAGE_KEY, TOKEN_REFRESH_MARGIN_MS, LEGACY_STORAGE_KEYS } from './constants.js';

// Token cache
export { getToken, setToken, clearToken, isTokenValid } from './token-cache.js';

// Privy config
export { createPrivyConfig } from './privy-config.js';
export type { PrivyAppearanceOverrides, PrivyConfigOptions } from './privy-config.js';

// Auth manager
export { SharedAuthManager } from './auth-manager.js';

// Adapters
export type { WalletAdapter } from './adapters/wallet-adapter.js';
export { createPrivyAdapter } from './adapters/privy-adapter.js';
export type { PrivyWallet, PrivyWallets, PrivyAuth } from './adapters/privy-adapter.js';

// SiYuan adapter
export { authenticateViaSiYuan, getSiYuanTenantStatus, activateSiYuanTenant } from './adapters/siyuan-adapter.js';
export type { SiYuanAuthConfig, SiYuanAuthResult } from './adapters/siyuan-adapter.js';
