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
