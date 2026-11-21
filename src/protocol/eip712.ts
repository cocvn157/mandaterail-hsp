import {
  hashTypedData,
  keccak256,
  recoverTypedDataAddress,
  stringToHex,
  verifyTypedData,
  type Hex
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface PaymentMandate {
  buyerAgent: `0x${string}`;
  providerAgent: `0x${string}`;
  token: `0x${string}`;
  amount: bigint;
  maxPerTx: bigint;
  dailyCap: bigint;
  nonce: bigint;
  validAfter: bigint;
  validBefore: bigint;
  taskHash: `0x${string}`;
}

export interface MandateDomain {
  name: "MandateRail HSP";
  version: "1";
  chainId: number;
  verifyingContract: `0x${string}`;
}

export const PAYMENT_MANDATE_TYPE_STRING =
  "PaymentMandate(address buyerAgent,address providerAgent,address token,uint256 amount,uint256 maxPerTx,uint256 dailyCap,uint256 nonce,uint256 validAfter,uint256 validBefore,bytes32 taskHash)";

export const PAYMENT_MANDATE_TYPEHASH: `0x${string}` = keccak256(stringToHex(PAYMENT_MANDATE_TYPE_STRING));

export const MANDATE_EIP712_TYPES = {
  PaymentMandate: [
    { name: "buyerAgent", type: "address" },
    { name: "providerAgent", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "maxPerTx", type: "uint256" },
    { name: "dailyCap", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "taskHash", type: "bytes32" }
  ]
} as const;

export function buildMandateDomain(chainId: number, verifyingContract: `0x${string}`): MandateDomain {
  return {
    name: "MandateRail HSP",
    version: "1",
    chainId,
    verifyingContract
  };
}

export function computeMandateDigest(domain: MandateDomain, mandate: PaymentMandate): `0x${string}` {
  return hashTypedData({
    domain,
    types: MANDATE_EIP712_TYPES,
    primaryType: "PaymentMandate",
    message: mandate
  });
}

export async function signPaymentMandate(
  privateKey: Hex,
  domain: MandateDomain,
  mandate: PaymentMandate
): Promise<{ signature: `0x${string}`; digest: `0x${string}`; signer: `0x${string}` }> {
  const account = privateKeyToAccount(privateKey);
  const signature = await account.signTypedData({
    domain,
    types: MANDATE_EIP712_TYPES,
    primaryType: "PaymentMandate",
    message: mandate
  });
  const digest = computeMandateDigest(domain, mandate);
  return {
    signature,
    digest,
    signer: account.address
  };
}

export async function recoverMandateSigner(
  domain: MandateDomain,
  mandate: PaymentMandate,
  signature: `0x${string}`
): Promise<`0x${string}`> {
  return recoverTypedDataAddress({
    domain,
    types: MANDATE_EIP712_TYPES,
    primaryType: "PaymentMandate",
    message: mandate,
    signature
  });
}

export async function verifyPaymentMandateSignature(
  domain: MandateDomain,
  mandate: PaymentMandate,
  signature: `0x${string}`,
  expectedSigner: `0x${string}` = mandate.buyerAgent
): Promise<boolean> {
  try {
    return await verifyTypedData({
      address: expectedSigner,
      domain,
      types: MANDATE_EIP712_TYPES,
      primaryType: "PaymentMandate",
      message: mandate,
      signature
    });
  } catch {
    return false;
  }
}

export function hashCanonicalTaskPayload(payload: Record<string, unknown>): `0x${string}` {
  const sorted = sortObjectKeys(payload);
  return keccak256(stringToHex(JSON.stringify(sorted)));
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const ordered: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      ordered[key] = sortObjectKeys(record[key]);
    }
    return ordered;
  }
  return value;
}

export function serializeMandateForJson(mandate: PaymentMandate): Record<string, string> {
  return {
    buyerAgent: mandate.buyerAgent,
    providerAgent: mandate.providerAgent,
    token: mandate.token,
    amount: mandate.amount.toString(),
    maxPerTx: mandate.maxPerTx.toString(),
    dailyCap: mandate.dailyCap.toString(),
    nonce: mandate.nonce.toString(),
    validAfter: mandate.validAfter.toString(),
    validBefore: mandate.validBefore.toString(),
    taskHash: mandate.taskHash
  };
}

export function deserializeMandateFromJson(raw: Record<string, string>): PaymentMandate {
  const requiredFields = [
    "buyerAgent",
    "providerAgent",
    "token",
    "amount",
    "maxPerTx",
    "dailyCap",
    "nonce",
    "validAfter",
    "validBefore",
    "taskHash"
  ];
  for (const field of requiredFields) {
    if (typeof raw[field] !== "string" || raw[field].length === 0) {
      throw new Error(`Missing mandate field: ${field}`);
    }
  }
  return {
    buyerAgent: raw.buyerAgent as `0x${string}`,
    providerAgent: raw.providerAgent as `0x${string}`,
    token: raw.token as `0x${string}`,
    amount: BigInt(raw.amount),
    maxPerTx: BigInt(raw.maxPerTx),
    dailyCap: BigInt(raw.dailyCap),
    nonce: BigInt(raw.nonce),
    validAfter: BigInt(raw.validAfter),
    validBefore: BigInt(raw.validBefore),
    taskHash: raw.taskHash as `0x${string}`
  };
}
