import { describe, expect, it } from "vitest";
import { keccak256, stringToHex } from "viem";
import { compileVaultContract } from "../scripts/compile.mjs";
import { PAYMENT_MANDATE_TYPEHASH, PAYMENT_MANDATE_TYPE_STRING } from "../src/protocol/eip712";

interface AbiItem {
  type: string;
  name?: string;
  inputs?: { name: string; type: string }[];
}

describe("MandateSettlementVault.sol Compilation & ABI Parity", () => {
  const artifact = compileVaultContract();
  const abi = artifact.abi as unknown as readonly AbiItem[];

  it("compiles cleanly with non-empty EVM bytecode", () => {
    expect(artifact.contractName).toBe("MandateSettlementVault");
    expect(artifact.bytecodeBytes).toBeGreaterThan(2000);
    expect(artifact.bytecode.startsWith("0x")).toBe(true);
  });

  it("matches exact EIP-712 PaymentMandate type string and keccak256 hash", () => {
    const expected = keccak256(stringToHex(PAYMENT_MANDATE_TYPE_STRING));
    expect(PAYMENT_MANDATE_TYPEHASH).toBe(expected);
  });

  it("exposes all core settlement, vault, principal governance, and revocation methods", () => {
    const fnNames = new Set(abi.filter((item) => item.type === "function").map((item) => item.name));
    const expectedFunctions = [
      "domainSeparator",
      "hashPaymentMandate",
      "computeMandateDigest",
      "depositNative",
      "depositToken",
      "withdrawVault",
      "assignPrincipal",
      "setPrincipalPolicy",
      "revokeNonce",
      "revokeMandate",
      "settleMandate",
      "remainingDailyBudget"
    ];
    for (const fn of expectedFunctions) {
      expect(fnNames.has(fn)).toBe(true);
    }
  });

  it("emits SettlementReceipt event and fail-closed guardrail custom errors", () => {
    const eventNames = new Set(abi.filter((item) => item.type === "event").map((item) => item.name));
    const errorNames = new Set(abi.filter((item) => item.type === "error").map((item) => item.name));

    expect(eventNames.has("SettlementReceipt")).toBe(true);
    expect(eventNames.has("DailyWindowReset")).toBe(true);
    expect(eventNames.has("MandateRevoked")).toBe(true);

    for (const err of [
      "OverMaxPerTx",
      "DailyCapExceeded",
      "MandateExpired",
      "MandateNotYetValid",
      "NonceAlreadyUsed",
      "MandateWasRevoked",
      "InvalidSignature",
      "AgentFrozen",
      "InsufficientVaultBalance"
    ]) {
      expect(errorNames.has(err)).toBe(true);
    }
  });
});
