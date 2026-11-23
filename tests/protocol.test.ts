import { describe, expect, it } from "vitest";
import { encodeErrorResult, parseUnits, toFunctionSelector } from "viem";
import {
  buildMandateDomain,
  deserializeMandateFromJson,
  hashCanonicalTaskPayload,
  recoverMandateSigner,
  serializeMandateForJson,
  signPaymentMandate,
  verifyPaymentMandateSignature,
  type PaymentMandate
} from "../src/protocol/eip712";
import { DAILY_WINDOW_SECONDS, MandateGatekeeper } from "../src/protocol/gatekeeper";
import {
  CIRCLE_SEPOLIA_USDC,
  HSK_NETWORKS,
  LIVE_TESTNET_SHOWCASE,
  SETTLEMENT_TOKENS,
  ZERO_ADDRESS
} from "../src/protocol/networks";
import { buildVerificationSnippets, decodeVaultRevertError } from "../src/protocol/onChainVerifier";
import { MANDATE_VAULT_ABI } from "../src/protocol/vaultAbi";
import {
  buildPaymentRequiredResponse,
  decodeXPaymentHeader,
  encodeXPaymentHeader,
  parsePaymentRequiredHeader
} from "../src/protocol/x402";
import {
  AGENT_TASK_CATALOG,
  createSeededGatekeeper,
  executeA2ASettlement,
  runAllAdversarialScenarios,
  SANDBOX_BUYER_ADDRESS,
  SANDBOX_BUYER_KEY,
  SANDBOX_PROVIDER_ADDRESS
} from "../src/protocol/a2aWorkflow";

describe("HashKey Chain Network & Canonical Task Hashing", () => {
  it("defines verified HashKey Chain Testnet (133) and Mainnet (177) parameters", () => {
    expect(HSK_NETWORKS.testnet.chainId).toBe(133);
    expect(HSK_NETWORKS.testnet.rpcUrl).toBe("https://testnet.hsk.xyz");
    expect(HSK_NETWORKS.testnet.explorerUrl).toBe("https://testnet-explorer.hskchain.net");
    expect(HSK_NETWORKS.testnet.faucetUrl).toBe("https://faucet.hsk.xyz");
    expect(HSK_NETWORKS.testnet.defaultVaultAddress.toLowerCase()).toBe(
      "0xc91469d4acc815b485f5b961bf49c7f0764a50cf"
    );

    expect(HSK_NETWORKS.mainnet.chainId).toBe(177);
    expect(HSK_NETWORKS.mainnet.rpcUrl).toBe("https://mainnet.hsk.xyz");
    expect(HSK_NETWORKS.mainnet.explorerUrl).toBe("https://hsk.blockscout.com");
  });

  it("produces key-order-invariant canonical taskHash digests", () => {
    const hashA = hashCanonicalTaskPayload({ b: 2, a: { z: true, m: "hsk" } });
    const hashB = hashCanonicalTaskPayload({ a: { m: "hsk", z: true }, b: 2 });
    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("EIP-712 PaymentMandate Cryptography & Domain Isolation", () => {
  const nowSec = 1_800_000_000n;
  const taskHash = hashCanonicalTaskPayload({ task: "audit-eip712" });
  const baseMandate: PaymentMandate = {
    buyerAgent: SANDBOX_BUYER_ADDRESS,
    providerAgent: SANDBOX_PROVIDER_ADDRESS,
    token: SETTLEMENT_TOKENS.USDC.address,
    amount: parseUnits("10", 6),
    maxPerTx: parseUnits("25", 6),
    dailyCap: parseUnits("100", 6),
    nonce: 1n,
    validAfter: nowSec - 30n,
    validBefore: nowSec + 300n,
    taskHash
  };

  it("signs and recovers exact buyerAgent ECDSA signer on HSK Testnet (133)", async () => {
    const domain = buildMandateDomain(133, HSK_NETWORKS.testnet.defaultVaultAddress);
    const { signature, signer } = await signPaymentMandate(SANDBOX_BUYER_KEY, domain, baseMandate);

    expect(signer).toBe(SANDBOX_BUYER_ADDRESS);
    const recovered = await recoverMandateSigner(domain, baseMandate, signature);
    expect(recovered).toBe(SANDBOX_BUYER_ADDRESS);
    expect(await verifyPaymentMandateSignature(domain, baseMandate, signature)).toBe(true);
  });

  it("prevents cross-chain replay between Testnet (133) and Mainnet (177)", async () => {
    const testnetDomain = buildMandateDomain(133, HSK_NETWORKS.testnet.defaultVaultAddress);
    const mainnetDomain = buildMandateDomain(177, HSK_NETWORKS.testnet.defaultVaultAddress);

    const { signature } = await signPaymentMandate(SANDBOX_BUYER_KEY, testnetDomain, baseMandate);
    expect(await verifyPaymentMandateSignature(mainnetDomain, baseMandate, signature)).toBe(false);
  });

  it("invalidates ECDSA signature if mandate amount is altered after signing", async () => {
    const domain = buildMandateDomain(133, HSK_NETWORKS.testnet.defaultVaultAddress);
    const { signature } = await signPaymentMandate(SANDBOX_BUYER_KEY, domain, baseMandate);
    const mutated: PaymentMandate = { ...baseMandate, amount: parseUnits("11", 6) };

    expect(await verifyPaymentMandateSignature(domain, mutated, signature)).toBe(false);
  });
});

describe("HTTP 402 (x402) Challenge & X-PAYMENT Envelope Encoding", () => {
  it("roundtrips X-PAYMENT-REQUIRED challenge header cleanly", () => {
    const taskHash = hashCanonicalTaskPayload({ resource: "twap" });
    const frame = buildPaymentRequiredResponse({
      network: "testnet",
      chainId: 133,
      resource: "https://agents.mandaterail.hsk/v1/oracle",
      payTo: SANDBOX_PROVIDER_ADDRESS,
      token: SETTLEMENT_TOKENS.USDC.address,
      tokenSymbol: "USDC.hsk",
      amount: "4000000",
      taskHash,
      verifyingContract: HSK_NETWORKS.testnet.defaultVaultAddress,
      expiresAt: 1_800_000_500,
      suggestedNonce: "7"
    });

    expect(frame.status).toBe(402);
    const decoded = parsePaymentRequiredHeader(frame.headers["X-PAYMENT-REQUIRED"]);
    expect(decoded.chainId).toBe(133);
    expect(decoded.amount).toBe("4000000");
    expect(decoded.taskHash).toBe(taskHash);
  });

  it("fails closed on invalid X-PAYMENT-REQUIRED header", () => {
    expect(() => parsePaymentRequiredHeader("")).toThrow();
    expect(() => parsePaymentRequiredHeader("not-valid-base64")).toThrow();
  });

  it("roundtrips signed X-PAYMENT header preserving bigint mandate fields", async () => {
    const domain = buildMandateDomain(133, HSK_NETWORKS.testnet.defaultVaultAddress);
    const mandate: PaymentMandate = {
      buyerAgent: SANDBOX_BUYER_ADDRESS,
      providerAgent: SANDBOX_PROVIDER_ADDRESS,
      token: SETTLEMENT_TOKENS.USDC.address,
      amount: 12_500_000n,
      maxPerTx: 25_000_000n,
      dailyCap: 100_000_000n,
      nonce: 42n,
      validAfter: 1_799_999_900n,
      validBefore: 1_800_000_500n,
      taskHash: hashCanonicalTaskPayload({ step: "roundtrip" })
    };
    const signed = await signPaymentMandate(SANDBOX_BUYER_KEY, domain, mandate);
    const header = encodeXPaymentHeader({
      network: "testnet",
      chainId: 133,
      verifyingContract: domain.verifyingContract,
      mandate,
      signature: signed.signature,
      signer: signed.signer
    });

    const decoded = decodeXPaymentHeader(header);
    expect(decoded.mandate.amount).toBe(12_500_000n);
    expect(decoded.mandate.nonce).toBe(42n);
    expect(decoded.envelope.signature).toBe(signed.signature);
  });
});

describe("MandateGatekeeper Settlement, Rolling Budget & Principal Governance", () => {
  it("completes end-to-end A2A settlement and updates vault & provider balances", async () => {
    const gatekeeper = createSeededGatekeeper("testnet", "250.00");
    const run = await executeA2ASettlement({
      gatekeeper,
      network: "testnet",
      task: AGENT_TASK_CATALOG[0],
      amountUsdc: "12.50",
      maxPerTxUsdc: "25.00",
      dailyCapUsdc: "100.00",
      nonce: 1n
    });

    expect(run.decision.status).toBe("SETTLED");
    expect(run.deliverableOutput).toContain("Static invariant proof");
    expect(gatekeeper.getVaultBalance(SANDBOX_BUYER_ADDRESS, SETTLEMENT_TOKENS.USDC.address)).toBe(
      parseUnits("237.50", 6)
    );
    expect(gatekeeper.getProviderEarnings(SANDBOX_PROVIDER_ADDRESS, SETTLEMENT_TOKENS.USDC.address)).toBe(
      parseUnits("12.50", 6)
    );
  });

  it("resets rolling 24-hour budget tracker after 86400 seconds", async () => {
    const gatekeeper = createSeededGatekeeper("testnet", "500.00");
    const startSec = 1_800_000_000n;

    const first = await executeA2ASettlement({
      gatekeeper,
      network: "testnet",
      task: AGENT_TASK_CATALOG[0],
      amountUsdc: "90.00",
      maxPerTxUsdc: "95.00",
      dailyCapUsdc: "100.00",
      nonce: 1n,
      nowSecOverride: startSec
    });
    expect(first.decision.status).toBe("SETTLED");

    const blocked = await executeA2ASettlement({
      gatekeeper,
      network: "testnet",
      task: AGENT_TASK_CATALOG[0],
      amountUsdc: "20.00",
      maxPerTxUsdc: "95.00",
      dailyCapUsdc: "100.00",
      nonce: 2n,
      nowSecOverride: startSec + 3600n
    });
    expect(blocked.decision.status).toBe("REJECTED");

    const nextWindow = await executeA2ASettlement({
      gatekeeper,
      network: "testnet",
      task: AGENT_TASK_CATALOG[0],
      amountUsdc: "20.00",
      maxPerTxUsdc: "95.00",
      dailyCapUsdc: "100.00",
      nonce: 3n,
      nowSecOverride: startSec + DAILY_WINDOW_SECONDS
    });
    expect(nextWindow.decision.status).toBe("SETTLED");
  });

  it("enforces principal policy ceilings and emergency freeze over agent mandates", async () => {
    const gatekeeper = createSeededGatekeeper("mainnet", "300.00");
    gatekeeper.setPrincipalPolicy(SANDBOX_BUYER_ADDRESS, SETTLEMENT_TOKENS.USDC.address, {
      maxPerTxCeiling: parseUnits("10.00", 6),
      dailyCapCeiling: parseUnits("30.00", 6),
      enforced: true,
      frozen: false
    });

    const overPolicy = await executeA2ASettlement({
      gatekeeper,
      network: "mainnet",
      task: AGENT_TASK_CATALOG[0],
      amountUsdc: "15.00",
      maxPerTxUsdc: "50.00",
      dailyCapUsdc: "200.00",
      nonce: 10n
    });
    expect(overPolicy.decision.status).toBe("REJECTED");
    if (overPolicy.decision.status === "REJECTED") {
      expect(overPolicy.decision.errorCode).toBe("ERR_OVER_MAX_PER_TX");
    }

    gatekeeper.setPrincipalPolicy(SANDBOX_BUYER_ADDRESS, SETTLEMENT_TOKENS.USDC.address, {
      maxPerTxCeiling: parseUnits("10.00", 6),
      dailyCapCeiling: parseUnits("30.00", 6),
      enforced: true,
      frozen: true
    });
    const frozenRun = await executeA2ASettlement({
      gatekeeper,
      network: "mainnet",
      task: AGENT_TASK_CATALOG[1],
      amountUsdc: "4.00",
      maxPerTxUsdc: "10.00",
      dailyCapUsdc: "30.00",
      nonce: 11n
    });
    expect(frozenRun.decision.status).toBe("REJECTED");
    if (frozenRun.decision.status === "REJECTED") {
      expect(frozenRun.decision.errorCode).toBe("ERR_AGENT_FROZEN");
    }
  });

  it("blocks revoked nonces, not-yet-valid mandates, and unfunded vaults", async () => {
    const gatekeeper = new MandateGatekeeper("testnet");
    gatekeeper.deposit(SANDBOX_BUYER_ADDRESS, SETTLEMENT_TOKENS.USDC.address, parseUnits("5.00", 6));

    // Revoked nonce
    gatekeeper.revokeNonce(SANDBOX_BUYER_ADDRESS, 88n);
    const revoked = await executeA2ASettlement({
      gatekeeper,
      network: "testnet",
      task: AGENT_TASK_CATALOG[1],
      amountUsdc: "4.00",
      maxPerTxUsdc: "10.00",
      dailyCapUsdc: "50.00",
      nonce: 88n
    });
    expect(revoked.decision.status).toBe("REJECTED");
    if (revoked.decision.status === "REJECTED") {
      expect(revoked.decision.errorCode).toBe("ERR_MANDATE_REVOKED");
    }

    // Not yet valid
    const nowSec = 1_800_000_000n;
    const domain = buildMandateDomain(133, gatekeeper.getVerifyingContract());
    const taskHash = hashCanonicalTaskPayload({ k: "future" });
    const futureMandate: PaymentMandate = {
      buyerAgent: SANDBOX_BUYER_ADDRESS,
      providerAgent: SANDBOX_PROVIDER_ADDRESS,
      token: SETTLEMENT_TOKENS.USDC.address,
      amount: parseUnits("4.00", 6),
      maxPerTx: parseUnits("10.00", 6),
      dailyCap: parseUnits("50.00", 6),
      nonce: 89n,
      validAfter: nowSec + 600n,
      validBefore: nowSec + 1200n,
      taskHash
    };
    const signed = await signPaymentMandate(SANDBOX_BUYER_KEY, domain, futureMandate);
    const earlyDecision = await gatekeeper.settleMandate({
      mandate: futureMandate,
      signature: signed.signature,
      expectedTaskHash: taskHash,
      executionProofHash: taskHash,
      currentTimeSec: nowSec
    });
    expect(earlyDecision.status).toBe("REJECTED");
    if (earlyDecision.status === "REJECTED") {
      expect(earlyDecision.errorCode).toBe("ERR_MANDATE_NOT_YET_VALID");
    }

    // Insufficient balance
    const overBalance = await executeA2ASettlement({
      gatekeeper,
      network: "testnet",
      task: AGENT_TASK_CATALOG[0],
      amountUsdc: "12.50",
      maxPerTxUsdc: "25.00",
      dailyCapUsdc: "50.00",
      nonce: 90n
    });
    expect(overBalance.decision.status).toBe("REJECTED");
    if (overBalance.decision.status === "REJECTED") {
      expect(overBalance.decision.errorCode).toBe("ERR_INSUFFICIENT_VAULT_BALANCE");
    }

    // Zero address check
    const zeroMandate: PaymentMandate = { ...futureMandate, buyerAgent: ZERO_ADDRESS, validAfter: nowSec - 10n };
    const zeroDecision = await gatekeeper.settleMandate({
      mandate: zeroMandate,
      signature: signed.signature,
      expectedTaskHash: taskHash,
      executionProofHash: taskHash,
      currentTimeSec: nowSec
    });
    expect(zeroDecision.status).toBe("REJECTED");
    if (zeroDecision.status === "REJECTED") {
      expect(zeroDecision.errorCode).toBe("ERR_ZERO_ADDRESS");
    }
  });

  it("blocks all 6 adversarial guardrail attack vectors fail-closed", async () => {
    const results = await runAllAdversarialScenarios("testnet");
    expect(results).toHaveLength(6);
    for (const item of results) {
      expect(item.blockedAsExpected).toBe(true);
      expect(item.actualDecision.status).toBe("REJECTED");
    }
  });
});

describe("Live On-Chain Verifier, Error Decoding & Dual-Rail Readiness", () => {
  it("exposes verified HSK Testnet 133 showcase TXs and Circle Sepolia USDC dual-rail config", () => {
    expect(LIVE_TESTNET_SHOWCASE.chainId).toBe(133);
    expect(LIVE_TESTNET_SHOWCASE.vaultAddress).toBe("0xc91469d4acc815b485f5b961bf49c7f0764a50cf");
    expect(LIVE_TESTNET_SHOWCASE.deployTxHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(LIVE_TESTNET_SHOWCASE.settlementTx1Hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(LIVE_TESTNET_SHOWCASE.settlementTx2Hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(LIVE_TESTNET_SHOWCASE.policyTxHash).toMatch(/^0x[0-9a-f]{64}$/);

    expect(CIRCLE_SEPOLIA_USDC.chainId).toBe(11155111);
    expect(CIRCLE_SEPOLIA_USDC.tokenAddress).toBe("0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238");
    expect(CIRCLE_SEPOLIA_USDC.decimals).toBe(6);
  });

  it("decodes NonceAlreadyUsed custom error from raw EVM revert bytes", () => {
    const raw = encodeErrorResult({
      abi: MANDATE_VAULT_ABI,
      errorName: "NonceAlreadyUsed",
      args: [LIVE_TESTNET_SHOWCASE.deployerAddress, 2n]
    });
    const decoded = decodeVaultRevertError(raw);
    expect(decoded.errorName).toBe("NonceAlreadyUsed");
    expect(decoded.args).toEqual([LIVE_TESTNET_SHOWCASE.deployerAddress, "2"]);
    expect(decoded.summary).toContain("NonceAlreadyUsed(");
  });

  it("decodes OverMaxPerTx and DailyCapExceeded parameterized custom errors", () => {
    const overMaxRaw = encodeErrorResult({
      abi: MANDATE_VAULT_ABI,
      errorName: "OverMaxPerTx",
      args: [50_000_000n, 25_000_000n]
    });
    const overDecoded = decodeVaultRevertError(overMaxRaw);
    expect(overDecoded.errorName).toBe("OverMaxPerTx");
    expect(overDecoded.args).toEqual(["50000000", "25000000"]);

    const dailyRaw = encodeErrorResult({
      abi: MANDATE_VAULT_ABI,
      errorName: "DailyCapExceeded",
      args: [110_000_000n, 100_000_000n]
    });
    const dailyDecoded = decodeVaultRevertError(dailyRaw);
    expect(dailyDecoded.errorName).toBe("DailyCapExceeded");
    expect(dailyDecoded.args).toEqual(["110000000", "100000000"]);
  });

  it("decodes zero-argument custom errors and handles unknown revert payloads gracefully", () => {
    const invalidSigRaw = encodeErrorResult({
      abi: MANDATE_VAULT_ABI,
      errorName: "InvalidSignature"
    });
    const sigDecoded = decodeVaultRevertError(invalidSigRaw);
    expect(sigDecoded.errorName).toBe("InvalidSignature");
    expect(sigDecoded.summary).toBe("InvalidSignature()");

    const unknownDecoded = decodeVaultRevertError("0xdeadbeef");
    expect(unknownDecoded.errorName).toBe("UnknownRevertData");
  });

  it("generates accurate curl, cast, and viem 5-second verification snippets", () => {
    const snippets = buildVerificationSnippets();
    expect(snippets.curl).toContain("https://testnet.hsk.xyz");
    expect(snippets.curl).toContain("0xa23a720f");
    expect(snippets.curl).toContain(LIVE_TESTNET_SHOWCASE.vaultAddress);
    expect(snippets.cast).toContain("totalReceipts()(uint256)");
    expect(snippets.cast).toContain("principalPolicies");
    expect(snippets.viem).toContain("createPublicClient");
  });

  it("executes multi-hop A2A workflow chaining Hop 1 receipt into Hop 2 and tracking rolling spend", async () => {
    const gatekeeper = createSeededGatekeeper("testnet", "250.00");
    const hop1 = await executeA2ASettlement({
      gatekeeper,
      network: "testnet",
      task: AGENT_TASK_CATALOG[0],
      amountUsdc: "12.50",
      maxPerTxUsdc: "25.00",
      dailyCapUsdc: "100.00",
      nonce: 1n
    });
    expect(hop1.decision.status).toBe("SETTLED");

    const hop2 = await executeA2ASettlement({
      gatekeeper,
      network: "testnet",
      task: AGENT_TASK_CATALOG[2],
      amountUsdc: "8.25",
      maxPerTxUsdc: "25.00",
      dailyCapUsdc: "100.00",
      nonce: 2n
    });
    expect(hop2.decision.status).toBe("SETTLED");
    expect(gatekeeper.getUsedNonceCount()).toBe(2);
    expect(gatekeeper.getVaultBalance(SANDBOX_BUYER_ADDRESS, SETTLEMENT_TOKENS.USDC.address)).toBe(
      parseUnits("229.25", 6)
    );
    expect(gatekeeper.getProviderEarnings(SANDBOX_PROVIDER_ADDRESS, SETTLEMENT_TOKENS.USDC.address)).toBe(
      parseUnits("20.75", 6)
    );
  });

  it("blocks explicitly revoked EIP-712 mandate digests via revokeMandate()", async () => {
    const gatekeeper = createSeededGatekeeper("testnet", "100.00");
    const nowSec = 1_800_000_000n;
    const taskHash = hashCanonicalTaskPayload({ job: "revoke-digest-test" });
    const mandate: PaymentMandate = {
      buyerAgent: SANDBOX_BUYER_ADDRESS,
      providerAgent: SANDBOX_PROVIDER_ADDRESS,
      token: SETTLEMENT_TOKENS.USDC.address,
      amount: parseUnits("5.00", 6),
      maxPerTx: parseUnits("25.00", 6),
      dailyCap: parseUnits("100.00", 6),
      nonce: 777n,
      validAfter: nowSec - 10n,
      validBefore: nowSec + 300n,
      taskHash
    };
    const domain = buildMandateDomain(133, gatekeeper.getVerifyingContract());
    const signed = await signPaymentMandate(SANDBOX_BUYER_KEY, domain, mandate);

    gatekeeper.revokeMandate(mandate);
    const decision = await gatekeeper.settleMandate({
      mandate,
      signature: signed.signature,
      expectedTaskHash: taskHash,
      executionProofHash: taskHash,
      currentTimeSec: nowSec
    });
    expect(decision.status).toBe("REJECTED");
    if (decision.status === "REJECTED") {
      expect(decision.errorCode).toBe("ERR_MANDATE_REVOKED");
    }
  });

  it("rejects malformed or unsupported X-PAYMENT headers cleanly", () => {
    expect(() => decodeXPaymentHeader("")).toThrow();
    const badHeader = btoa(JSON.stringify({ version: "1.0", scheme: "unknown" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    expect(() => decodeXPaymentHeader(badHeader)).toThrow("Unsupported X-PAYMENT scheme");
  });

  it("enforces principal dailyCapCeiling override below mandate dailyCap", async () => {
    const gatekeeper = createSeededGatekeeper("testnet", "250.00");
    gatekeeper.setPrincipalPolicy(SANDBOX_BUYER_ADDRESS, SETTLEMENT_TOKENS.USDC.address, {
      maxPerTxCeiling: parseUnits("25.00", 6),
      dailyCapCeiling: parseUnits("15.00", 6),
      enforced: true,
      frozen: false
    });

    const first = await executeA2ASettlement({
      gatekeeper,
      network: "testnet",
      task: AGENT_TASK_CATALOG[1],
      amountUsdc: "10.00",
      maxPerTxUsdc: "25.00",
      dailyCapUsdc: "200.00",
      nonce: 1n
    });
    expect(first.decision.status).toBe("SETTLED");

    const second = await executeA2ASettlement({
      gatekeeper,
      network: "testnet",
      task: AGENT_TASK_CATALOG[1],
      amountUsdc: "6.00",
      maxPerTxUsdc: "25.00",
      dailyCapUsdc: "200.00",
      nonce: 2n
    });
    expect(second.decision.status).toBe("REJECTED");
    if (second.decision.status === "REJECTED") {
      expect(second.decision.errorCode).toBe("ERR_DAILY_CAP_EXCEEDED");
    }
  });

  it("roundtrips serializeMandateForJson and rejects incomplete JSON payloads", () => {
    const sample: PaymentMandate = {
      buyerAgent: SANDBOX_BUYER_ADDRESS,
      providerAgent: SANDBOX_PROVIDER_ADDRESS,
      token: ZERO_ADDRESS,
      amount: 500_000_000_000_000n,
      maxPerTx: 5_000_000_000_000_000n,
      dailyCap: 20_000_000_000_000_000n,
      nonce: 2n,
      validAfter: 1795352102n,
      validBefore: 1795355762n,
      taskHash: hashCanonicalTaskPayload({ hop: 2 })
    };
    const json = serializeMandateForJson(sample);
    const parsed = deserializeMandateFromJson(json);
    expect(parsed).toEqual(sample);

    const incomplete = { ...json };
    delete incomplete.taskHash;
    expect(() => deserializeMandateFromJson(incomplete)).toThrow("Missing mandate field: taskHash");
  });

  it("decodes MandateExpired and AgentFrozen custom errors from raw EVM revert bytes", () => {
    const expiredRaw = encodeErrorResult({
      abi: MANDATE_VAULT_ABI,
      errorName: "MandateExpired",
      args: [1_800_000_200n, 1_800_000_100n]
    });
    const expiredDecoded = decodeVaultRevertError(expiredRaw);
    expect(expiredDecoded.errorName).toBe("MandateExpired");
    expect(expiredDecoded.args).toEqual(["1800000200", "1800000100"]);

    const frozenRaw = encodeErrorResult({
      abi: MANDATE_VAULT_ABI,
      errorName: "AgentFrozen"
    });
    const frozenDecoded = decodeVaultRevertError(frozenRaw);
    expect(frozenDecoded.errorName).toBe("AgentFrozen");
    expect(frozenDecoded.summary).toBe("AgentFrozen()");
  });

  it("handles plain Error instances gracefully in decodeVaultRevertError", () => {
    const decoded = decodeVaultRevertError(new Error("RPC timeout after 6000ms"));
    expect(decoded.errorName).toBe("RpcOrUnknownError");
    expect(decoded.summary).toBe("RPC timeout after 6000ms");
  });

  it("keeps mainnet staging verifyingContract isolated from Testnet worker/buyer keys", () => {
    expect(HSK_NETWORKS.mainnet.defaultVaultAddress).not.toBe(SANDBOX_BUYER_ADDRESS);
    expect(HSK_NETWORKS.mainnet.defaultVaultAddress).not.toBe(LIVE_TESTNET_SHOWCASE.workerAAddress);
    expect(HSK_NETWORKS.mainnet.defaultVaultAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("keeps verification snippets compact and aligned with totalReceipts() selector", () => {
    const snippets = buildVerificationSnippets();
    expect(toFunctionSelector("totalReceipts()")).toBe("0xa23a720f");
    for (const line of snippets.curl.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(72);
    }
  });
});
