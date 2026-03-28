import { KFDBClient } from '../kfdb/client.js';
import type {
  KfdbBatchGetEntitiesResponse,
  KfdbEntityResponse,
  KfdbListEntitiesResponse,
  KfdbListLabelsResponse,
  KfdbWriteResponse,
} from '../kfdb/types.js';
import {
  DEFAULT_RESEARCH_AGENT_SPECS,
} from './defaults.js';
import type {
  PublicInputSnapshot,
  ResearchEntityFilterOptions,
  ResearchGetEntityOptions,
  ResearchKFDBClientConfig,
  ResearchListEntityOptions,
  ResearchNodeWriteRequest,
  ResearchPrivacyContext,
  ResearchPrivacyQueryGuard,
  ResearchSnapshotWriteRequest,
  ResearchSqlValidationOptions,
} from './types.js';

const SESSION_TABLES = [
  'session',
  'plugin_sessions',
  'plugin_tool_calls',
  'plugin_messages',
  'plugin_artifacts',
  'plugin_git_operations',
];

const DEFAULT_FILTER_PATTERNS = [
  /workspace_id\s*=/i,
  /project_id\s*=/i,
  /user_id\s*=/i,
  /working_directory\s*(like|=)\s*['"]/i,
  /session_id\s+in\s*\(/i,
];

function ensurePrivacyContext(context: ResearchPrivacyContext): void {
  if (!context.walletAddress) throw new Error('privacyContext.walletAddress is required');
  if (!context.projectId) throw new Error('privacyContext.projectId is required');
  if (!context.workspaceId) throw new Error('privacyContext.workspaceId is required');
  if (context.visibility !== 'private') throw new Error('ResearchPrivacyContext.visibility must be "private"');
  if (context.readScope !== 'private') throw new Error('ResearchPrivacyContext.readScope must be "private"');
}

function referencesSessionTable(sql: string): boolean {
  return SESSION_TABLES.some((table) => new RegExp(`\\b(from|join)\\s+${table}\\b`, 'i').test(sql));
}

function makePrivateMetadata(context: ResearchPrivacyContext): Record<string, unknown> {
  return {
    wallet_address: context.walletAddress.toLowerCase(),
    project_id: context.projectId,
    workspace_id: context.workspaceId,
    visibility: context.visibility,
    read_scope: context.readScope,
  };
}

export class ResearchKFDBClient implements ResearchPrivacyQueryGuard {
  private readonly client: KFDBClient;
  private readonly privacyContext: ResearchPrivacyContext;

  constructor(config: ResearchKFDBClientConfig) {
    ensurePrivacyContext(config.privacyContext);

    this.privacyContext = config.privacyContext;
    this.client = new KFDBClient({
      ...config,
      defaultReadScope: 'private',
    });
  }

  getContext(): ResearchPrivacyContext {
    return this.privacyContext;
  }

  getDefaultAgentSpecs() {
    return DEFAULT_RESEARCH_AGENT_SPECS;
  }

  validateSessionQuery(sql: string, options: ResearchSqlValidationOptions = {}): string {
    if (!referencesSessionTable(sql)) return sql;

    const patterns = [...DEFAULT_FILTER_PATTERNS, ...(options.additionalPatterns ?? [])];
    const hasAllowedFilter = patterns.some((pattern) => pattern.test(sql));
    const hasWorkspaceFilter = new RegExp(`workspace_id\\s*=\\s*['"]${escapeForRegex(this.privacyContext.workspaceId)}['"]`, 'i')
      .test(sql);
    const hasProjectFilter = new RegExp(`project_id\\s*=\\s*['"]${escapeForRegex(this.privacyContext.projectId)}['"]`, 'i')
      .test(sql);

    if (!hasAllowedFilter || (!hasWorkspaceFilter && !(options.allowProjectFilter && hasProjectFilter))) {
      throw new Error(
        'Research session queries must include explicit workspace_id filters. ' +
        'Use the private tenant context or local session traces instead.',
      );
    }

    return sql;
  }

  async listLabels(): Promise<KfdbListLabelsResponse> {
    return this.client.listLabels('private');
  }

  async listEntities(label: string, options: ResearchListEntityOptions = {}): Promise<KfdbListEntitiesResponse> {
    return this.client.listEntities(label, { ...options, scope: 'private' });
  }

  async getEntity(label: string, id: string, options: ResearchGetEntityOptions = {}): Promise<KfdbEntityResponse> {
    return this.client.getEntity(label, id, { ...options, scope: 'private' });
  }

  async filterResearchEntities(
    label: string,
    options: ResearchEntityFilterOptions = {},
  ): Promise<KfdbListEntitiesResponse> {
    const filters = {
      ...makePrivateMetadata(this.privacyContext),
      ...(options.filters ?? {}),
    };
    return this.client.filterEntities(label, { ...options, scope: 'private', filters });
  }

  async batchGetEntities(
    entities: Array<{ label: string; id: string }>,
    includeEmbeddings?: boolean,
  ): Promise<KfdbBatchGetEntitiesResponse> {
    return this.client.batchGetEntities({ scope: 'private', entities, includeEmbeddings });
  }

  async write(request: ResearchNodeWriteRequest): Promise<KfdbWriteResponse> {
    const operation = request.options?.operation ?? 'create_node';
    return this.client.write({
      operations: [
        {
          operation,
          label: request.label,
          properties: {
            ...request.properties,
            ...makePrivateMetadata(this.privacyContext),
          },
        },
      ],
      skip_embedding: request.options?.skipEmbedding,
    });
  }

  async snapshotPublicInput(request: ResearchSnapshotWriteRequest): Promise<KfdbWriteResponse> {
    const snapshot = request.snapshot;
    return this.client.write({
      operations: [
        {
          operation: 'create_node',
          label: request.label ?? 'PublicInputSnapshot',
          properties: {
            ...snapshot,
            ...makePrivateMetadata(this.privacyContext),
            visibility: 'private',
            scope: 'private',
          },
        },
      ],
    });
  }

  buildScopedFilters(filters: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      ...makePrivateMetadata(this.privacyContext),
      ...filters,
    };
  }
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
