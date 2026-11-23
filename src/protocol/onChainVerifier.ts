import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  decodeErrorResult,
  decodeEventLog,
  decodeFunctionData,
  defineChain,
  formatEther,
  http,
  parseUnits,
  toFunctionSelector
} from "viem";
import {
  AGENT_TASK_CATALOG,
  SANDBOX_ATTACKER_KEY,
  SANDBOX_BUYER_ADDRESS,
  SANDBOX_BUYER_KEY,
  SANDBOX_PROVIDER_ADDRESS
} from "./a2aWorkflow";
import {
  buildMandateDomain,
  computeMandateDigest,
  hashCanonicalTaskPayload,
  signPaymentMandate,
  type PaymentMandate
} from "./eip712";
import { HSK_NETWORKS, LIVE_TESTNET_SHOWCASE, SETTLEMENT_TOKENS, ZERO_ADDRESS } from "./networks";
import { MANDATE_VAULT_ABI } from "./vaultAbi";

export interface OnChainReceiptSummary {
  index: 1 | 2;
  label: string;
  workerLabel: string;
  txHash: `0x${string}`;
  explorerTxUrl: string;
  blockNumber: bigint;
  gasUsed: bigint;
  receiptId: `0x${string}`;
  mandateDigest: `0x${string}`;
  buyerAgent: `0x${string}`;
  providerAgent: `0x${string}`;
  token: `0x${string}`;
  amountWei: bigint;
  amountFormattedHsk: string;
  nonce: bigint;
  taskHash: `0x${string}`;
  executionProofHash: `0x${string}`;
  settledAt: bigint;
  digestVerified: boolean;
  mandate: PaymentMandate;
  signature: `0x${string}`;
}

export interface BlockscoutVerificationStatus {
  checked: boolean;
  isVerified: boolean;
  contractName: string | null;
  compilerVersion: string | null;
  optimizationEnabled: boolean | null;
  licenseType: string | null;
  explorerContractUrl: string;
}

export interface LiveVaultSnapshot {
  reachable: boolean;
  chainId: number;
  blockNumber: bigint;
  blockTimestamp: bigint;
  latencyMs: number;
  vaultAddress: `0x${string}`;
  bytecodeSizeBytes: number;
  domainSeparator: `0x${string}`;
  totalReceipts: bigint;
  nonce1Used: boolean;
  nonce2Used: boolean;
  dailySpentWei: bigint;
  dailyWindowStart: bigint;
  principalPolicy: {
    maxPerTxCeilingWei: bigint;
    dailyCapCeilingWei: bigint;
    enforced: boolean;
    frozen: boolean;
  };
  receipts: OnChainReceiptSummary[];
  blockscout: BlockscoutVerificationStatus;
  checkedAtIso: string;
  error?: string;
}

export interface DecodedVaultRevert {
  errorName: string;
  args: string[];
  summary: string;
  rawMessage: string;
}

export interface OnChainRevertProof {
  mode: "replay-tx1" | "replay-tx2" | "over-max-tx" | "invalid-sig" | "expired";
  title: string;
  revertedAsExpected: boolean;
  errorName: string;
  decodedArgs: string[];
  summary: string;
  checkedBlock: string;
  latencyMs: number;
  rawMessage: string;
}

export interface VerificationSnippets {
  curl: string;
  cast: string;
  viem: string;
}

function getTestnetClient(rpcUrl = HSK_NETWORKS.testnet.rpcUrl) {
  const cfg = HSK_NETWORKS.testnet;
  const chain = defineChain({
    id: cfg.chainId,
    name: cfg.name,
    nativeCurrency: cfg.nativeCurrency,
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: { default: { name: "Blockscout", url: cfg.explorerUrl } }
  });
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

function formatRevertArg(arg: unknown): string {
  if (typeof arg === "bigint") return arg.toString();
  if (typeof arg === "string") return arg;
  return JSON.stringify(arg);
}

export function decodeVaultRevertError(err: unknown): DecodedVaultRevert {
  if (typeof err === "string" && err.startsWith("0x")) {
    try {
      const decoded = decodeErrorResult({
        abi: MANDATE_VAULT_ABI,
        data: err as `0x${string}`
      });
      const args = (decoded.args ?? []).map(formatRevertArg);
      return {
        errorName: decoded.errorName,
        args,
        summary: `${decoded.errorName}(${args.join(", ")})`,
        rawMessage: err
      };
    } catch {
      return {
        errorName: "UnknownRevertData",
        args: [],
        summary: `Reverted with raw data ${err.slice(0, 18)}...`,
        rawMessage: err
      };
    }
  }

  if (err instanceof BaseError) {
    const reverted = err.walk((item) => item instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError && reverted.data) {
      const args = (reverted.data.args ?? []).map(formatRevertArg);
      return {
        errorName: reverted.data.errorName,
        args,
        summary: `${reverted.data.errorName}(${args.join(", ")})`,
        rawMessage: err.shortMessage || err.message
      };
    }
    return {
      errorName: "ContractRevert",
      args: [],
      summary: err.shortMessage || err.message,
      rawMessage: err.message
    };
  }

  const msg = err instanceof Error ? err.message : String(err);
  return {
    errorName: "RpcOrUnknownError",
    args: [],
    summary: msg,
    rawMessage: msg
  };
}

async function fetchBlockscoutVerificationStatus(
  vaultAddress: `0x${string}`,
  explorerUrl = HSK_NETWORKS.testnet.explorerUrl
): Promise<BlockscoutVerificationStatus> {
  const explorerContractUrl = `${explorerUrl}/address/${vaultAddress}?tab=contract`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetch(`${explorerUrl}/api/v2/smart-contracts/${vaultAddress}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    if (!resp.ok) {
      return {
        checked: false,
        isVerified: false,
        contractName: null,
        compilerVersion: null,
        optimizationEnabled: null,
        licenseType: null,
        explorerContractUrl
      };
    }
    const data = (await resp.json()) as {
      is_verified?: boolean;
      name?: string | null;
      compiler_version?: string | null;
      optimization_enabled?: boolean | null;
      license_type?: string | null;
    };
    return {
      checked: true,
      isVerified: Boolean(data.is_verified),
      contractName: data.name ?? null,
      compilerVersion: data.compiler_version ?? null,
      optimizationEnabled: data.optimization_enabled ?? null,
      licenseType: data.license_type ?? null,
      explorerContractUrl
    };
  } catch {
    return {
      checked: false,
      isVerified: false,
      contractName: null,
      compilerVersion: null,
      optimizationEnabled: null,
      licenseType: null,
      explorerContractUrl
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchReceiptFromTx(
  client: ReturnType<typeof getTestnetClient>,
  params: {
    index: 1 | 2;
    label: string;
    workerLabel: string;
    txHash: `0x${string}`;
    explorerUrl: string;
  }
): Promise<OnChainReceiptSummary> {
  const [tx, receipt] = await Promise.all([
    client.getTransaction({ hash: params.txHash }),
    client.getTransactionReceipt({ hash: params.txHash })
  ]);

  const fn = decodeFunctionData({ abi: MANDATE_VAULT_ABI, data: tx.input });
  if (fn.functionName !== "settleMandate" || !fn.args || fn.args.length < 2) {
    throw new Error(`Expected settleMandate calldata in ${params.txHash}, found ${fn.functionName}`);
  }
  const rawMandate = fn.args[0] as unknown as PaymentMandate;
  const signature = fn.args[1] as unknown as `0x${string}`;

  for (const log of receipt.logs) {
    try {
      const ev = decodeEventLog({
        abi: MANDATE_VAULT_ABI,
        data: log.data,
        topics: log.topics
      });
      if (ev.eventName === "SettlementReceipt") {
        const args = ev.args as unknown as {
          receiptId: `0x${string}`;
          mandateDigest: `0x${string}`;
          buyerAgent: `0x${string}`;
          providerAgent: `0x${string}`;
          token: `0x${string}`;
          amount: bigint;
          nonce: bigint;
          taskHash: `0x${string}`;
          executionProofHash: `0x${string}`;
          settledAt: bigint;
        };
        const expectedDigest = computeMandateDigest(
          buildMandateDomain(HSK_NETWORKS.testnet.chainId, LIVE_TESTNET_SHOWCASE.vaultAddress),
          rawMandate
        );
        return {
          index: params.index,
          label: params.label,
          workerLabel: params.workerLabel,
          txHash: params.txHash,
          explorerTxUrl: `${params.explorerUrl}/tx/${params.txHash}`,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed,
          receiptId: args.receiptId,
          mandateDigest: args.mandateDigest,
          buyerAgent: args.buyerAgent,
          providerAgent: args.providerAgent,
          token: args.token,
          amountWei: args.amount,
          amountFormattedHsk: formatEther(args.amount),
          nonce: args.nonce,
          taskHash: args.taskHash,
          executionProofHash: args.executionProofHash,
          settledAt: args.settledAt,
          digestVerified: expectedDigest.toLowerCase() === args.mandateDigest.toLowerCase(),
          mandate: rawMandate,
          signature
        };
      }
    } catch {
      // Ignore non-SettlementReceipt logs
    }
  }

  throw new Error(`SettlementReceipt log not found in ${params.txHash}`);
}

export async function fetchLiveTestnetVaultSnapshot(
  rpcUrl = HSK_NETWORKS.testnet.rpcUrl,
  explorerUrl = HSK_NETWORKS.testnet.explorerUrl
): Promise<LiveVaultSnapshot> {
  const started = performance.now();
  const checkedAtIso = new Date().toISOString();
  const vault = LIVE_TESTNET_SHOWCASE.vaultAddress;
  const deployer = LIVE_TESTNET_SHOWCASE.deployerAddress;
  const client = getTestnetClient(rpcUrl);

  try {
    const [
      chainId,
      latestBlock,
      code,
      totalReceipts,
      domainSeparator,
      nonce1Used,
      nonce2Used,
      dailyTracker,
      policy,
      receipt1,
      receipt2,
      blockscout
    ] = await Promise.all([
      client.getChainId(),
      client.getBlock(),
      client.getCode({ address: vault }),
      client.readContract({ address: vault, abi: MANDATE_VAULT_ABI, functionName: "totalReceipts" }) as Promise<bigint>,
      client.readContract({ address: vault, abi: MANDATE_VAULT_ABI, functionName: "domainSeparator" }) as Promise<`0x${string}`>,
      client.readContract({ address: vault, abi: MANDATE_VAULT_ABI, functionName: "usedNonces", args: [deployer, 1n] }) as Promise<boolean>,
      client.readContract({ address: vault, abi: MANDATE_VAULT_ABI, functionName: "usedNonces", args: [deployer, 2n] }) as Promise<boolean>,
      client.readContract({
        address: vault,
        abi: MANDATE_VAULT_ABI,
        functionName: "dailyTrackers",
        args: [deployer, ZERO_ADDRESS]
      }) as Promise<readonly [bigint, bigint]>,
      client.readContract({
        address: vault,
        abi: MANDATE_VAULT_ABI,
        functionName: "principalPolicies",
        args: [deployer, ZERO_ADDRESS]
      }) as Promise<readonly [bigint, bigint, boolean, boolean]>,
      fetchReceiptFromTx(client, {
        index: 1,
        label: "Receipt #1 · VeriGuard Audit Agent",
        workerLabel: "Worker A (0x7099...79C8)",
        txHash: LIVE_TESTNET_SHOWCASE.settlementTx1Hash,
        explorerUrl
      }),
      fetchReceiptFromTx(client, {
        index: 2,
        label: "Receipt #2 · Routed KYT & Oracle Hop",
        workerLabel: "Worker B (0x3C44...93BC)",
        txHash: LIVE_TESTNET_SHOWCASE.settlementTx2Hash,
        explorerUrl
      }),
      fetchBlockscoutVerificationStatus(vault, explorerUrl)
    ]);

    const bytecodeSizeBytes = code && code.startsWith("0x") ? (code.length - 2) / 2 : 0;

    return {
      reachable: chainId === HSK_NETWORKS.testnet.chainId && bytecodeSizeBytes > 0,
      chainId,
      blockNumber: latestBlock.number,
      blockTimestamp: latestBlock.timestamp,
      latencyMs: Math.round(performance.now() - started),
      vaultAddress: vault,
      bytecodeSizeBytes,
      domainSeparator,
      totalReceipts,
      nonce1Used,
      nonce2Used,
      dailyWindowStart: dailyTracker[0],
      dailySpentWei: dailyTracker[1],
      principalPolicy: {
        maxPerTxCeilingWei: policy[0],
        dailyCapCeilingWei: policy[1],
        enforced: policy[2],
        frozen: policy[3]
      },
      receipts: [receipt1, receipt2],
      blockscout,
      checkedAtIso
    };
  } catch (err) {
    return {
      reachable: false,
      chainId: HSK_NETWORKS.testnet.chainId,
      blockNumber: 0n,
      blockTimestamp: 0n,
      latencyMs: Math.round(performance.now() - started),
      vaultAddress: vault,
      bytecodeSizeBytes: 0,
      domainSeparator: "0x0000000000000000000000000000000000000000000000000000000000000000",
      totalReceipts: 0n,
      nonce1Used: false,
      nonce2Used: false,
      dailyWindowStart: 0n,
      dailySpentWei: 0n,
      principalPolicy: {
        maxPerTxCeilingWei: 0n,
        dailyCapCeilingWei: 0n,
        enforced: false,
        frozen: false
      },
      receipts: [],
      blockscout: {
        checked: false,
        isVerified: false,
        contractName: null,
        compilerVersion: null,
        optimizationEnabled: null,
        licenseType: null,
        explorerContractUrl: `${explorerUrl}/address/${vault}?tab=contract`
      },
      checkedAtIso,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

export async function proveReplayProtectionOnChain(
  receipt: OnChainReceiptSummary,
  rpcUrl = HSK_NETWORKS.testnet.rpcUrl
): Promise<OnChainRevertProof> {
  const started = performance.now();
  const client = getTestnetClient(rpcUrl);
  const vault = LIVE_TESTNET_SHOWCASE.vaultAddress;
  const mode: "replay-tx1" | "replay-tx2" = receipt.index === 1 ? "replay-tx1" : "replay-tx2";
  const title = `Replay Receipt #${receipt.index} Signed Mandate (Nonce #${receipt.nonce.toString()})`;

  const trySimulate = async (blockNumber?: bigint) => {
    await client.simulateContract({
      address: vault,
      abi: MANDATE_VAULT_ABI,
      functionName: "settleMandate",
      args: [receipt.mandate, receipt.signature, receipt.executionProofHash],
      account: receipt.buyerAgent,
      ...(blockNumber !== undefined ? { blockNumber } : {})
    });
  };

  try {
    await trySimulate();
    return {
      mode,
      title,
      revertedAsExpected: false,
      errorName: "UnexpectedSuccess",
      decodedArgs: [],
      summary: "Simulation unexpectedly succeeded without reverting.",
      checkedBlock: "latest",
      latencyMs: Math.round(performance.now() - started),
      rawMessage: ""
    };
  } catch (err) {
    const decoded = decodeVaultRevertError(err);
    if (decoded.errorName === "NonceAlreadyUsed") {
      return {
        mode,
        title,
        revertedAsExpected: true,
        errorName: decoded.errorName,
        decodedArgs: decoded.args,
        summary: decoded.summary,
        checkedBlock: "latest",
        latencyMs: Math.round(performance.now() - started),
        rawMessage: decoded.rawMessage
      };
    }

    // If showcase validBefore TTL has elapsed since deployment, verify at post-settlement block
    if (decoded.errorName === "MandateExpired") {
      const proofBlock = receipt.blockNumber + 1n;
      try {
        await trySimulate(proofBlock);
      } catch (histErr) {
        const histDecoded = decodeVaultRevertError(histErr);
        return {
          mode,
          title,
          revertedAsExpected: histDecoded.errorName === "NonceAlreadyUsed",
          errorName: histDecoded.errorName,
          decodedArgs: histDecoded.args,
          summary: histDecoded.summary,
          checkedBlock: `#${proofBlock.toString()} (post-settlement block)`,
          latencyMs: Math.round(performance.now() - started),
          rawMessage: histDecoded.rawMessage
        };
      }
    }

    return {
      mode,
      title,
      revertedAsExpected: false,
      errorName: decoded.errorName,
      decodedArgs: decoded.args,
      summary: decoded.summary,
      checkedBlock: "latest",
      latencyMs: Math.round(performance.now() - started),
      rawMessage: decoded.rawMessage
    };
  }
}

export async function proveLiveGuardrailRevertOnChain(
  mode: "over-max-tx" | "invalid-sig" | "expired",
  rpcUrl = HSK_NETWORKS.testnet.rpcUrl
): Promise<OnChainRevertProof> {
  const started = performance.now();
  const client = getTestnetClient(rpcUrl);
  const vault = LIVE_TESTNET_SHOWCASE.vaultAddress;
  const block = await client.getBlock();
  const domain = buildMandateDomain(HSK_NETWORKS.testnet.chainId, vault);

  const taskHash = hashCanonicalTaskPayload({
    taskId: AGENT_TASK_CATALOG[0].id,
    mode,
    chainId: HSK_NETWORKS.testnet.chainId
  });

  const isOverCap = mode === "over-max-tx";
  const isExpired = mode === "expired";
  const nonceByMode = isOverCap ? 990001n : isExpired ? 990003n : 990002n;
  const mandate: PaymentMandate = {
    buyerAgent: SANDBOX_BUYER_ADDRESS,
    providerAgent: SANDBOX_PROVIDER_ADDRESS,
    token: SETTLEMENT_TOKENS.USDC.address,
    amount: parseUnits(isOverCap ? "50.00" : "10.00", 6),
    maxPerTx: parseUnits("25.00", 6),
    dailyCap: parseUnits("100.00", 6),
    nonce: nonceByMode,
    validAfter: block.timestamp - 3600n,
    validBefore: isExpired ? block.timestamp - 60n : block.timestamp + 300n,
    taskHash
  };

  const signingKey = mode === "invalid-sig" ? SANDBOX_ATTACKER_KEY : SANDBOX_BUYER_KEY;
  const signed = await signPaymentMandate(signingKey, domain, mandate);
  const title = isOverCap
    ? "Live EVM Check: 50 USDC Mandate vs 25 USDC maxPerTx"
    : isExpired
      ? "Live EVM Check: Expired Mandate TTL (validBefore < blockTime)"
      : "Live EVM Check: Forged Attacker ECDSA Signer";
  const expectedError = isOverCap ? "OverMaxPerTx" : isExpired ? "MandateExpired" : "InvalidSignature";

  try {
    await client.simulateContract({
      address: vault,
      abi: MANDATE_VAULT_ABI,
      functionName: "settleMandate",
      args: [mandate, signed.signature, taskHash],
      account: SANDBOX_BUYER_ADDRESS
    });
    return {
      mode,
      title,
      revertedAsExpected: false,
      errorName: "UnexpectedSuccess",
      decodedArgs: [],
      summary: "Simulation succeeded unexpectedly.",
      checkedBlock: `latest (#${block.number.toString()})`,
      latencyMs: Math.round(performance.now() - started),
      rawMessage: ""
    };
  } catch (err) {
    const decoded = decodeVaultRevertError(err);
    return {
      mode,
      title,
      revertedAsExpected: decoded.errorName === expectedError,
      errorName: decoded.errorName,
      decodedArgs: decoded.args,
      summary: decoded.summary,
      checkedBlock: `latest (#${block.number.toString()})`,
      latencyMs: Math.round(performance.now() - started),
      rawMessage: decoded.rawMessage
    };
  }
}

export function buildVerificationSnippets(
  vaultAddress: `0x${string}` = LIVE_TESTNET_SHOWCASE.vaultAddress,
  buyerAddress: `0x${string}` = LIVE_TESTNET_SHOWCASE.deployerAddress
): VerificationSnippets {
  const rpc = HSK_NETWORKS.testnet.rpcUrl;
  const totalReceiptsSelector = toFunctionSelector("totalReceipts()");
  return {
    curl: `# 1. Read totalReceipts() (${totalReceiptsSelector}) on HSK 133
curl -s -X POST ${rpc} \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_call",
  "params":[{"to":"${vaultAddress}",
  "data":"${totalReceiptsSelector}"},"latest"]}'

# 2. Verify deployed vault bytecode on-chain
curl -s -X POST ${rpc} \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":2,"method":"eth_getCode",
  "params":["${vaultAddress}","latest"]}'`,

    cast: `# Read vault state & principal guardrails via Foundry cast
cast call ${vaultAddress} \\
  "totalReceipts()(uint256)" --rpc-url ${rpc}
cast call ${vaultAddress} \\
  "usedNonces(address,uint256)(bool)" \\
  ${buyerAddress} 2 --rpc-url ${rpc}
cast call ${vaultAddress} \\
  "principalPolicies(address,address)(uint256,uint256,bool,bool)" \\
  ${buyerAddress} ${ZERO_ADDRESS} --rpc-url ${rpc}`,

    viem: `import { createPublicClient, http, parseAbi } from "viem";

const client = createPublicClient({
  transport: http("${rpc}")
});
const abi = parseAbi([
  "function totalReceipts() view returns (uint256)",
  "function usedNonces(address,uint256) view returns (bool)"
]);

const [receipts, nonce2Used] = await Promise.all([
  client.readContract({
    address: "${vaultAddress}",
    abi,
    functionName: "totalReceipts"
  }),
  client.readContract({
    address: "${vaultAddress}",
    abi,
    functionName: "usedNonces",
    args: ["${buyerAddress}", 2n]
  })
]);
console.log({ receipts: receipts.toString(), nonce2Used });`
  };
}
