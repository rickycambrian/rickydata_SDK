import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface StoredCredential {
  token: string;
  walletAddress: string;
  storedAt: string;
  expiresAt?: string;
  privateKey?: string;
}

export interface CredentialsFile {
  profiles: Record<string, StoredCredential>;
}

const LEGACY_CONFIG_DIR = path.join(os.homedir(), '.mcpg');
const CONFIG_DIR = path.join(os.homedir(), '.rickydata');
const CREDENTIALS_FILE = path.join(CONFIG_DIR, 'credentials.json');
const LEGACY_CREDENTIALS_FILE = path.join(LEGACY_CONFIG_DIR, 'credentials.json');

function resolveDefaultCredentialsPath(): string {
  if (fs.existsSync(CREDENTIALS_FILE)) {
    return CREDENTIALS_FILE;
  }

  if (!fs.existsSync(LEGACY_CREDENTIALS_FILE)) {
    return CREDENTIALS_FILE;
  }

  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.copyFileSync(LEGACY_CREDENTIALS_FILE, CREDENTIALS_FILE);
    fs.chmodSync(CREDENTIALS_FILE, 0o600);
    return CREDENTIALS_FILE;
  } catch {
    return LEGACY_CREDENTIALS_FILE;
  }
}

export class CredentialStore {
  private credentialsPath: string;
  private credentials: CredentialsFile | null = null;

  constructor(credentialsPath?: string) {
    this.credentialsPath = credentialsPath ?? resolveDefaultCredentialsPath();
  }

  private ensureDir(): void {
    const dir = path.dirname(this.credentialsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private load(): CredentialsFile {
    if (this.credentials) return this.credentials;

    if (!fs.existsSync(this.credentialsPath)) {
      this.credentials = { profiles: {} };
      return this.credentials;
    }

    try {
      const raw = fs.readFileSync(this.credentialsPath, 'utf-8');
      this.credentials = JSON.parse(raw) as CredentialsFile;
      if (!this.credentials.profiles) this.credentials.profiles = {};
    } catch {
      this.credentials = { profiles: {} };
    }

    return this.credentials;
  }

  private save(): void {
    this.ensureDir();
    const creds = this.load();
    const content = JSON.stringify(creds, null, 2);
    fs.writeFileSync(this.credentialsPath, content, { encoding: 'utf-8', mode: 0o600 });
  }

  getToken(profile = 'default'): StoredCredential | null {
    const creds = this.load();
    return creds.profiles[profile] ?? null;
  }

  setToken(token: string, walletAddress: string, profile = 'default', expiresAt?: string): void {
    const creds = this.load();
    creds.profiles[profile] = {
      token,
      walletAddress,
      storedAt: new Date().toISOString(),
      ...(expiresAt ? { expiresAt } : {}),
    };
    this.save();
  }

  clear(profile = 'default'): void {
    const creds = this.load();
    delete creds.profiles[profile];
    this.save();
  }

  clearAll(): void {
    this.credentials = { profiles: {} };
    this.save();
  }

  hasToken(profile = 'default'): boolean {
    return this.getToken(profile) !== null;
  }

  setPrivateKey(privateKey: string, profile = 'default'): void {
    const creds = this.load();
    if (!creds.profiles[profile]) {
      creds.profiles[profile] = { token: '', walletAddress: '', storedAt: new Date().toISOString() };
    }
    creds.profiles[profile].privateKey = privateKey;
    this.save();
  }

  getPrivateKey(profile = 'default'): string | null {
    const cred = this.getToken(profile);
    return cred?.privateKey ?? null;
  }
}
