import type { PaymentRequirements } from '../types/payment.js';
import { signPayment } from './payment-signer.js';
import { BASE_CHAIN_ID, USDC_ADDRESS } from '../constants.js';

export interface X402RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | object;
  autoPay?: boolean;
  maxPaymentUsd?: number;
}

export interface X402Response {
  success: boolean;
  status: 'ok' | 'paid' | 'payment_required' | 'payment_failed' | 'payment_rejected';
  x402: boolean;
  result?: unknown;
  payment?: { amount: string; network: string; from: string; to: string };
  error?: string;
  httpStatus?: number;
  paymentDetails?: unknown;
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
  private readonly chainId: number;
  private readonly defaultMaxPaymentUsd: number;

  constructor(privateKey: string, options?: { chainId?: number; maxPaymentUsd?: number }) {
    // Lazy-import privateKeyToAccount so this module is safe to import server-side
    // without viem being called at module load time. We initialize synchronously by
    // storing raw privateKey and deriving account on first use.
    this.chainId = options?.chainId ?? BASE_CHAIN_ID;
    this.defaultMaxPaymentUsd = options?.maxPaymentUsd ?? 1.0;

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

  async request(url: string, options: X402RequestOptions = {}): Promise<X402Response> {
    const { method = 'GET', headers = {}, body, autoPay = false } = options;
    const maxPaymentUsd = options.maxPaymentUsd ?? this.defaultMaxPaymentUsd;

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

    if (!autoPay) {
      return {
        success: false,
        status: 'payment_required',
        x402: true,
        httpStatus: 402,
        paymentDetails: paymentBody,
      };
    }

    // Find a matching chain offer
    const networkKey = `eip155:${this.chainId}`;
    const match = accepts.find(
      (a) => (a as Record<string, unknown>)['network'] === networkKey,
    ) as Record<string, unknown> | undefined;

    if (!match) {
      return {
        success: false,
        status: 'payment_rejected',
        x402: true,
        error: `No payment offer for chain ${networkKey}. Available: ${accepts.map((a) => (a as Record<string, unknown>)['network']).join(', ')}`,
        httpStatus: 402,
        paymentDetails: paymentBody,
      };
    }

    // Safety: check amount vs maxPaymentUsd
    const amountBaseUnits = String(match['amount'] ?? '0');
    const amountUsd = Number(amountBaseUnits) / 1_000_000;

    if (amountUsd > maxPaymentUsd) {
      return {
        success: false,
        status: 'payment_rejected',
        x402: true,
        error: `Payment amount $${amountUsd.toFixed(6)} exceeds maxPaymentUsd $${maxPaymentUsd}`,
        httpStatus: 402,
        paymentDetails: paymentBody,
      };
    }

    // Build PaymentRequirements from the match
    const extra = (match['extra'] ?? {}) as Record<string, unknown>;
    const requirements: PaymentRequirements = {
      amount: amountBaseUnits,
      recipient: String(match['payTo'] ?? match['recipient'] ?? ''),
      usdcContract: String(match['asset'] ?? USDC_ADDRESS),
      network: networkKey,
      chainId: this.chainId,
      tokenName: extra['tokenName'] ? String(extra['tokenName']) : undefined,
      tokenVersion: extra['tokenVersion'] ? String(extra['tokenVersion']) : undefined,
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
          network: networkKey,
          from: signResult.receipt.from,
          to: signResult.receipt.to,
        },
      };
    }

    return {
      success: false,
      status: 'payment_failed',
      x402: true,
      error: `Payment submitted but server returned HTTP ${retryResponse.status}`,
      httpStatus: retryResponse.status,
      result,
    };
  }
}
