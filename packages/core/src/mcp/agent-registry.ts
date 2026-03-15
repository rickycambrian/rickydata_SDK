/**
 * Agent Registry
 *
 * Manages ~/.rickydata/mcp-agents.json — the list of agents enabled as MCP tools
 * via the dynamic proxy server. Follows the CredentialStore pattern for file I/O.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface EnabledAgent {
  agentId: string;
  enabledAt: string;
}

export interface AgentRegistryFile {
  version: 1;
  agents: EnabledAgent[];
}

const CONFIG_DIR = path.join(os.homedir(), '.rickydata');
const REGISTRY_FILE = path.join(CONFIG_DIR, 'mcp-agents.json');

export class AgentRegistry {
  private registryPath: string;
  private data: AgentRegistryFile | null = null;

  constructor(registryPath?: string) {
    this.registryPath = registryPath ?? REGISTRY_FILE;
  }

  get filePath(): string {
    return this.registryPath;
  }

  private ensureDir(): void {
    const dir = path.dirname(this.registryPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private load(): AgentRegistryFile {
    if (this.data) return this.data;

    if (!fs.existsSync(this.registryPath)) {
      this.data = { version: 1, agents: [] };
      return this.data;
    }

    try {
      const raw = fs.readFileSync(this.registryPath, 'utf-8');
      this.data = JSON.parse(raw) as AgentRegistryFile;
      if (!Array.isArray(this.data.agents)) this.data.agents = [];
    } catch {
      this.data = { version: 1, agents: [] };
    }

    return this.data;
  }

  /** Force a reload from disk on next access. */
  reload(): void {
    this.data = null;
  }

  private save(): void {
    this.ensureDir();
    const data = this.load();
    const content = JSON.stringify(data, null, 2);
    fs.writeFileSync(this.registryPath, content, { encoding: 'utf-8', mode: 0o600 });
  }

  enableAgent(agentId: string): void {
    const data = this.load();
    if (data.agents.some((a) => a.agentId === agentId)) return;
    data.agents.push({ agentId, enabledAt: new Date().toISOString() });
    this.save();
  }

  disableAgent(agentId: string): void {
    const data = this.load();
    data.agents = data.agents.filter((a) => a.agentId !== agentId);
    this.save();
  }

  isEnabled(agentId: string): boolean {
    return this.load().agents.some((a) => a.agentId === agentId);
  }

  listAgents(): EnabledAgent[] {
    return [...this.load().agents];
  }

  /**
   * Watch the registry file for changes. Calls `callback` when the file is modified.
   * Returns an `fs.FSWatcher` for cleanup.
   */
  watch(callback: () => void): fs.FSWatcher {
    this.ensureDir();

    // Ensure the file exists so fs.watch doesn't throw
    if (!fs.existsSync(this.registryPath)) {
      this.save();
    }

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const watcher = fs.watch(this.registryPath, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        this.reload();
        callback();
      }, 500);
    });

    return watcher;
  }
}
