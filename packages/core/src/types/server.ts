export interface Server {
  id: string;
  slug: string;
  name: string;
  title: string;
  description: string;
  registryType: string;
  securityScore: number | null;
  toolsCount: number;
  gatewayCompatible: boolean;
  categories: string[];
}

export interface ServerDetail extends Server {
  tools: Tool[];
  deploymentType: string | null;
  version: string | null;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

export interface PaymentInfo {
  verified: boolean;
  settled: boolean;
  amount?: string;
  txHash?: string;
}

export interface ToolResult {
  content: unknown;
  isError: boolean;
  payment?: PaymentInfo;
}

export interface ListOptions {
  registry?: string;
  deploymentType?: string;
  gatewayCompatible?: boolean;
  limit?: number;
  offset?: number;
}

export interface SemanticSearchOptions {
  limit?: number;
  includeAgents?: boolean;
  category?: string;
  type?: 'server' | 'agent' | 'all';
}

export interface SemanticSearchResultItem {
  id: string;
  name: string;
  title: string;
  description: string;
  type: 'server' | 'agent';
  score: number;
  semanticScore: number;
  textScore: number;
  matchReason: string;
  categories: string[];
  toolCount: number;
  securityScore?: number;
  skillCount?: number;
  isEnabled?: boolean;
}

export interface SemanticSearchResult {
  results: SemanticSearchResultItem[];
  searchMode: string;
  totalResults: number;
  latencyMs: number;
}

// Vault secrets

export interface VaultSecretStatus {
  serverId: string;
  configured: string[];
  required: string[];
  optional: string[];
  missing: string[];
  ready: boolean;
  injectionMode: 'env' | 'file' | 'none';
}

export interface VaultSecretEntry {
  key: string;
  value: string;
}
