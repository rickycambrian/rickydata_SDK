import { USDC_ADDRESS, USDC_DECIMALS, ETH_DECIMALS, DEFAULT_RPC_URL, BASE_CHAIN_ID } from '../constants.js';

const ERC20_BALANCE_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export interface WalletBalance {
  /** USDC balance in human-readable units (e.g. 1.50) */
  usdc: number;
  /** ETH balance in human-readable units */
  eth: number;
}

/**
 * Check USDC and ETH balances for an address on Base mainnet.
 * Retries once on RPC failure.
 */
export async function checkBalance(
  address: string,
  rpcUrl: string = DEFAULT_RPC_URL,
): Promise<WalletBalance> {
  const maxAttempts = 2;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const { createPublicClient, http, formatUnits } = await import('viem');
      const { base } = await import('viem/chains');

      const client = createPublicClient({
        chain: base,
        transport: http(rpcUrl),
      });

      const [usdcRaw, ethRaw] = await Promise.all([
        client.readContract({
          address: USDC_ADDRESS,
          abi: ERC20_BALANCE_ABI,
          functionName: 'balanceOf',
          args: [address as `0x${string}`],
        }),
        client.getBalance({ address: address as `0x${string}` }),
      ]);

      return {
        usdc: parseFloat(formatUnits(usdcRaw, USDC_DECIMALS)),
        eth: parseFloat(formatUnits(ethRaw, ETH_DECIMALS)),
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  throw new Error(`Balance check failed after ${maxAttempts} attempts: ${lastError?.message}`);
}
