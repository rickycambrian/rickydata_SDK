import type { AuthManager } from './auth.js';
import type { Tool, ToolResult, PaymentRequirements, SpendingSummary } from './types/index.js';
import type { EIP712SignedOffer, EIP712SignedReceipt, ServerReceipt } from './types/offer-receipt.js';
import type { SpendingWallet } from './wallet/spending-wallet.js';
import {
  extractOffersFromPaymentData,
  extractReceiptFromHeader,
  extractReceiptFromPaymentData,
} from './payment/offer-receipt-verifier.js';

// Minimal interface for receipt recording — avoids tight coupling to SpendingWallet
interface ReceiptRecordable {
  recordServerReceipt(receipt: ServerReceipt): void;
}

export class ToolsManager {
  constructor(
    private baseUrl: string,
    private auth: AuthManager,
    private wallet: SpendingWallet | null,
    private autoSign: boolean,
  ) {}

  getSpending(): SpendingSummary {
    if (!this.wallet) {
      return { totalSpent: 0, sessionSpent: 0, daySpent: 0, weekSpent: 0, callCount: 0 };
    }
    return this.wallet.getSpending();
  }

  async listTools(serverId: string): Promise<Tool[]> {
    const res = await this.auth.fetchWithAuth(
      `${this.baseUrl}/api/servers/${serverId}/tools`,
      undefined,
      { retryOn401: true }
    );

    if (!res.ok) {
      throw new Error(`Failed to list tools: ${res.status}`);
    }
    const data = await res.json();
    return data.tools ?? [];
  }

  private static readonly FETCH_TIMEOUT_MS = 60_000; // 60s timeout

  private async fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ToolsManager.FETCH_TIMEOUT_MS);
    try {
      return await this.auth.fetchWithAuth(
        url,
        { ...init, signal: controller.signal },
        { retryOn401: true }
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async callTool(serverId: string, tool: string, args: Record<string, unknown>): Promise<ToolResult> {
    const url = `${this.baseUrl}/api/servers/${serverId}/tools/${tool}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    let res = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(args),
    });

    // Holds the signed offer from the 402 response for pairing with the eventual receipt
    let pendingOffer: EIP712SignedOffer | undefined;

    // Handle x402 payment required (single retry only — never loop)
    if (res.status === 402 && this.autoSign && this.wallet) {
      const paymentData = await res.json();

      // Extract signed offers from extensions (additive — no-op if absent)
      const offers: EIP712SignedOffer[] = extractOffersFromPaymentData(paymentData);
      pendingOffer = offers[0];

      // Parse the x402 v2 response format
      const accept = paymentData.accepts?.[0];
      if (!accept) {
        throw new Error('402 response missing accepts array');
      }

      // Parse network: support both CAIP-2 ("eip155:8453") and legacy ("base")
      const networkStr = accept.network ?? 'eip155:8453';
      let chainId: number;
      if (networkStr.startsWith('eip155:')) {
        chainId = parseInt(networkStr.split(':')[1], 10);
      } else if (networkStr === 'base-sepolia') {
        chainId = 84532;
      } else {
        chainId = 8453;
      }

      const requirements: PaymentRequirements = {
        amount: accept.maxAmountRequired ?? accept.amount ?? '0',
        recipient: accept.payTo ?? '',
        usdcContract: accept.asset ?? '',
        network: networkStr,
        chainId,
        tokenName: accept.extra?.name ?? 'USD Coin',
        tokenVersion: accept.extra?.version ?? '2',
      };

      // Sign via SpendingWallet (validates policy, signs, tracks)
      let paymentHeader: string;
      try {
        const signed = await this.wallet.signPayment(requirements, this.baseUrl, tool);
        paymentHeader = signed.header;
      } catch (err) {
        this.wallet.recordFailure();
        throw err;
      }

      // Retry with payment (exactly once — if this also 402s, fall through to error)
      res = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          ...headers,
          'PAYMENT-SIGNATURE': paymentHeader, // x402 v2
          'X-Payment': paymentHeader,          // v1 backward compatibility
        },
        body: JSON.stringify(args),
      });
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Tool call failed: ${res.status} ${text}`);
    }

    const data = await res.json();

    // Extract receipt from PAYMENT-RESPONSE header (HTTP routes)
    const paymentResponseHeader = res.headers?.get('PAYMENT-RESPONSE');
    let serverReceipt: EIP712SignedReceipt | null = null;
    if (paymentResponseHeader) {
      serverReceipt = extractReceiptFromHeader(paymentResponseHeader);
    }
    // Also check _payment.receipt (MCP protocol path)
    if (!serverReceipt) {
      serverReceipt = extractReceiptFromPaymentData(data);
    }

    // Record server receipt in SpendingTracker if present
    if (serverReceipt && this.wallet) {
      const entry: ServerReceipt = {
        receipt: serverReceipt,
        offer: pendingOffer,
        toolName: tool,
        serverId,
        receivedAt: Date.now(),
      };
      (this.wallet as unknown as ReceiptRecordable).recordServerReceipt(entry);
    }

    return {
      content: data.content ?? data.result ?? data,
      isError: data.isError ?? false,
      payment: data.payment,
    };
  }
}
