import type { AuthManager } from './auth.js';

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
      throw new Error(`Failed to store secrets: ${res.status} ${body}`);
    }
  }

  async get(serverId: string): Promise<string[]> {
    const res = await this.auth.fetchWithAuth(`${this.baseUrl}/api/secrets/${serverId}`);
    if (!res.ok) {
      throw new Error(`Failed to get secrets: ${res.status}`);
    }
    const data = await res.json();
    return data.configuredSecrets ?? data.keys ?? [];
  }

  async delete(serverId: string): Promise<void> {
    const res = await this.auth.fetchWithAuth(`${this.baseUrl}/api/secrets/${serverId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      throw new Error(`Failed to delete secrets: ${res.status}`);
    }
  }

  /**
   * Get the current secret configuration status for a server.
   * Returns configured keys, required/optional lists, and the effective mode.
   */
  async getStatus(serverId: string): Promise<{
    configured: string[];
    required: string[];
    optional: string[];
    mode: 'full' | 'read-only' | 'unavailable';
  }> {
    const configured = await this.get(serverId);
    // Requirements come from the MCP gateway requirements endpoint
    // For now, return what we know from the configured secrets
    return {
      configured,
      required: [],
      optional: [],
      mode: configured.length > 0 ? 'full' : 'read-only',
    };
  }
}
