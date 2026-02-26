import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface ProfileConfig {
  agentGatewayUrl?: string;
  mcpGatewayUrl?: string;
  [key: string]: unknown;
}

export interface ConfigFile {
  activeProfile: string;
  profiles: Record<string, ProfileConfig>;
}

const LEGACY_CONFIG_DIR = path.join(os.homedir(), '.mcpg');
const CONFIG_DIR = path.join(os.homedir(), '.rickydata');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const LEGACY_CONFIG_FILE = path.join(LEGACY_CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG: ConfigFile = {
  activeProfile: 'default',
  profiles: {
    default: {
      agentGatewayUrl: 'https://agents.rickydata.org',
      mcpGatewayUrl: 'https://mcp.rickydata.org',
    },
  },
};

function resolveDefaultConfigPath(): string {
  if (fs.existsSync(CONFIG_FILE)) {
    return CONFIG_FILE;
  }

  if (!fs.existsSync(LEGACY_CONFIG_FILE)) {
    return CONFIG_FILE;
  }

  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.copyFileSync(LEGACY_CONFIG_FILE, CONFIG_FILE);
    return CONFIG_FILE;
  } catch {
    return LEGACY_CONFIG_FILE;
  }
}

export class ConfigManager {
  private configPath: string;
  private config: ConfigFile | null = null;

  constructor(configPath?: string) {
    this.configPath = configPath ?? resolveDefaultConfigPath();
  }

  private ensureDir(): void {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private load(): ConfigFile {
    if (this.config) return this.config;

    if (!fs.existsSync(this.configPath)) {
      this.config = structuredClone(DEFAULT_CONFIG);
      return this.config;
    }

    try {
      const raw = fs.readFileSync(this.configPath, 'utf-8');
      this.config = JSON.parse(raw) as ConfigFile;
      // Ensure required fields exist
      if (!this.config.activeProfile) this.config.activeProfile = 'default';
      if (!this.config.profiles) this.config.profiles = {};
      if (!this.config.profiles[this.config.activeProfile]) {
        this.config.profiles[this.config.activeProfile] = structuredClone(
          DEFAULT_CONFIG.profiles.default
        );
      }
    } catch {
      this.config = structuredClone(DEFAULT_CONFIG);
    }

    return this.config;
  }

  private save(): void {
    this.ensureDir();
    const config = this.load();
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  getActiveProfile(): string {
    return this.load().activeProfile;
  }

  setActiveProfile(name: string): void {
    const config = this.load();
    if (!config.profiles[name]) {
      config.profiles[name] = structuredClone(DEFAULT_CONFIG.profiles.default);
    }
    config.activeProfile = name;
    this.save();
  }

  getProfile(name?: string): ProfileConfig {
    const config = this.load();
    const profileName = name ?? config.activeProfile;
    return config.profiles[profileName] ?? structuredClone(DEFAULT_CONFIG.profiles.default);
  }

  listProfiles(): string[] {
    return Object.keys(this.load().profiles);
  }

  get(key: string, profile?: string): unknown {
    return this.getProfile(profile)[key];
  }

  set(key: string, value: unknown, profile?: string): void {
    const config = this.load();
    const profileName = profile ?? config.activeProfile;
    if (!config.profiles[profileName]) {
      config.profiles[profileName] = structuredClone(DEFAULT_CONFIG.profiles.default);
    }
    config.profiles[profileName][key] = value;
    this.save();
  }

  list(profile?: string): ProfileConfig {
    return this.getProfile(profile);
  }

  getAgentGatewayUrl(profile?: string): string {
    return (this.get('agentGatewayUrl', profile) as string) ?? 'https://agents.rickydata.org';
  }

  getMcpGatewayUrl(profile?: string): string {
    return (this.get('mcpGatewayUrl', profile) as string) ?? 'https://mcp.rickydata.org';
  }
}
