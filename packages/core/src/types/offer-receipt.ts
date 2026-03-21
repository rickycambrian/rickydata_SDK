export interface OfferPayload {
  version: number;
  resourceUrl: string;
  scheme: string;
  network: string;
  asset: string;
  payTo: string;
  amount: string;
  validUntil: number;
}

export interface EIP712SignedOffer {
  format: "eip712";
  acceptIndex?: number;
  payload: OfferPayload;
  signature: string; // 0x-prefixed hex
  signer?: string;   // optional — gateway may include the recovered signer address
}

export interface ReceiptPayload {
  version: number;
  network: string;
  resourceUrl: string;
  payer: string;
  issuedAt: number;
  transaction: string; // txHash or "" if not included
}

export interface EIP712SignedReceipt {
  format: "eip712";
  payload: ReceiptPayload;
  signature: string;
  signer?: string;  // optional — gateway may include the recovered signer address
}

export interface ServerReceipt {
  offer?: EIP712SignedOffer;
  receipt: EIP712SignedReceipt;
  toolName?: string;
  serverId?: string;
  receivedAt: number;
}
