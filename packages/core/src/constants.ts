/** Base mainnet chain ID */
export const BASE_CHAIN_ID = 8453;

/** USDC contract address on Base mainnet */
export const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;

/** USDC decimals */
export const USDC_DECIMALS = 6;

/** ETH decimals */
export const ETH_DECIMALS = 18;

/** Default Base mainnet RPC URL */
export const DEFAULT_RPC_URL = 'https://mainnet.base.org';

/** Default public RPC URLs for common EVM payment networks. */
export const DEFAULT_EVM_RPC_URLS: Record<number, string> = {
  1: 'https://eth.llamarpc.com',
  10: 'https://mainnet.optimism.io',
  56: 'https://bsc-dataseed.binance.org',
  137: 'https://polygon-rpc.com',
  8453: DEFAULT_RPC_URL,
  42161: 'https://arb1.arbitrum.io/rpc',
  43114: 'https://api.avax.network/ext/bc/C/rpc',
  59144: 'https://rpc.linea.build',
  84532: 'https://base-sepolia.drpc.org',
  11155111: 'https://rpc.sepolia.org',
};

/**
 * BIP-44 HD derivation path template for MCP Gateway spending wallets.
 * m/44'/60'/8453'/0/{index}
 * 8453 = Base mainnet chain ID — makes these wallets identifiable as MCP Gateway spending wallets.
 */
export const HD_PATH_PREFIX = "m/44'/60'/8453'/0" as const;

/** Default EIP-712 token name for USDC */
export const USDC_TOKEN_NAME = 'USD Coin';

/** Default EIP-712 token version for USDC */
export const USDC_TOKEN_VERSION = '2';

/** Default spending policy values */
export const DEFAULT_POLICY = {
  maxPerCall: 0.01,
  maxPerSession: 1.0,
  maxPerDay: 5.0,
  maxPerWeek: 20.0,
  circuitBreakerThreshold: 5,
  circuitBreakerCooldownSeconds: 300,
  deduplicationWindowSeconds: 30,
  requireApprovalAbove: Infinity,
  dryRun: false,
} as const;
