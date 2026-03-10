import type { PaymentRequirements, PaymentReceipt } from '../types/payment.js';
import { USDC_TOKEN_NAME, USDC_TOKEN_VERSION, BASE_CHAIN_ID } from '../constants.js';
import { PaymentSigningError } from '../errors/index.js';

/**
 * Sign an EIP-3009 TransferWithAuthorization payment.
 * Extracted from the original payment.ts to work with viem Account objects.
 *
 * @param account - viem Account (from privateKeyToAccount or mnemonicToAccount)
 * @param requirements - Payment requirements from 402 response
 * @returns Base64-encoded X-Payment header and a PaymentReceipt
 */
export async function signPayment(
  account: { address: `0x${string}`; signTypedData?: unknown },
  requirements: PaymentRequirements,
): Promise<{ header: string; receipt: PaymentReceipt }> {
  const { createWalletClient, http } = await import('viem');
  const { base } = await import('viem/chains');

  // Cast account to the expected viem type — it comes from privateKeyToAccount/mnemonicToAccount
  const viemAccount = account as Parameters<typeof createWalletClient>[0]['account'];
  const client = createWalletClient({
    account: viemAccount,
    chain: base,
    transport: http(),
  });

  const domain = {
    name: requirements.tokenName ?? USDC_TOKEN_NAME,
    version: requirements.tokenVersion ?? USDC_TOKEN_VERSION,
    chainId: BigInt(requirements.chainId),
    verifyingContract: requirements.usdcContract as `0x${string}`,
  } as const;

  const nonce = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}` as `0x${string}`;
  const validAfter = 0n;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour

  const amountBaseUnits = BigInt(requirements.amount);
  // Convert base units to USD: amount / 10^6
  const amountUsd = Number(amountBaseUnits) / 1_000_000;

  const types = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  } as const;

  const message = {
    from: account.address,
    to: requirements.recipient as `0x${string}`,
    value: amountBaseUnits,
    validAfter,
    validBefore,
    nonce,
  } as const;

  let signature: string;
  try {
    signature = await client.signTypedData({
      account: viemAccount!,
      domain,
      types,
      primaryType: 'TransferWithAuthorization',
      message,
    });
  } catch (err) {
    throw new PaymentSigningError(`Failed to sign payment: ${err instanceof Error ? err.message : String(err)}`);
  }

  // x402 v2 payment proof with protocol metadata
  const paymentProof = {
    x402Version: 2,
    scheme: 'exact',
    network: `eip155:${requirements.chainId}`,
    payload: {
      signature,
      authorization: {
        from: account.address,
        to: requirements.recipient,
        value: amountBaseUnits.toString(),
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce,
      },
    },
  };

  const header = btoa(JSON.stringify(paymentProof));

  const receipt: PaymentReceipt = {
    timestamp: Date.now(),
    amountUsd,
    amountBaseUnits: amountBaseUnits.toString(),
    from: account.address,
    to: requirements.recipient,
    nonce,
    signature,
    success: true,
  };

  return { header, receipt };
}
