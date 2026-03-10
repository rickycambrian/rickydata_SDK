import { useQuery } from '@tanstack/react-query';
import type { WalletBalanceResponse, WalletTransactionsResponse } from 'rickydata/agent';
import { useRickyData } from '../providers/RickyDataProvider.js';

export const balanceKeys = {
  all: ['wallet-balance'] as const,
  balance: () => [...balanceKeys.all, 'balance'] as const,
  transactions: (limit?: number, offset?: number) =>
    [...balanceKeys.all, 'transactions', { limit, offset }] as const,
};

interface UseWalletBalanceOptions {
  enabled?: boolean;
  /** Stale time in ms. Defaults to 60s. */
  staleTime?: number;
}

/** Fetch wallet balance with formatted display value. */
export function useWalletBalance(opts?: UseWalletBalanceOptions) {
  const client = useRickyData();
  const query = useQuery<WalletBalanceResponse>({
    queryKey: balanceKeys.balance(),
    queryFn: () => client.getWalletBalance(),
    staleTime: opts?.staleTime ?? 60_000,
    enabled: opts?.enabled !== false,
  });

  const balance = query.data?.availableBalance ?? '0';
  const num = parseFloat(balance);
  const balanceDisplay = isNaN(num) ? '$0.00'
    : num >= 0.01 ? `$${num.toFixed(2)}`
    : num > 0 ? `$${num.toFixed(4)}`
    : '$0.00';

  return {
    ...query,
    balance,
    balanceDisplay,
    depositAddress: query.data?.unifiedDepositAddress,
    agentSpends: query.data?.agentSpends,
    refresh: () => query.refetch(),
  };
}

/** Fetch wallet transaction history. */
export function useWalletTransactions(limit?: number, offset?: number) {
  const client = useRickyData();
  return useQuery<WalletTransactionsResponse>({
    queryKey: balanceKeys.transactions(limit, offset),
    queryFn: () => client.getWalletTransactions(limit, offset),
    staleTime: 30_000,
  });
}
