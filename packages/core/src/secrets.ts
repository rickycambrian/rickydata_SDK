import type { AuthManager } from './auth.js';
import type { VaultSecretStatus, VaultSecretEntry } from './types/server.js';
import { VaultError } from './errors/index.js';

export class SecretsManager {
  constructor(
    private baseUrl: string,
    private auth: AuthManager,
  ) {}

  async store(serverId: string, secrets: Record<string, string>): Promise<void> {
    const res = await this.auth.fetchWithAuth(`${this.baseUrl}/api/secrets/${serverId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ secrets }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new VaultError(res.status, serverId, `Failed to store secrets: ${res.status} ${body}`);
    }
  }

  async get(serverId: string): Promise<string[]> {
    const res = await this.auth.fetchWithAuth(`${this.baseUrl}/api/secrets/${serverId}`);
    if (!res.ok) {
      throw new VaultError(res.status, serverId, `Failed to get secrets: ${res.status}`);
    }
    const data = await res.json();
    return data.configuredSecrets ?? data.keys ?? [];
  }

  async delete(serverId: string): Promise<void> {
    const res = await this.auth.fetchWithAuth(`${this.baseUrl}/api/secrets/${serverId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      throw new VaultError(res.status, serverId, `Failed to delete secrets: ${res.status}`);
    }
  }

  /**
   * @deprecated Use `getFullStatus()` for comprehensive status including requirements and injection mode.
   */
  async getStatus(serverId: string): Promise<{
    configured: string[];
    required: string[];
    optional: string[];
    mode: 'full' | 'read-only' | 'unavailable';
  }> {
    const configured = await this.get(serverId);
    return {
      configured,
      required: [],
      optional: [],
      mode: configured.length > 0 ? 'full' : 'read-only',
    };
  }

  /** Retrieve all secret values for a server. Only accessible by the storing user. */
  async getValues(serverId: string): Promise<VaultSecretEntry[]> {
    const res = await this.auth.fetchWithAuth(
      `${this.baseUrl}/api/secrets/${serverId}/values`,
    );
    if (!res.ok) {
      const body = await res.text();
      throw new VaultError(res.status, serverId, `Failed to get secret values: ${res.status} ${body}`);
    }
    const data = await res.json();
    return data.secrets ?? [];
  }

  /** Retrieve a single secret value by key. Returns null if not configured. */
  async getValue(serverId: string, key: string): Promise<string | null> {
    const res = await this.auth.fetchWithAuth(
      `${this.baseUrl}/api/secrets/${serverId}/values/${encodeURIComponent(key)}`,
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      const body = await res.text();
      throw new VaultError(res.status, serverId, `Failed to get secret value: ${res.status} ${body}`);
    }
    const data = await res.json();
    return data.value ?? null;
  }

  /** Get comprehensive secret status including requirements and injection mode. */
  async getFullStatus(serverId: string): Promise<VaultSecretStatus> {
    const res = await this.auth.fetchWithAuth(
      `${this.baseUrl}/api/secrets/${serverId}/status`,
    );
    if (!res.ok) {
      const body = await res.text();
      throw new VaultError(res.status, serverId, `Failed to get secret status: ${res.status} ${body}`);
    }
    return res.json();
  }
}
