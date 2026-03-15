#!/usr/bin/env node
import { startAgentMCPProxy } from '../dist/mcp/agent-mcp-proxy.js';
import { CredentialStore } from '../dist/cli/config/credential-store.js';
import { ConfigManager } from '../dist/cli/config/config-manager.js';

const config = new ConfigManager();
const store = new CredentialStore();
const profile = config.getActiveProfile();
const cred = store.getToken(profile);

if (!cred?.token) {
  console.error('Not authenticated. Run `rickydata auth login` first.');
  process.exit(1);
}

const gatewayUrl = config.getAgentGatewayUrl(profile).replace(/\/$/, '');

console.error(`Agent MCP proxy starting (gateway: ${gatewayUrl})`);

void startAgentMCPProxy(gatewayUrl, cred.token);
