export interface AuthSession {
  token: string;
  address: string;
  tenantId?: string;
  expiresAt: number;
  issuedAt: number;
}

export interface CachedToken {
  token: string;
  address: string;
  tenantId?: string;
  expiresAt: number;
  storedAt: number;
}

export interface WalletTokenPayload {
  sub: string;       // wallet address
  iss: string;       // issuer (e.g., 'kfdb', 'gateway')
  exp: number;       // expiration timestamp
  iat: number;       // issued at timestamp
  tid?: string;      // tenant ID
  permissions?: string[];
}
