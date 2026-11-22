import { describe, expect, it } from "vitest";
import { parseUnits } from "viem";
import {
  buildMandateDomain,
  hashCanonicalTaskPayload,
  recoverMandateSigner,
  signPaymentMandate,
  verifyPaymentMandateSignature,
  type PaymentMandate
} from "../src/protocol/eip712";
import { DAILY_WINDOW_SECONDS, MandateGatekeeper } from "../src/protocol/gatekeeper";
import { HSK_NETWORKS, SETTLEMENT_TOKENS, ZERO_ADDRESS } from "../src/protocol/networks";
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
