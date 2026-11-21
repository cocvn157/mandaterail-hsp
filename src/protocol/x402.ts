import {
  deserializeMandateFromJson,
  serializeMandateForJson,
  type PaymentMandate
} from "./eip712";
import type { HskNetworkKey } from "./networks";

export const X402_SCHEME = "hsp-mandate-eip712" as const;

export interface X402Challenge {
  version: "1.0";
  scheme: typeof X402_SCHEME;
  network: HskNetworkKey;
  chainId: number;
  resource: string;
  payTo: `0x${string}`;
  token: `0x${string}`;
  tokenSymbol: string;
  amount: string;
  taskHash: `0x${string}`;
  verifyingContract: `0x${string}`;
  expiresAt: number;
  suggestedNonce: string;
}

export interface X402PaymentPayload {
  version: "1.0";
  scheme: typeof X402_SCHEME;
  network: HskNetworkKey;
  chainId: number;
  verifyingContract: `0x${string}`;
  mandate: Record<string, string>;
  signature: `0x${string}`;
  signer: `0x${string}`;
}

export interface Http402ResponseFrame {
  status: 402;
  statusText: "Payment Required";
  headers: {
    "Content-Type": "application/json";
    "X-PAYMENT-REQUIRED": string;
  };
  challenge: X402Challenge;
}

function encodeBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(encoded: string): string {
  const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLen);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

export function buildPaymentRequiredResponse(params: Omit<X402Challenge, "version" | "scheme">): Http402ResponseFrame {
  const challenge: X402Challenge = {
    version: "1.0",
    scheme: X402_SCHEME,
    ...params
  };
  const headerValue = encodeBase64Url(JSON.stringify(challenge));
  return {
    status: 402,
    statusText: "Payment Required",
    headers: {
      "Content-Type": "application/json",
      "X-PAYMENT-REQUIRED": headerValue
    },
    challenge
  };
}

export function parsePaymentRequiredHeader(headerValue: string): X402Challenge {
  if (!headerValue || typeof headerValue !== "string") {
    throw new Error("Empty X-PAYMENT-REQUIRED header");
  }
  const parsed = JSON.parse(decodeBase64Url(headerValue)) as Partial<X402Challenge>;
  if (parsed.scheme !== X402_SCHEME || parsed.version !== "1.0") {
    throw new Error(`Unsupported x402 scheme: ${String(parsed.scheme)}`);
  }
  if (
    typeof parsed.chainId !== "number" ||
    typeof parsed.payTo !== "string" ||
    typeof parsed.token !== "string" ||
    typeof parsed.amount !== "string" ||
    typeof parsed.taskHash !== "string" ||
    typeof parsed.verifyingContract !== "string" ||
    typeof parsed.expiresAt !== "number"
  ) {
    throw new Error("Malformed X-PAYMENT-REQUIRED challenge payload");
  }
  if (BigInt(parsed.amount) <= 0n) {
    throw new Error("Challenge amount must be positive");
  }
  return parsed as X402Challenge;
}

export function encodeXPaymentHeader(params: {
  network: HskNetworkKey;
  chainId: number;
  verifyingContract: `0x${string}`;
  mandate: PaymentMandate;
  signature: `0x${string}`;
  signer: `0x${string}`;
}): string {
  const envelope: X402PaymentPayload = {
    version: "1.0",
    scheme: X402_SCHEME,
    network: params.network,
    chainId: params.chainId,
    verifyingContract: params.verifyingContract,
    mandate: serializeMandateForJson(params.mandate),
    signature: params.signature,
    signer: params.signer
  };
  return encodeBase64Url(JSON.stringify(envelope));
}

export function decodeXPaymentHeader(headerValue: string): {
  envelope: X402PaymentPayload;
  mandate: PaymentMandate;
} {
  if (!headerValue || typeof headerValue !== "string") {
    throw new Error("Empty X-PAYMENT header");
  }
  const parsed = JSON.parse(decodeBase64Url(headerValue)) as Partial<X402PaymentPayload>;
  if (parsed.scheme !== X402_SCHEME || parsed.version !== "1.0") {
    throw new Error(`Unsupported X-PAYMENT scheme: ${String(parsed.scheme)}`);
  }
  if (
    typeof parsed.chainId !== "number" ||
    typeof parsed.verifyingContract !== "string" ||
    typeof parsed.signature !== "string" ||
    typeof parsed.signer !== "string" ||
    !parsed.mandate
  ) {
    throw new Error("Malformed X-PAYMENT envelope");
  }
  const mandate = deserializeMandateFromJson(parsed.mandate);
  return {
    envelope: parsed as X402PaymentPayload,
    mandate
  };
}
