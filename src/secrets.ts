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
}
