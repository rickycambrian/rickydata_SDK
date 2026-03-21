import { recoverTypedDataAddress } from 'viem';
import type { EIP712SignedOffer, EIP712SignedReceipt } from '../types/offer-receipt.js';

export const OFFER_EIP712_DOMAIN = { name: "x402 offer" as const, version: "1" as const, chainId: 1 };
export const OFFER_EIP712_TYPES = {
  Offer: [
    { name: "version", type: "uint256" },
    { name: "resourceUrl", type: "string" },
    { name: "scheme", type: "string" },
    { name: "network", type: "string" },
    { name: "asset", type: "string" },
    { name: "payTo", type: "string" },
    { name: "amount", type: "string" },
    { name: "validUntil", type: "uint256" },
  ],
} as const;

export const RECEIPT_EIP712_DOMAIN = { name: "x402 receipt" as const, version: "1" as const, chainId: 1 };
export const RECEIPT_EIP712_TYPES = {
  Receipt: [
    { name: "version", type: "uint256" },
    { name: "network", type: "string" },
    { name: "resourceUrl", type: "string" },
    { name: "payer", type: "string" },
    { name: "issuedAt", type: "uint256" },
    { name: "transaction", type: "string" },
  ],
} as const;

export async function verifyOfferSignature(
  offer: EIP712SignedOffer,
): Promise<{ valid: boolean; signerAddress: string }> {
  const address = await recoverTypedDataAddress({
    domain: OFFER_EIP712_DOMAIN,
    types: OFFER_EIP712_TYPES,
    primaryType: 'Offer',
    message: {
      version: BigInt(offer.payload.version),
      resourceUrl: offer.payload.resourceUrl,
      scheme: offer.payload.scheme,
      network: offer.payload.network,
      asset: offer.payload.asset,
      payTo: offer.payload.payTo,
      amount: offer.payload.amount,
      validUntil: BigInt(offer.payload.validUntil),
    },
    signature: offer.signature as `0x${string}`,
  });
  return { valid: true, signerAddress: address };
}

export async function verifyReceiptSignature(
  receipt: EIP712SignedReceipt,
): Promise<{ valid: boolean; signerAddress: string }> {
  const address = await recoverTypedDataAddress({
    domain: RECEIPT_EIP712_DOMAIN,
    types: RECEIPT_EIP712_TYPES,
    primaryType: 'Receipt',
    message: {
      version: BigInt(receipt.payload.version),
      network: receipt.payload.network,
      resourceUrl: receipt.payload.resourceUrl,
      payer: receipt.payload.payer,
      issuedAt: BigInt(receipt.payload.issuedAt),
      transaction: receipt.payload.transaction,
    },
    signature: receipt.signature as `0x${string}`,
  });
  return { valid: true, signerAddress: address };
}

export function extractOffersFromPaymentData(data: unknown): EIP712SignedOffer[] {
  return (data as any)?.extensions?.['offer-receipt']?.info?.offers ?? [];
}

export function extractReceiptFromHeader(headerValue: string): EIP712SignedReceipt | null {
  try {
    const decoded = JSON.parse(atob(headerValue));
    return decoded?.extensions?.['offer-receipt']?.info?.receipt ?? null;
  } catch {
    return null;
  }
}

export function extractReceiptFromPaymentData(data: unknown): EIP712SignedReceipt | null {
  return (data as any)?._payment?.receipt ?? null;
}

/** Verify a receipt matches the original offer and payer addresses. */
export function verifyReceiptMatchesOffer(
  receipt: EIP712SignedReceipt,
  offer: EIP712SignedOffer,
  payerAddresses: string[],
): boolean {
  // Network must match
  if (receipt.payload.network !== offer.payload.network) return false;
  // Payer must be one of the allowed addresses (case-insensitive)
  const payerLower = receipt.payload.payer.toLowerCase();
  if (!payerAddresses.some((a) => a.toLowerCase() === payerLower)) return false;
  // issuedAt must be within the last hour (3600 seconds)
  const nowSec = Math.floor(Date.now() / 1000);
  if (receipt.payload.issuedAt > nowSec || receipt.payload.issuedAt < nowSec - 3600) return false;
  return true;
}
