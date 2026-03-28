import type { PaymentRequirements } from '../types/payment.js';
import { signPayment } from './payment-signer.js';
import { DEFAULT_EVM_RPC_URLS, USDC_ADDRESS } from '../constants.js';

export interface X402RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | object;
  autoPay?: boolean;
  maxPaymentUsd?: number;
  rpcUrls?: Record<number, string>;
}

export interface X402OfferEvaluation {
  network: string;
  chainId: number | null;
  amount: string;
  asset: string;
  recipient: string;
  tokenName?: string;
  tokenVersion?: string;
  supported: boolean;
  balance?: string;
  balanceSufficient?: boolean;
  reason?: string;
}

export interface X402SelectedOffer {
  network: string;
  chainId: number;
  amount: string;
  asset: string;
  recipient: string;
  tokenName?: string;
  tokenVersion?: string;
}

export interface X402Response {
  success: boolean;
  status: 'ok' | 'paid' | 'payment_required' | 'payment_unfunded' | 'payment_failed' | 'payment_rejected';
  x402: boolean;
  result?: unknown;
  payment?: { amount: string; network: string; from: string; to: string };
  error?: string;
  serverReason?: string;
  httpStatus?: number;
  paymentDetails?: unknown;
  selectedOffer?: X402SelectedOffer;
  usableOffers?: X402OfferEvaluation[];
  paymentAttempted?: boolean;
}

export interface X402ClientOptions {
  chainId?: number;
  maxPaymentUsd?: number;
  rpcUrls?: Record<number, string>;
  strictChainId?: boolean;
}

const ERC20_BALANCE_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const NAME_FIELD = 'tokenName' as const;
const VERSION_FIELD = 'tokenVersion' as const;

function parseChainId(network: string): number | null {
  if (!network) return null;
  if (network.startsWith('eip155:')) {
    const parsed = parseInt(network.split(':')[1] ?? '', 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  switch (network) {
    case 'ethereum':
      return 1;
    case 'optimism':
      return 10;
    case 'bsc':
      return 56;
    case 'polygon':
      return 137;
    case 'arbitrum':
      return 42161;
    case 'avalanche':
      return 43114;
    case 'linea':
      return 59144;
    case 'base':
      return 8453;
    case 'sepolia':
      return 11155111;
    case 'base-sepolia':
      return 84532;
    default:
      return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function extractFailureReason(result: unknown): string | undefined {
  const seen = new Set<unknown>();
  const queue: unknown[] = [result];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) {
      if (typeof current === 'string' && current.trim()) {
        return current.trim();
      }
      continue;
    }

    seen.add(current);
    const record = current as Record<string, unknown>;
    for (const key of ['reason', 'message', 'error']) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
      if (candidate && typeof candidate === 'object') {
        queue.push(candidate);
      }
    }

    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') {
        queue.push(value);
      }
    }
  }

  return undefined;
}

/**
 * Lightweight HTTP client that handles x402 payment-required responses.
 * Reuses signPayment() from the SDK — no duplicate EIP-712 logic.
 *
 * Usage:
 *   const client = new X402Client(privateKey);
 *   const res = await client.request('https://api.example.com/tool', { autoPay: true });
 */
export class X402Client {
  private readonly account: { address: `0x${string}`; signTypedData?: unknown };
  private readonly preferredChainId: number | null;
  private readonly defaultMaxPaymentUsd: number;
  private readonly defaultRpcUrls: Record<number, string>;
  private readonly strictChainId: boolean;

  constructor(privateKey: string, options?: X402ClientOptions) {
    // Lazy-import privateKeyToAccount so this module is safe to import server-side
    // without viem being called at module load time. We initialize synchronously by
    // storing raw privateKey and deriving account on first use.
    this.preferredChainId = options?.chainId ?? null;
    this.defaultMaxPaymentUsd = options?.maxPaymentUsd ?? 1.0;
    this.defaultRpcUrls = { ...DEFAULT_EVM_RPC_URLS, ...(options?.rpcUrls ?? {}) };
    this.strictChainId = options?.strictChainId ?? false;

    // Derive account synchronously via a temporary placeholder; the real derivation
    // happens inside _getAccount() which is async and called lazily.
    this._privateKey = privateKey;
    this.account = null as unknown as { address: `0x${string}`; signTypedData?: unknown };
  }

  private readonly _privateKey: string;
  private _account: { address: `0x${string}`; signTypedData?: unknown } | null = null;

  private async _getAccount(): Promise<{ address: `0x${string}`; signTypedData?: unknown }> {
    if (!this._account) {
      const { privateKeyToAccount } = await import('viem/accounts');
      this._account = privateKeyToAccount(this._privateKey as `0x${string}`);
    }
    return this._account;
  }

  private resolveRpcUrl(chainId: number, overrideRpcUrls?: Record<number, string>): string | undefined {
    return overrideRpcUrls?.[chainId] ?? this.defaultRpcUrls[chainId];
  }

  private async getTokenBalance(
    address: `0x${string}`,
    tokenAddress: string,
    chainId: number,
    overrideRpcUrls?: Record<number, string>,
  ): Promise<bigint> {
    const rpcUrl = this.resolveRpcUrl(chainId, overrideRpcUrls);
    if (!rpcUrl) {
      throw new Error(`No RPC configured for chain eip155:${chainId}`);
    }

    const { createPublicClient, http } = await import('viem');
    const client = createPublicClient({ transport: http(rpcUrl) });
    return client.readContract({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_BALANCE_ABI,
      functionName: 'balanceOf',
      args: [address],
    });
  }

  private async evaluateOffers(
    accepts: unknown[],
    overrideRpcUrls?: Record<number, string>,
  ): Promise<X402OfferEvaluation[]> {
    const account = await this._getAccount();

    return Promise.all(
      accepts.map(async (acceptRaw) => {
        const accept = asRecord(acceptRaw);
        const network = String(accept['network'] ?? '');
        const chainId = parseChainId(network);
        const amount = String(accept['amount'] ?? accept['maxAmountRequired'] ?? '0');
        const asset = String(accept['asset'] ?? USDC_ADDRESS);
        const recipient = String(accept['payTo'] ?? accept['recipient'] ?? '');
        const extra = asRecord(accept['extra']);
        const tokenName = typeof extra['tokenName'] === 'string'
          ? extra['tokenName']
          : typeof extra['name'] === 'string'
            ? extra['name']
            : undefined;
        const tokenVersion = typeof extra['tokenVersion'] === 'string'
          ? extra['tokenVersion']
          : typeof extra['version'] === 'string'
            ? extra['version']
            : undefined;

        if (!network || chainId === null) {
          return {
            network,
            chainId,
            amount,
            asset,
            recipient,
            tokenName,
            tokenVersion,
            supported: false,
            reason: 'Unsupported or non-EVM payment network',
          } satisfies X402OfferEvaluation;
        }

        try {
          const balance = await this.getTokenBalance(account.address, asset, chainId, overrideRpcUrls);
          const requiredAmount = BigInt(amount);
          return {
            network,
            chainId,
            amount,
            asset,
            recipient,
            tokenName,
            tokenVersion,
            supported: true,
            balance: balance.toString(),
            balanceSufficient: balance >= requiredAmount,
            reason: balance >= requiredAmount
              ? undefined
              : `Insufficient token balance: has ${balance.toString()}, needs ${requiredAmount.toString()}`,
          } satisfies X402OfferEvaluation;
        } catch (err) {
          return {
            network,
            chainId,
            amount,
            asset,
            recipient,
            tokenName,
            tokenVersion,
            supported: false,
            reason: err instanceof Error ? err.message : String(err),
          } satisfies X402OfferEvaluation;
        }
      }),
    );
  }

  private selectOffer(offers: X402OfferEvaluation[]): X402SelectedOffer | null {
    const fundedOffers = offers.filter(
      (offer) => offer.supported && offer.balanceSufficient === true && offer.chainId !== null,
    );

    if (this.preferredChainId !== null) {
      const preferred = fundedOffers.find((offer) => offer.chainId === this.preferredChainId);
      if (preferred) {
        return {
          network: preferred.network,
          chainId: preferred.chainId as number,
          amount: preferred.amount,
          asset: preferred.asset,
          recipient: preferred.recipient,
          [NAME_FIELD]: preferred.tokenName,
          [VERSION_FIELD]: preferred.tokenVersion,
        };
      }

      if (this.strictChainId) {
        return null;
      }
    }

    const firstFunded = fundedOffers[0];
    if (!firstFunded) return null;

    return {
      network: firstFunded.network,
      chainId: firstFunded.chainId as number,
      amount: firstFunded.amount,
      asset: firstFunded.asset,
      recipient: firstFunded.recipient,
      [NAME_FIELD]: firstFunded.tokenName,
      [VERSION_FIELD]: firstFunded.tokenVersion,
    };
  }

  private buildUnfundedMessage(offers: X402OfferEvaluation[]): string {
    if (this.preferredChainId !== null && this.strictChainId) {
      const preferredOffer = offers.find((offer) => offer.chainId === this.preferredChainId);
      if (!preferredOffer) {
        return `No payment offer for chain eip155:${this.preferredChainId}.`;
      }
      return preferredOffer.reason
        ? `No funded payment offer available on eip155:${this.preferredChainId}. ${preferredOffer.reason}`
        : `No funded payment offer available on eip155:${this.preferredChainId}.`;
    }

    const summaries = offers
      .map((offer) => `${offer.network || 'unknown'}: ${offer.reason ?? 'not funded'}`)
      .slice(0, 5)
      .join('; ');
    return summaries
      ? `No funded payment offer available. ${summaries}`
      : 'No funded payment offer available.';
  }

  private resolveSelectionFailure(offers: X402OfferEvaluation[]): {
    status: 'payment_unfunded' | 'payment_rejected';
    error: string;
  } {
    if (this.preferredChainId !== null && this.strictChainId) {
      const matchingOffers = offers.filter((offer) => offer.chainId === this.preferredChainId);
      if (matchingOffers.length === 0) {
        return {
          status: 'payment_rejected',
          error: `No payment offer for chain eip155:${this.preferredChainId}.`,
        };
      }

      const supportedMatches = matchingOffers.filter((offer) => offer.supported);
      if (supportedMatches.length === 0) {
        return {
          status: 'payment_rejected',
          error: matchingOffers[0]?.reason ?? `No supported payment offer available on eip155:${this.preferredChainId}.`,
        };
      }

      return {
        status: 'payment_unfunded',
        error: this.buildUnfundedMessage(offers),
      };
    }

    const supportedOffers = offers.filter((offer) => offer.supported);
    if (supportedOffers.length === 0) {
      const summaries = offers
        .map((offer) => `${offer.network || 'unknown'}: ${offer.reason ?? 'unsupported payment offer'}`)
        .slice(0, 5)
        .join('; ');
      return {
        status: 'payment_rejected',
        error: summaries
          ? `No supported EVM payment offer available. ${summaries}`
          : 'No supported EVM payment offer available.',
      };
    }

    return {
      status: 'payment_unfunded',
      error: this.buildUnfundedMessage(offers),
    };
  }

  async request(url: string, options: X402RequestOptions = {}): Promise<X402Response> {
    const { method = 'GET', headers = {}, body, autoPay = false } = options;
    const maxPaymentUsd = options.maxPaymentUsd ?? this.defaultMaxPaymentUsd;
    const rpcUrls = options.rpcUrls;

    // Build fetch options
    const fetchHeaders: Record<string, string> = { ...headers };
    let fetchBody: string | undefined;

    if (body !== undefined) {
      if (typeof body === 'object') {
        fetchBody = JSON.stringify(body);
        if (!fetchHeaders['Content-Type']) {
          fetchHeaders['Content-Type'] = 'application/json';
        }
      } else {
        fetchBody = body;
        // Auto-detect JSON string bodies and set Content-Type if not already set.
        // MCP tool args pass body as a string, so '{"key":"val"}' arrives as a
        // string — the server still needs Content-Type: application/json to parse it.
        if (!fetchHeaders['Content-Type'] && fetchBody.trimStart().startsWith('{')) {
          fetchHeaders['Content-Type'] = 'application/json';
        }
      }
    }

    const fetchOptions: RequestInit = {
      method,
      headers: fetchHeaders,
      ...(fetchBody !== undefined ? { body: fetchBody } : {}),
    };

    // First request
    const firstResponse = await fetch(url, fetchOptions);

    if (firstResponse.status !== 402) {
      if (firstResponse.ok) {
        let result: unknown;
        const contentType = firstResponse.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          result = await firstResponse.json();
        } else {
          result = await firstResponse.text();
        }
        return { success: true, status: 'ok', x402: false, result, httpStatus: firstResponse.status };
      }

      return {
        success: false,
        status: 'payment_failed',
        x402: false,
        error: `HTTP ${firstResponse.status}: ${firstResponse.statusText}`,
        httpStatus: firstResponse.status,
      };
    }

    // 402 Payment Required
    let paymentBody: Record<string, unknown>;
    try {
      paymentBody = await firstResponse.json();
    } catch {
      return {
        success: false,
        status: 'payment_failed',
        x402: true,
        error: 'Failed to parse 402 payment details',
        httpStatus: 402,
      };
    }

    const accepts = (paymentBody['accepts'] as unknown[]) ?? [];
    const usableOffers = await this.evaluateOffers(accepts, rpcUrls);
    const selectedOffer = this.selectOffer(usableOffers);

    if (!autoPay) {
      return {
        success: false,
        status: 'payment_required',
        x402: true,
        httpStatus: 402,
        paymentDetails: paymentBody,
        usableOffers,
        selectedOffer: selectedOffer ?? undefined,
        paymentAttempted: false,
      };
    }

    if (!selectedOffer) {
      const failure = this.resolveSelectionFailure(usableOffers);
      return {
        success: false,
        status: failure.status,
        x402: true,
        error: failure.error,
        httpStatus: 402,
        paymentDetails: paymentBody,
        usableOffers,
        paymentAttempted: false,
      };
    }

    // Safety: check amount vs maxPaymentUsd
    const amountBaseUnits = selectedOffer.amount;
    const amountUsd = Number(amountBaseUnits) / 1_000_000;

    if (amountUsd > maxPaymentUsd) {
      return {
        success: false,
        status: 'payment_rejected',
        x402: true,
        error: `Payment amount $${amountUsd.toFixed(6)} exceeds maxPaymentUsd $${maxPaymentUsd}`,
        httpStatus: 402,
        paymentDetails: paymentBody,
        usableOffers,
        selectedOffer,
        paymentAttempted: false,
      };
    }

    // Build PaymentRequirements from the match
    const requirements: PaymentRequirements = {
      amount: amountBaseUnits,
      recipient: selectedOffer.recipient,
      usdcContract: selectedOffer.asset || USDC_ADDRESS,
      network: selectedOffer.network,
      chainId: selectedOffer.chainId,
      [NAME_FIELD]: selectedOffer.tokenName,
      [VERSION_FIELD]: selectedOffer.tokenVersion,
    };

    // Sign the payment using the existing SDK signer (no duplicated EIP-712 logic)
    const account = await this._getAccount();
    let signResult: { header: string; receipt: { from: string; to: string } };
    try {
      signResult = await signPayment(account, requirements);
    } catch (err) {
      return {
        success: false,
        status: 'payment_failed',
        x402: true,
        error: `Payment signing failed: ${err instanceof Error ? err.message : String(err)}`,
        httpStatus: 402,
        paymentDetails: paymentBody,
        usableOffers,
        selectedOffer,
        paymentAttempted: false,
      };
    }

    // Retry with payment headers
    const paymentHeaders: Record<string, string> = {
      ...fetchHeaders,
      'X-PAYMENT': signResult.header,
      'PAYMENT-SIGNATURE': signResult.header,
    };

    const retryResponse = await fetch(url, {
      ...fetchOptions,
      headers: paymentHeaders,
    });

    let result: unknown;
    try {
      const contentType = retryResponse.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        result = await retryResponse.json();
      } else {
        result = await retryResponse.text();
      }
    } catch {
      result = null;
    }

    if (retryResponse.ok) {
      return {
        success: true,
        status: 'paid',
        x402: true,
        result,
        httpStatus: retryResponse.status,
        payment: {
          amount: amountBaseUnits,
          network: selectedOffer.network,
          from: signResult.receipt.from,
          to: signResult.receipt.to,
        },
        usableOffers,
        selectedOffer,
        paymentAttempted: true,
      };
    }

    const serverReason = extractFailureReason(result);

    return {
      success: false,
      status: 'payment_failed',
      x402: true,
      error: serverReason
        ? `Payment failed: ${serverReason}`
        : `Payment submitted but server returned HTTP ${retryResponse.status}`,
      serverReason,
      httpStatus: retryResponse.status,
      result,
      paymentDetails: paymentBody,
      usableOffers,
      selectedOffer,
      paymentAttempted: true,
    };
  }
}
