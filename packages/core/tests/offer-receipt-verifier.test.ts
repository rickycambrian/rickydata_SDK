import { describe, it, expect } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { signTypedData } from 'viem/actions';
import { createWalletClient, http } from 'viem';
import { mainnet } from 'viem/chains';

import {
  OFFER_EIP712_DOMAIN,
  OFFER_EIP712_TYPES,
  RECEIPT_EIP712_DOMAIN,
  RECEIPT_EIP712_TYPES,
  verifyOfferSignature,
  verifyReceiptSignature,
  verifyReceiptMatchesOffer,
  extractOffersFromPaymentData,
  extractReceiptFromHeader,
  extractReceiptFromPaymentData,
} from '../src/payment/offer-receipt-verifier.js';
import type { EIP712SignedOffer, EIP712SignedReceipt, OfferPayload, ReceiptPayload } from '../src/types/offer-receipt.js';

// Generate a random test account (not a real key — fresh per test run)
const testAccount = privateKeyToAccount(generatePrivateKey());

async function signOffer(payload: OfferPayload): Promise<string> {
  const client = createWalletClient({ account: testAccount, chain: mainnet, transport: http() });
  return client.signTypedData({
    account: testAccount,
    domain: OFFER_EIP712_DOMAIN,
    types: OFFER_EIP712_TYPES,
    primaryType: 'Offer',
    message: {
      version: BigInt(payload.version),
      resourceUrl: payload.resourceUrl,
      scheme: payload.scheme,
      network: payload.network,
      asset: payload.asset,
      payTo: payload.payTo,
      amount: payload.amount,
      validUntil: BigInt(payload.validUntil),
    },
  });
}

async function signReceipt(payload: ReceiptPayload): Promise<string> {
  const client = createWalletClient({ account: testAccount, chain: mainnet, transport: http() });
  return client.signTypedData({
    account: testAccount,
    domain: RECEIPT_EIP712_DOMAIN,
    types: RECEIPT_EIP712_TYPES,
    primaryType: 'Receipt',
    message: {
      version: BigInt(payload.version),
      network: payload.network,
      resourceUrl: payload.resourceUrl,
      payer: payload.payer,
      issuedAt: BigInt(payload.issuedAt),
      transaction: payload.transaction,
    },
  });
}

const SAMPLE_OFFER_PAYLOAD: OfferPayload = {
  version: 1,
  resourceUrl: 'https://mcp.rickydata.org/api/servers/brave/tools/search',
  scheme: 'exact',
  network: 'eip155:8453',
  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  payTo: '0x2c241F8509BB6a7b672a440DFebd332cB0B258DE',
  amount: '500',
  validUntil: 9999999999,
};

const SAMPLE_RECEIPT_PAYLOAD: ReceiptPayload = {
  version: 1,
  network: 'eip155:8453',
  resourceUrl: 'https://mcp.rickydata.org/api/servers/brave/tools/search',
  payer: testAccount.address,
  issuedAt: Math.floor(Date.now() / 1000),
  transaction: '0xdeadbeef',
};

describe('verifyOfferSignature', () => {
  it('recovers the correct signer address', async () => {
    const signature = await signOffer(SAMPLE_OFFER_PAYLOAD);
    const offer: EIP712SignedOffer = {
      format: 'eip712',
      payload: SAMPLE_OFFER_PAYLOAD,
      signature,
    };
    const { valid, signerAddress } = await verifyOfferSignature(offer);
    expect(valid).toBe(true);
    expect(signerAddress.toLowerCase()).toBe(testAccount.address.toLowerCase());
  });

  it('returns a different signer address for a wrong signature', async () => {
    // Sign with different payload data
    const altPayload = { ...SAMPLE_OFFER_PAYLOAD, amount: '9999' };
    const signature = await signOffer(altPayload);
    const offer: EIP712SignedOffer = {
      format: 'eip712',
      payload: SAMPLE_OFFER_PAYLOAD, // original payload — mismatch
      signature,
    };
    // recoverTypedDataAddress does not throw; it just recovers a different address
    const { signerAddress } = await verifyOfferSignature(offer);
    expect(signerAddress.toLowerCase()).not.toBe(testAccount.address.toLowerCase());
  });
});

describe('verifyReceiptSignature', () => {
  it('recovers the correct signer address', async () => {
    const signature = await signReceipt(SAMPLE_RECEIPT_PAYLOAD);
    const receipt: EIP712SignedReceipt = {
      format: 'eip712',
      payload: SAMPLE_RECEIPT_PAYLOAD,
      signature,
    };
    const { valid, signerAddress } = await verifyReceiptSignature(receipt);
    expect(valid).toBe(true);
    expect(signerAddress.toLowerCase()).toBe(testAccount.address.toLowerCase());
  });
});

describe('verifyReceiptMatchesOffer', () => {
  const offer: EIP712SignedOffer = {
    format: 'eip712',
    payload: SAMPLE_OFFER_PAYLOAD,
    signature: '0x00',
  };

  it('returns true when network matches, payer is allowed, and issuedAt is recent', () => {
    const receipt: EIP712SignedReceipt = {
      format: 'eip712',
      payload: {
        ...SAMPLE_RECEIPT_PAYLOAD,
        issuedAt: Math.floor(Date.now() / 1000),
      },
      signature: '0x00',
    };
    expect(verifyReceiptMatchesOffer(receipt, offer, [testAccount.address])).toBe(true);
  });

  it('returns false when networks differ', () => {
    const receipt: EIP712SignedReceipt = {
      format: 'eip712',
      payload: {
        ...SAMPLE_RECEIPT_PAYLOAD,
        network: 'eip155:1',
        issuedAt: Math.floor(Date.now() / 1000),
      },
      signature: '0x00',
    };
    expect(verifyReceiptMatchesOffer(receipt, offer, [testAccount.address])).toBe(false);
  });

  it('returns false when payer is not in allowed list', () => {
    const receipt: EIP712SignedReceipt = {
      format: 'eip712',
      payload: {
        ...SAMPLE_RECEIPT_PAYLOAD,
        payer: '0x000000000000000000000000000000000000dead',
        issuedAt: Math.floor(Date.now() / 1000),
      },
      signature: '0x00',
    };
    expect(verifyReceiptMatchesOffer(receipt, offer, [testAccount.address])).toBe(false);
  });

  it('returns false when issuedAt is more than 1 hour old', () => {
    const receipt: EIP712SignedReceipt = {
      format: 'eip712',
      payload: {
        ...SAMPLE_RECEIPT_PAYLOAD,
        issuedAt: Math.floor(Date.now() / 1000) - 3700,
      },
      signature: '0x00',
    };
    expect(verifyReceiptMatchesOffer(receipt, offer, [testAccount.address])).toBe(false);
  });

  it('returns false when issuedAt is in the future', () => {
    const receipt: EIP712SignedReceipt = {
      format: 'eip712',
      payload: {
        ...SAMPLE_RECEIPT_PAYLOAD,
        issuedAt: Math.floor(Date.now() / 1000) + 60,
      },
      signature: '0x00',
    };
    expect(verifyReceiptMatchesOffer(receipt, offer, [testAccount.address])).toBe(false);
  });

  it('is case-insensitive for payer address comparison', () => {
    const receipt: EIP712SignedReceipt = {
      format: 'eip712',
      payload: {
        ...SAMPLE_RECEIPT_PAYLOAD,
        payer: testAccount.address.toUpperCase(),
        issuedAt: Math.floor(Date.now() / 1000),
      },
      signature: '0x00',
    };
    expect(verifyReceiptMatchesOffer(receipt, offer, [testAccount.address.toLowerCase()])).toBe(true);
  });
});

describe('extractOffersFromPaymentData', () => {
  it('returns offers from extensions field', () => {
    const offer: EIP712SignedOffer = {
      format: 'eip712',
      payload: SAMPLE_OFFER_PAYLOAD,
      signature: '0xabc',
    };
    const data = {
      accepts: [{}],
      extensions: {
        'offer-receipt': {
          info: { offers: [offer] },
        },
      },
    };
    const result = extractOffersFromPaymentData(data);
    expect(result).toHaveLength(1);
    expect(result[0].signature).toBe('0xabc');
  });

  it('returns empty array when extensions is absent', () => {
    const data = { accepts: [{}], x402Version: 2 };
    expect(extractOffersFromPaymentData(data)).toEqual([]);
  });

  it('returns empty array when offer-receipt key is missing', () => {
    const data = { extensions: {} };
    expect(extractOffersFromPaymentData(data)).toEqual([]);
  });

  it('returns empty array for null/undefined input', () => {
    expect(extractOffersFromPaymentData(null)).toEqual([]);
    expect(extractOffersFromPaymentData(undefined)).toEqual([]);
  });
});

describe('extractReceiptFromHeader', () => {
  it('extracts receipt from valid base64-encoded header', () => {
    const receipt: EIP712SignedReceipt = {
      format: 'eip712',
      payload: SAMPLE_RECEIPT_PAYLOAD,
      signature: '0xreceipt',
    };
    const headerValue = btoa(JSON.stringify({
      extensions: {
        'offer-receipt': {
          info: { receipt },
        },
      },
    }));
    const result = extractReceiptFromHeader(headerValue);
    expect(result).not.toBeNull();
    expect(result!.signature).toBe('0xreceipt');
  });

  it('returns null for invalid base64', () => {
    expect(extractReceiptFromHeader('not-valid-base64!!!')).toBeNull();
  });

  it('returns null when receipt key is absent', () => {
    const headerValue = btoa(JSON.stringify({ extensions: {} }));
    expect(extractReceiptFromHeader(headerValue)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractReceiptFromHeader('')).toBeNull();
  });
});

describe('extractReceiptFromPaymentData', () => {
  it('extracts receipt from _payment.receipt', () => {
    const receipt: EIP712SignedReceipt = {
      format: 'eip712',
      payload: SAMPLE_RECEIPT_PAYLOAD,
      signature: '0xmcp',
    };
    const data = { _payment: { receipt } };
    const result = extractReceiptFromPaymentData(data);
    expect(result).not.toBeNull();
    expect(result!.signature).toBe('0xmcp');
  });

  it('returns null when _payment is absent', () => {
    expect(extractReceiptFromPaymentData({ content: 'result' })).toBeNull();
  });

  it('returns null for null input', () => {
    expect(extractReceiptFromPaymentData(null)).toBeNull();
  });
});
