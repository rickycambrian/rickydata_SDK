export const STORAGE_KEY = 'rickydata-auth-token';
export const TOKEN_REFRESH_MARGIN_MS = 120_000; // 2 minutes before expiry
export const LEGACY_STORAGE_KEYS = [
  'agentbook-auth',
  'auth_token',
  'gateway-auth-token',
  'rickydata-chat-gateway-token',
] as const;
