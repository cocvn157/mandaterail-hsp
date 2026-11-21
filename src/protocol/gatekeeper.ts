import { encodeAbiParameters, keccak256, parseAbiParameters } from "viem";
import {
  buildMandateDomain,
  computeMandateDigest,
  recoverMandateSigner,
  serializeMandateForJson,
  verifyPaymentMandateSignature,
  type PaymentMandate
} from "./eip712";
import { HSK_NETWORKS, ZERO_ADDRESS, type HskNetworkKey } from "./networks";

export const DAILY_WINDOW_SECONDS = 86_400n;

export type GuardrailErrorCode =
  | "ERR_ZERO_ADDRESS"
  | "ERR_ZERO_AMOUNT"
  | "ERR_INVALID_CAP_CONFIG"
  | "ERR_MANDATE_NOT_YET_VALID"
  | "ERR_MANDATE_EXPIRED"
  | "ERR_NONCE_REPLAYED"
  | "ERR_MANDATE_REVOKED"
  | "ERR_INVALID_SIGNATURE"
  | "ERR_TASK_HASH_MISMATCH"
  | "ERR_AGENT_FROZEN"
  | "ERR_OVER_MAX_PER_TX"
  | "ERR_DAILY_CAP_EXCEEDED"
  | "ERR_INSUFFICIENT_VAULT_BALANCE";

export interface DailyBudgetWindow {
  windowStart: bigint;
  spent: bigint;
}

export interface PrincipalPolicyConfig {
  maxPerTxCeiling: bigint;
  dailyCapCeiling: bigint;
  enforced: boolean;
  frozen: boolean;
}

export interface SettlementReceiptRecord {
  status: "SETTLED";
  receiptId: `0x${string}`;
  mandateDigest: `0x${string}`;
  buyerAgent: `0x${string}`;
  providerAgent: `0x${string}`;
  token: `0x${string}`;
  amount: string;
  nonce: string;
  taskHash: `0x${string}`;
  executionProofHash: `0x${string}`;
  signature: `0x${string}`;
  recoveredSigner: `0x${string}`;
  network: HskNetworkKey;
  chainId: number;
  verifyingContract: `0x${string}`;
  settledAt: number;
  mandateJson: Record<string, string>;
  explorerUrl: string;
}

export interface GuardrailRejectionRecord {
  status: "REJECTED";
  errorCode: GuardrailErrorCode;
  reason: string;
  mandateDigest: `0x${string}`;
  buyerAgent: `0x${string}`;
  providerAgent: `0x${string}`;
  amount: string;
  nonce: string;
  taskHash: `0x${string}`;
  network: HskNetworkKey;
  chainId: number;
  evaluatedAt: number;
}

export type GatekeeperDecision = SettlementReceiptRecord | GuardrailRejectionRecord;

export class MandateGatekeeper {
  private readonly network: HskNetworkKey;
  private readonly chainId: number;
  private readonly verifyingContract: `0x${string}`;

  private vaultBalances = new Map<string, bigint>();
  private providerEarnings = new Map<string, bigint>();
  private usedNonces = new Set<string>();
  private revokedNonces = new Set<string>();
  private revokedDigests = new Set<string>();
  private dailyTrackers = new Map<string, DailyBudgetWindow>();
  private principalPolicies = new Map<string, PrincipalPolicyConfig>();
  private receiptCount = 0n;
  private history: GatekeeperDecision[] = [];

  constructor(network: HskNetworkKey, verifyingContract?: `0x${string}`) {
    const cfg = HSK_NETWORKS[network];
    this.network = network;
    this.chainId = cfg.chainId;
    this.verifyingContract = verifyingContract ?? cfg.defaultVaultAddress;
  }

  getVerifyingContract(): `0x${string}` {
    return this.verifyingContract;
  }

  getChainId(): number {
    return this.chainId;
  }

  deposit(buyerAgent: `0x${string}`, token: `0x${string}`, amount: bigint): void {
    if (amount <= 0n) throw new Error("Deposit amount must be positive");
    const key = this.balanceKey(buyerAgent, token);
    this.vaultBalances.set(key, (this.vaultBalances.get(key) ?? 0n) + amount);
  }

  getVaultBalance(buyerAgent: `0x${string}`, token: `0x${string}`): bigint {
    return this.vaultBalances.get(this.balanceKey(buyerAgent, token)) ?? 0n;
  }

  getProviderEarnings(providerAgent: `0x${string}`, token: `0x${string}`): bigint {
    return this.providerEarnings.get(this.balanceKey(providerAgent, token)) ?? 0n;
  }

  getDailyTracker(buyerAgent: `0x${string}`, token: `0x${string}`, currentTimeSec: bigint): DailyBudgetWindow {
    const tracker = this.dailyTrackers.get(this.balanceKey(buyerAgent, token));
    if (!tracker || currentTimeSec >= tracker.windowStart + DAILY_WINDOW_SECONDS) {
      return { windowStart: currentTimeSec, spent: 0n };
    }
    return { ...tracker };
  }

  setPrincipalPolicy(buyerAgent: `0x${string}`, token: `0x${string}`, policy: PrincipalPolicyConfig): void {
    this.principalPolicies.set(this.balanceKey(buyerAgent, token), policy);
  }

  revokeNonce(buyerAgent: `0x${string}`, nonce: bigint): void {
    this.revokedNonces.add(this.nonceKey(buyerAgent, nonce));
  }

  revokeMandate(mandate: PaymentMandate): `0x${string}` {
    const domain = buildMandateDomain(this.chainId, this.verifyingContract);
    const digest = computeMandateDigest(domain, mandate);
    this.revokedDigests.add(digest.toLowerCase());
    return digest;
  }

  getHistory(): GatekeeperDecision[] {
    return [...this.history];
  }

  getUsedNonceCount(): number {
    return this.usedNonces.size;
  }

  getRejectedCount(): number {
    return this.history.filter((entry) => entry.status === "REJECTED").length;
  }

  async settleMandate(params: {
    mandate: PaymentMandate;
    signature: `0x${string}`;
    expectedTaskHash: `0x${string}`;
    executionProofHash: `0x${string}`;
    currentTimeSec?: bigint;
  }): Promise<GatekeeperDecision> {
    const { mandate, signature, expectedTaskHash, executionProofHash } = params;
    const nowSec = params.currentTimeSec ?? BigInt(Math.floor(Date.now() / 1000));
    const domain = buildMandateDomain(this.chainId, this.verifyingContract);
    const mandateDigest = computeMandateDigest(domain, mandate);

    const reject = (errorCode: GuardrailErrorCode, reason: string): GuardrailRejectionRecord => {
      const record: GuardrailRejectionRecord = {
        status: "REJECTED",
        errorCode,
        reason,
        mandateDigest,
        buyerAgent: mandate.buyerAgent,
        providerAgent: mandate.providerAgent,
        amount: mandate.amount.toString(),
        nonce: mandate.nonce.toString(),
        taskHash: mandate.taskHash,
        network: this.network,
        chainId: this.chainId,
        evaluatedAt: Number(nowSec)
      };
      this.history = [record, ...this.history];
      return record;
    };

    if (mandate.buyerAgent === ZERO_ADDRESS || mandate.providerAgent === ZERO_ADDRESS) {
      return reject("ERR_ZERO_ADDRESS", "Buyer or provider agent address cannot be zero.");
    }
    if (mandate.amount <= 0n) {
      return reject("ERR_ZERO_AMOUNT", "Mandate payment amount must be greater than zero.");
    }
    if (mandate.maxPerTx <= 0n || mandate.dailyCap < mandate.maxPerTx) {
      return reject("ERR_INVALID_CAP_CONFIG", "Invalid cap configuration: dailyCap must be >= maxPerTx > 0.");
    }
    if (nowSec < mandate.validAfter) {
      return reject(
        "ERR_MANDATE_NOT_YET_VALID",
        `Current timestamp ${nowSec} is earlier than validAfter ${mandate.validAfter}.`
      );
    }
    if (nowSec > mandate.validBefore) {
      return reject(
        "ERR_MANDATE_EXPIRED",
        `Mandate expired at ${mandate.validBefore} (current timestamp ${nowSec}).`
      );
    }

    const nKey = this.nonceKey(mandate.buyerAgent, mandate.nonce);
    if (this.usedNonces.has(nKey)) {
      return reject(
        "ERR_NONCE_REPLAYED",
        `Nonce ${mandate.nonce.toString()} was already consumed by ${mandate.buyerAgent}.`
      );
    }
    if (this.revokedNonces.has(nKey) || this.revokedDigests.has(mandateDigest.toLowerCase())) {
      return reject(
        "ERR_MANDATE_REVOKED",
        `Mandate digest or nonce ${mandate.nonce.toString()} was revoked by principal.`
      );
    }

    const validSig = await verifyPaymentMandateSignature(domain, mandate, signature, mandate.buyerAgent);
    if (!validSig) {
      return reject(
        "ERR_INVALID_SIGNATURE",
        `EIP-712 ECDSA signature verification failed for buyerAgent ${mandate.buyerAgent}.`
      );
    }
    const recoveredSigner = await recoverMandateSigner(domain, mandate, signature);

    if (mandate.taskHash.toLowerCase() !== expectedTaskHash.toLowerCase()) {
      return reject(
        "ERR_TASK_HASH_MISMATCH",
        `Mandate taskHash ${mandate.taskHash} does not match canonical taskHash ${expectedTaskHash}.`
      );
    }

    const bKey = this.balanceKey(mandate.buyerAgent, mandate.token);
    const policy = this.principalPolicies.get(bKey);
    if (policy?.frozen) {
      return reject("ERR_AGENT_FROZEN", `Agent ${mandate.buyerAgent} is frozen by principal guardian.`);
    }

    let effectiveMaxPerTx = mandate.maxPerTx;
    let effectiveDailyCap = mandate.dailyCap;
    if (policy?.enforced) {
      if (policy.maxPerTxCeiling < effectiveMaxPerTx) effectiveMaxPerTx = policy.maxPerTxCeiling;
      if (policy.dailyCapCeiling < effectiveDailyCap) effectiveDailyCap = policy.dailyCapCeiling;
    }

    if (mandate.amount > effectiveMaxPerTx) {
      return reject(
        "ERR_OVER_MAX_PER_TX",
        `Requested amount ${mandate.amount.toString()} exceeds maxPerTx ceiling ${effectiveMaxPerTx.toString()}.`
      );
    }

    const currentTracker = this.getDailyTracker(mandate.buyerAgent, mandate.token, nowSec);
    const projectedSpend = currentTracker.spent + mandate.amount;
    if (projectedSpend > effectiveDailyCap) {
      return reject(
        "ERR_DAILY_CAP_EXCEEDED",
        `Projected 24h spend ${projectedSpend.toString()} exceeds dailyCap ${effectiveDailyCap.toString()}.`
      );
    }

    const available = this.getVaultBalance(mandate.buyerAgent, mandate.token);
    if (available < mandate.amount) {
      return reject(
        "ERR_INSUFFICIENT_VAULT_BALANCE",
        `Available vault balance ${available.toString()} is below required ${mandate.amount.toString()}.`
      );
    }

    // Commit state atomically
    this.usedNonces.add(nKey);
    this.dailyTrackers.set(bKey, {
      windowStart: currentTracker.windowStart,
      spent: projectedSpend
    });
    this.vaultBalances.set(bKey, available - mandate.amount);

    const providerKey = this.balanceKey(mandate.providerAgent, mandate.token);
    this.providerEarnings.set(providerKey, (this.providerEarnings.get(providerKey) ?? 0n) + mandate.amount);

    this.receiptCount += 1n;
    const receiptId = keccak256(
      encodeAbiParameters(parseAbiParameters("bytes32, bytes32, uint256, uint256, uint256"), [
        mandateDigest,
        executionProofHash,
        BigInt(this.chainId),
        nowSec,
        this.receiptCount
      ])
    );

    const receipt: SettlementReceiptRecord = {
      status: "SETTLED",
      receiptId,
      mandateDigest,
      buyerAgent: mandate.buyerAgent,
      providerAgent: mandate.providerAgent,
      token: mandate.token,
      amount: mandate.amount.toString(),
      nonce: mandate.nonce.toString(),
      taskHash: mandate.taskHash,
      executionProofHash,
      signature,
      recoveredSigner,
      network: this.network,
      chainId: this.chainId,
      verifyingContract: this.verifyingContract,
      settledAt: Number(nowSec),
      mandateJson: serializeMandateForJson(mandate),
      explorerUrl: `${HSK_NETWORKS[this.network].explorerUrl}/address/${this.verifyingContract}`
    };
    this.history = [receipt, ...this.history];
    return receipt;
  }

  private balanceKey(agent: string, token: string): string {
    return `${agent.toLowerCase()}::${token.toLowerCase()}`;
  }

  private nonceKey(agent: string, nonce: bigint): string {
    return `${agent.toLowerCase()}::${nonce.toString()}`;
  }
}
