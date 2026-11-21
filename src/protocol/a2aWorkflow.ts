import { formatUnits, parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildMandateDomain,
  hashCanonicalTaskPayload,
  signPaymentMandate,
  type PaymentMandate
} from "./eip712";
import {
  MandateGatekeeper,
  type GatekeeperDecision,
  type GuardrailErrorCode
} from "./gatekeeper";
import { HSK_NETWORKS, SETTLEMENT_TOKENS, type HskNetworkKey } from "./networks";
import {
  buildPaymentRequiredResponse,
  decodeXPaymentHeader,
  encodeXPaymentHeader,
  parsePaymentRequiredHeader,
  type Http402ResponseFrame
} from "./x402";

export interface AgentTaskTemplate {
  id: string;
  title: string;
  workerName: string;
  endpoint: string;
  defaultPriceUsdc: string;
  deliverableSummary: string;
  payloadSpec: Record<string, unknown>;
}

export interface A2ARunTrace {
  taskId: string;
  taskTitle: string;
  network: HskNetworkKey;
  chainId: number;
  buyerAgent: `0x${string}`;
  providerAgent: `0x${string}`;
  taskHash: `0x${string}`;
  executionProofHash: `0x${string}`;
  http402Frame: Http402ResponseFrame;
  xPaymentHeader: string;
  mandate: PaymentMandate;
  signature: `0x${string}`;
  decision: GatekeeperDecision;
  deliverableOutput: string | null;
  steps: {
    step: number;
    actor: string;
    title: string;
    status: "PASS" | "BLOCKED";
    detail: string;
  }[];
}

export interface AdversarialScenarioResult {
  id: string;
  label: string;
  expectedCode: GuardrailErrorCode;
  actualDecision: GatekeeperDecision;
  blockedAsExpected: boolean;
}

// Deterministic ephemeral sandbox agent keys (non-production demo identities, $0 funds)
export const SANDBOX_BUYER_KEY: Hex =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
export const SANDBOX_PROVIDER_KEY: Hex =
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
export const SANDBOX_ATTACKER_KEY: Hex =
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";

export const SANDBOX_BUYER_ADDRESS = privateKeyToAccount(SANDBOX_BUYER_KEY).address;
export const SANDBOX_PROVIDER_ADDRESS = privateKeyToAccount(SANDBOX_PROVIDER_KEY).address;
export const SANDBOX_ATTACKER_ADDRESS = privateKeyToAccount(SANDBOX_ATTACKER_KEY).address;

export const AGENT_TASK_CATALOG: AgentTaskTemplate[] = [
  {
    id: "audit-adapter",
    title: "Solidity EIP-712 Security Audit",
    workerName: "VeriGuard Audit Agent",
    endpoint: "https://agents.mandaterail.hsk/v1/audit/eip712",
    defaultPriceUsdc: "12.50",
    deliverableSummary: "Static invariant proof + malleability clearance signed for HSK Vault v1",
    payloadSpec: {
      capability: "solidity-invariant-audit",
      targetContract: "MandateSettlementVault",
      checks: ["ecdsa-half-n", "reentrancy-lock", "rolling-24h-budget"]
    }
  },
  {
    id: "oracle-attestation",
    title: "HSK/USDT TWAP Oracle Attestation",
    workerName: "PythBridge Data Agent",
    endpoint: "https://agents.mandaterail.hsk/v1/oracle/hsk-twap",
    defaultPriceUsdc: "4.00",
    deliverableSummary: "Signed 15m TWAP price feed & liquidity depth snapshot",
    payloadSpec: {
      capability: "twap-price-attestation",
      pair: "HSK/USDT",
      windowMinutes: 15,
      venues: ["HashKey-L2-DEX", "HSP-Settlement-Index"]
    }
  },
  {
    id: "kyc-proof",
    title: "Institutional KYT Counterparty Proof",
    workerName: "ComplianceGate KYT Agent",
    endpoint: "https://agents.mandaterail.hsk/v1/compliance/kyt-proof",
    defaultPriceUsdc: "8.25",
    deliverableSummary: "Zero-PII sanctions & KYT attestation hash bound to settlement receipt",
    payloadSpec: {
      capability: "institutional-kyt-attestation",
      jurisdiction: "HK-SFC-Compliant",
      scope: "counterparty-sanctions-screening"
    }
  }
];

export function formatTokenAmount(raw: bigint, decimals = 6): string {
  return formatUnits(raw, decimals);
}

export function createSeededGatekeeper(network: HskNetworkKey, initialDepositUsdc = "250.00"): MandateGatekeeper {
  const gatekeeper = new MandateGatekeeper(network);
  const depositRaw = parseUnits(initialDepositUsdc, SETTLEMENT_TOKENS.USDC.decimals);
  gatekeeper.deposit(SANDBOX_BUYER_ADDRESS, SETTLEMENT_TOKENS.USDC.address, depositRaw);
  return gatekeeper;
}

export async function executeA2ASettlement(params: {
  gatekeeper: MandateGatekeeper;
  network: HskNetworkKey;
  task: AgentTaskTemplate;
  amountUsdc: string;
  maxPerTxUsdc: string;
  dailyCapUsdc: string;
  nonce: bigint;
  ttlSeconds?: number;
  signerKey?: Hex;
  mandateTaskHashOverride?: `0x${string}`;
  nowSecOverride?: bigint;
}): Promise<A2ARunTrace> {
  const {
    gatekeeper,
    network,
    task,
    amountUsdc,
    maxPerTxUsdc,
    dailyCapUsdc,
    nonce,
    ttlSeconds = 300,
    signerKey = SANDBOX_BUYER_KEY,
    mandateTaskHashOverride,
    nowSecOverride
  } = params;

  const cfg = HSK_NETWORKS[network];
  const token = SETTLEMENT_TOKENS.USDC;
  const amountRaw = parseUnits(amountUsdc, token.decimals);
  const maxPerTxRaw = parseUnits(maxPerTxUsdc, token.decimals);
  const dailyCapRaw = parseUnits(dailyCapUsdc, token.decimals);
  const nowSec = nowSecOverride ?? BigInt(Math.floor(Date.now() / 1000));

  const canonicalTaskHash = hashCanonicalTaskPayload({
    taskId: task.id,
    endpoint: task.endpoint,
    spec: task.payloadSpec,
    nonce: nonce.toString()
  });

  // Step 1 & 2: Worker returns HTTP 402 Payment Required challenge
  const http402Frame = buildPaymentRequiredResponse({
    network,
    chainId: cfg.chainId,
    resource: task.endpoint,
    payTo: SANDBOX_PROVIDER_ADDRESS,
    token: token.address,
    tokenSymbol: token.symbol,
    amount: amountRaw.toString(),
    taskHash: canonicalTaskHash,
    verifyingContract: gatekeeper.getVerifyingContract(),
    expiresAt: Number(nowSec) + ttlSeconds,
    suggestedNonce: nonce.toString()
  });

  const parsedChallenge = parsePaymentRequiredHeader(http402Frame.headers["X-PAYMENT-REQUIRED"]);

  // Step 3: Buyer Orchestrator Agent builds & signs EIP-712 PaymentMandate
  const mandate: PaymentMandate = {
    buyerAgent: SANDBOX_BUYER_ADDRESS,
    providerAgent: parsedChallenge.payTo,
    token: parsedChallenge.token,
    amount: BigInt(parsedChallenge.amount),
    maxPerTx: maxPerTxRaw,
    dailyCap: dailyCapRaw,
    nonce,
    validAfter: nowSec - 10n,
    validBefore: BigInt(parsedChallenge.expiresAt),
    taskHash: mandateTaskHashOverride ?? parsedChallenge.taskHash
  };

  const domain = buildMandateDomain(cfg.chainId, gatekeeper.getVerifyingContract());
  const signed = await signPaymentMandate(signerKey, domain, mandate);

  const xPaymentHeader = encodeXPaymentHeader({
    network,
    chainId: cfg.chainId,
    verifyingContract: gatekeeper.getVerifyingContract(),
    mandate,
    signature: signed.signature,
    signer: signed.signer
  });

  // Worker decodes X-PAYMENT header & submits with execution proof hash to HSP Gatekeeper
  const decoded = decodeXPaymentHeader(xPaymentHeader);
  const executionProofHash = hashCanonicalTaskPayload({
    deliverable: task.deliverableSummary,
    taskHash: canonicalTaskHash,
    provider: SANDBOX_PROVIDER_ADDRESS
  });

  const decision = await gatekeeper.settleMandate({
    mandate: decoded.mandate,
    signature: decoded.envelope.signature,
    expectedTaskHash: canonicalTaskHash,
    executionProofHash,
    currentTimeSec: nowSec
  });

  const settled = decision.status === "SETTLED";

  return {
    taskId: task.id,
    taskTitle: task.title,
    network,
    chainId: cfg.chainId,
    buyerAgent: SANDBOX_BUYER_ADDRESS,
    providerAgent: SANDBOX_PROVIDER_ADDRESS,
    taskHash: canonicalTaskHash,
    executionProofHash,
    http402Frame,
    xPaymentHeader,
    mandate,
    signature: signed.signature,
    decision,
    deliverableOutput: settled ? task.deliverableSummary : null,
    steps: [
      {
        step: 1,
        actor: "Orchestrator Buyer Agent",
        title: "Dispatch Task Request",
        status: "PASS",
        detail: `Requested ${task.title} from ${task.workerName} (${task.endpoint})`
      },
      {
        step: 2,
        actor: task.workerName,
        title: "HTTP 402 Payment Challenge",
        status: "PASS",
        detail: `Issued X-PAYMENT-REQUIRED for ${amountUsdc} ${token.symbol} bound to taskHash ${canonicalTaskHash.slice(0, 12)}...`
      },
      {
        step: 3,
        actor: "Mandate Signer",
        title: "Sign EIP-712 PaymentMandate",
        status: "PASS",
        detail: `Signed nonce #${nonce.toString()} (maxPerTx ${maxPerTxUsdc}, dailyCap ${dailyCapUsdc}) as ${signed.signer.slice(0, 10)}...`
      },
      {
        step: 4,
        actor: "HSP Settlement Gatekeeper",
        title: settled ? "Verify & Settle on MandateSettlementVault" : `Fail-Closed Block (${decision.errorCode})`,
        status: settled ? "PASS" : "BLOCKED",
        detail: settled
          ? `Settled ${amountUsdc} ${token.symbol} -> Receipt ${decision.receiptId.slice(0, 14)}...`
          : decision.reason
      }
    ]
  };
}

export async function runAdversarialScenario(
  scenarioId: "over-max-tx" | "daily-cap" | "expired" | "replay-nonce" | "tampered-task" | "forged-sig",
  network: HskNetworkKey
): Promise<AdversarialScenarioResult> {
  // Use an isolated sandbox gatekeeper so adversarial stress tests never corrupt user's live ledger
  const isolated = createSeededGatekeeper(network, "500.00");
  const task = AGENT_TASK_CATALOG[0];
  const nowSec = BigInt(Math.floor(Date.now() / 1000));

  if (scenarioId === "over-max-tx") {
    const run = await executeA2ASettlement({
      gatekeeper: isolated,
      network,
      task,
      amountUsdc: "75.00",
      maxPerTxUsdc: "25.00",
      dailyCapUsdc: "100.00",
      nonce: 101n,
      nowSecOverride: nowSec
    });
    return {
      id: scenarioId,
      label: "Per-Tx Ceiling Breach (75 > 25 USDC)",
      expectedCode: "ERR_OVER_MAX_PER_TX",
      actualDecision: run.decision,
      blockedAsExpected:
        run.decision.status === "REJECTED" && run.decision.errorCode === "ERR_OVER_MAX_PER_TX"
    };
  }

  if (scenarioId === "daily-cap") {
    // First settle 80 USDC cleanly, then attempt 30 USDC against 100 USDC 24h daily cap
    await executeA2ASettlement({
      gatekeeper: isolated,
      network,
      task,
      amountUsdc: "80.00",
      maxPerTxUsdc: "90.00",
      dailyCapUsdc: "100.00",
      nonce: 201n,
      nowSecOverride: nowSec
    });
    const run = await executeA2ASettlement({
      gatekeeper: isolated,
      network,
      task,
      amountUsdc: "30.00",
      maxPerTxUsdc: "90.00",
      dailyCapUsdc: "100.00",
      nonce: 202n,
      nowSecOverride: nowSec + 5n
    });
    return {
      id: scenarioId,
      label: "24h Rolling Daily Cap Breach (80 + 30 > 100 USDC)",
      expectedCode: "ERR_DAILY_CAP_EXCEEDED",
      actualDecision: run.decision,
      blockedAsExpected:
        run.decision.status === "REJECTED" && run.decision.errorCode === "ERR_DAILY_CAP_EXCEEDED"
    };
  }

  if (scenarioId === "expired") {
    const run = await executeA2ASettlement({
      gatekeeper: isolated,
      network,
      task,
      amountUsdc: "10.00",
      maxPerTxUsdc: "25.00",
      dailyCapUsdc: "100.00",
      nonce: 301n,
      ttlSeconds: -120,
      nowSecOverride: nowSec
    });
    return {
      id: scenarioId,
      label: "Expired Mandate Deadline (validBefore < now)",
      expectedCode: "ERR_MANDATE_EXPIRED",
      actualDecision: run.decision,
      blockedAsExpected:
        run.decision.status === "REJECTED" && run.decision.errorCode === "ERR_MANDATE_EXPIRED"
    };
  }

  if (scenarioId === "replay-nonce") {
    await executeA2ASettlement({
      gatekeeper: isolated,
      network,
      task,
      amountUsdc: "10.00",
      maxPerTxUsdc: "25.00",
      dailyCapUsdc: "100.00",
      nonce: 401n,
      nowSecOverride: nowSec
    });
    const replay = await executeA2ASettlement({
      gatekeeper: isolated,
      network,
      task,
      amountUsdc: "10.00",
      maxPerTxUsdc: "25.00",
      dailyCapUsdc: "100.00",
      nonce: 401n,
      nowSecOverride: nowSec + 1n
    });
    return {
      id: scenarioId,
      label: "Replayed Mandate Nonce (#401 reused)",
      expectedCode: "ERR_NONCE_REPLAYED",
      actualDecision: replay.decision,
      blockedAsExpected:
        replay.decision.status === "REJECTED" && replay.decision.errorCode === "ERR_NONCE_REPLAYED"
    };
  }

  if (scenarioId === "tampered-task") {
    const forgedHash = hashCanonicalTaskPayload({ tampered: "redirect-payout-scope" });
    const run = await executeA2ASettlement({
      gatekeeper: isolated,
      network,
      task,
      amountUsdc: "10.00",
      maxPerTxUsdc: "25.00",
      dailyCapUsdc: "100.00",
      nonce: 501n,
      mandateTaskHashOverride: forgedHash,
      nowSecOverride: nowSec
    });
    return {
      id: scenarioId,
      label: "Tampered taskHash Binding Attack",
      expectedCode: "ERR_TASK_HASH_MISMATCH",
      actualDecision: run.decision,
      blockedAsExpected:
        run.decision.status === "REJECTED" && run.decision.errorCode === "ERR_TASK_HASH_MISMATCH"
    };
  }

  // forged-sig: signed by attacker key instead of buyerAgent
  const run = await executeA2ASettlement({
    gatekeeper: isolated,
    network,
    task,
    amountUsdc: "10.00",
    maxPerTxUsdc: "25.00",
    dailyCapUsdc: "100.00",
    nonce: 601n,
    signerKey: SANDBOX_ATTACKER_KEY,
    nowSecOverride: nowSec
  });
  return {
    id: scenarioId,
    label: "Forged ECDSA Signer Key Attack",
    expectedCode: "ERR_INVALID_SIGNATURE",
    actualDecision: run.decision,
    blockedAsExpected:
      run.decision.status === "REJECTED" && run.decision.errorCode === "ERR_INVALID_SIGNATURE"
  };
}

export async function runAllAdversarialScenarios(network: HskNetworkKey): Promise<AdversarialScenarioResult[]> {
  const ids = [
    "over-max-tx",
    "daily-cap",
    "expired",
    "replay-nonce",
    "tampered-task",
    "forged-sig"
  ] as const;

  const results: AdversarialScenarioResult[] = [];
  for (const id of ids) {
    results.push(await runAdversarialScenario(id, network));
  }
  return results;
}
