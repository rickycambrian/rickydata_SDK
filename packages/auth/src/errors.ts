export enum AuthErrorCode {
  CHALLENGE_EXPIRED = 'CHALLENGE_EXPIRED',
  SIGNATURE_INVALID = 'SIGNATURE_INVALID',
  ADDRESS_MISMATCH = 'ADDRESS_MISMATCH',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_MALFORMED = 'TOKEN_MALFORMED',
  NO_IDENTITY_FOUND = 'NO_IDENTITY_FOUND',
  IDENTITY_SUSPENDED = 'IDENTITY_SUSPENDED',
  PROVIDER_LINK_CONFLICT = 'PROVIDER_LINK_CONFLICT',
  SESSION_REVOKED = 'SESSION_REVOKED',
  RATE_LIMITED = 'RATE_LIMITED',
}

export class AuthError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AuthError';
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      ...(this.details && { details: this.details }),
    };
  }
}
