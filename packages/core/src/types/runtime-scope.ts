export interface RuntimeScope {
  id: string;
  walletAddress: string;
  name: string;
  externalRef: string | null;
  status: 'active' | 'paused' | 'archived';
  metadata: Record<string, unknown>;
  budgetMicrousd: number;
  spentMicrousd: number;
  enabledServerIds: string[];
  createdAt: string;
  updatedAt: string;
}
