/**
 * Environment configuration loader for test runs.
 */

import type { TestEnvConfig } from './types.js';

/** Read an env var or throw a clear error. */
export function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}. Set it before running tests.`);
  }
  return value;
}

/**
 * Load test environment from process.env.
 * Reads TEST_WALLET_KEY or TEST_PRIVATE_KEY, plus optional overrides.
 */
export function loadTestEnv(overrides?: Partial<TestEnvConfig>): TestEnvConfig {
  const privateKey = process.env.TEST_WALLET_KEY
    ?? process.env.TEST_PRIVATE_KEY
    ?? overrides?.privateKey;

  if (!privateKey) {
    throw new Error(
      'No wallet key found. Set TEST_WALLET_KEY or TEST_PRIVATE_KEY environment variable.',
    );
  }

  return {
    privateKey,
    gatewayUrl: process.env.TEST_GATEWAY_URL ?? overrides?.gatewayUrl ?? 'https://agents.rickydata.org',
    model: (process.env.TEST_MODEL as TestEnvConfig['model']) ?? overrides?.model ?? 'sonnet',
    timeout: Number(process.env.TEST_TIMEOUT) || (overrides?.timeout ?? 60_000),
  };
}
