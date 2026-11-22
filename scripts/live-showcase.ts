import fs from "node:fs";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  formatEther,
  http,
  keccak256,
  parseEther,
  stringToHex,
  type Abi,
  type Hex
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

interface ArtifactShape {
  contractName: string;
  abi: Abi;
}

const HSK_TESTNET = {
  name: "HashKey Chain Testnet",
  chainId: 133,
  rpcUrl: process.env.HSK_TESTNET_RPC || "https://testnet.hsk.xyz",
  explorerUrl: "https://testnet-explorer.hskchain.net",
  vaultAddress: "0xc91469d4acc815b485f5b961bf49c7f0764a50cf" as const
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
// Worker B (ComplianceGate KYT + PythBridge Routed Hop #2 — matches SANDBOX_PROVIDER_ADDRESS)
const WORKER_B_PROVIDER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const PARENT_RECEIPT_REF = "0xfbf168d51c8120f5a467fd38ab2f2e170c49af7449d71af8b5cae53e7f1e25c5" as const;

const PAYMENT_MANDATE_TYPES = {
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

function loadEnvIfPresent(rootDir: string): void {
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

function canonicalKeccak(payload: Record<string, unknown>): `0x${string}` {
  const ordered: Record<string, unknown> = {};
  for (const k of Object.keys(payload).sort()) {
    ordered[k] = payload[k];
  }
  return keccak256(stringToHex(JSON.stringify(ordered)));
}

async function main(): Promise<void> {
  const rootDir = process.cwd();
  loadEnvIfPresent(rootDir);

  const artifactPath = path.join(rootDir, "artifacts", "MandateSettlementVault.json");
  if (!fs.existsSync(artifactPath)) {
    throw new Error("Missing artifacts/MandateSettlementVault.json. Run npm.cmd run compile:contracts first.");
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as ArtifactShape;

  const chain = defineChain({
    id: HSK_TESTNET.chainId,
    name: HSK_TESTNET.name,
    nativeCurrency: { name: "HSK", symbol: "HSK", decimals: 18 },
    rpcUrls: { default: { http: [HSK_TESTNET.rpcUrl] } },
    blockExplorers: { default: { name: "Blockscout", url: HSK_TESTNET.explorerUrl } }
  });

  const publicClient = createPublicClient({
    chain,
    transport: http(HSK_TESTNET.rpcUrl)
  });

  const liveChainId = await publicClient.getChainId();
  if (liveChainId !== HSK_TESTNET.chainId) {
    throw new Error(`Expected chainId ${HSK_TESTNET.chainId}, got ${liveChainId}`);
  }

  const rawKey = process.env.DEPLOYER_PRIVATE_KEY?.trim();
  if (!rawKey) {
    throw new Error("DEPLOYER_PRIVATE_KEY missing in .env (or env). Never commit .env.");
  }

  const normalizedKey = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as Hex;
  const account = privateKeyToAccount(normalizedKey);
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(HSK_TESTNET.rpcUrl)
  });

  const balanceBefore = await publicClient.getBalance({ address: account.address });
  if (balanceBefore < parseEther("0.085")) {
    throw new Error(
      `Deployer balance ${formatEther(balanceBefore)} HSK is too close to 0.08 HSK safety floor.`
    );
  }

  const latestBlock = await publicClient.getBlock();
  const totalReceiptsBefore = (await publicClient.readContract({
    address: HSK_TESTNET.vaultAddress,
    abi: artifact.abi,
    functionName: "totalReceipts"
  })) as bigint;
  const nonce2Used = (await publicClient.readContract({
    address: HSK_TESTNET.vaultAddress,
    abi: artifact.abi,
    functionName: "usedNonces",
    args: [account.address, 2n]
  })) as boolean;

  console.log(`Vault: ${HSK_TESTNET.vaultAddress}`);
  console.log(`Buyer/Deployer: ${account.address}`);
  console.log(`Balance Before: ${formatEther(balanceBefore)} HSK`);
  console.log(`Total Receipts Before: ${totalReceiptsBefore.toString()}`);

  if (nonce2Used) {
    throw new Error("Nonce #2 is already consumed on-chain; refusing duplicate showcase tx.");
  }

  // Transaction 1: Multi-Agent Routed Split-Hop Settlement #2 -> Worker B
  const taskHash = canonicalKeccak({
    capability: "institutional-kyt-and-twap-hop",
    hop: 2,
    parentReceiptId: PARENT_RECEIPT_REF,
    provider: WORKER_B_PROVIDER,
    protocol: "MandateRail-HSP-x402"
  });
  const executionProofHash = canonicalKeccak({
    deliverable: "Zero-PII KYT + 15m HSK/USDT TWAP routed attestation",
    parentReceiptId: PARENT_RECEIPT_REF,
    taskHash,
    worker: WORKER_B_PROVIDER
  });

  const mandate = {
    buyerAgent: account.address,
    providerAgent: WORKER_B_PROVIDER,
    token: ZERO_ADDRESS,
    amount: parseEther("0.0005"),
    maxPerTx: parseEther("0.005"),
    dailyCap: parseEther("0.02"),
    nonce: 2n,
    validAfter: latestBlock.timestamp - 60n,
    validBefore: latestBlock.timestamp + 3600n,
    taskHash
  };

  const domain = {
    name: "MandateRail HSP",
    version: "1",
    chainId: HSK_TESTNET.chainId,
    verifyingContract: HSK_TESTNET.vaultAddress
  } as const;

  const signature = await account.signTypedData({
    domain,
    types: PAYMENT_MANDATE_TYPES,
    primaryType: "PaymentMandate",
    message: mandate
  });

  const settleTxHash = await walletClient.writeContract({
    address: HSK_TESTNET.vaultAddress,
    abi: artifact.abi,
    functionName: "settleMandate",
    args: [mandate, signature, executionProofHash],
    value: mandate.amount
  });

  const settleReceipt = await publicClient.waitForTransactionReceipt({ hash: settleTxHash });
  let receiptId2: string | null = null;
  let mandateDigest2: string | null = null;
  let settledAt2: string | null = null;

  for (const log of settleReceipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: artifact.abi,
        data: log.data,
        topics: log.topics
      });
      if (decoded.eventName === "SettlementReceipt") {
        const args = decoded.args as {
          receiptId: `0x${string}`;
          mandateDigest: `0x${string}`;
          settledAt: bigint;
        };
        receiptId2 = args.receiptId;
        mandateDigest2 = args.mandateDigest;
        settledAt2 = args.settledAt.toString();
      }
    } catch {
      // ignore unrelated logs
    }
  }

  // Transaction 2: Live Principal Guardrail Policy Activation (enforced=true, frozen=false)
  const maxPerTxCeiling = parseEther("0.005");
  const dailyCapCeiling = parseEther("0.02");
  const policyTxHash = await walletClient.writeContract({
    address: HSK_TESTNET.vaultAddress,
    abi: artifact.abi,
    functionName: "setPrincipalPolicy",
    args: [account.address, ZERO_ADDRESS, maxPerTxCeiling, dailyCapCeiling, true, false]
  });
  const policyReceipt = await publicClient.waitForTransactionReceipt({ hash: policyTxHash });

  // Verify post-tx on-chain invariants
  const [balanceAfter, totalReceiptsAfter, policyAfter] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    publicClient.readContract({
      address: HSK_TESTNET.vaultAddress,
      abi: artifact.abi,
      functionName: "totalReceipts"
    }) as Promise<bigint>,
    publicClient.readContract({
      address: HSK_TESTNET.vaultAddress,
      abi: artifact.abi,
      functionName: "principalPolicies",
      args: [account.address, ZERO_ADDRESS]
    }) as Promise<readonly [bigint, bigint, boolean, boolean]>
  ]);

  let replayBlockedError = "NOT_REVERTED";
  try {
    await publicClient.simulateContract({
      address: HSK_TESTNET.vaultAddress,
      abi: artifact.abi,
      functionName: "settleMandate",
      args: [mandate, signature, executionProofHash],
      account: account.address
    });
  } catch (err) {
    replayBlockedError = err instanceof Error ? err.message.split("\n")[0] : String(err);
  }

  const totalSpent = balanceBefore - balanceAfter;
  const summary = {
    vaultAddress: HSK_TESTNET.vaultAddress,
    chainId: HSK_TESTNET.chainId,
    explorerAddressUrl: `${HSK_TESTNET.explorerUrl}/address/${HSK_TESTNET.vaultAddress}`,
    tx1_settleHop2: {
      txHash: settleTxHash,
      explorerTxUrl: `${HSK_TESTNET.explorerUrl}/tx/${settleTxHash}`,
      blockNumber: settleReceipt.blockNumber.toString(),
      gasUsed: settleReceipt.gasUsed.toString(),
      status: settleReceipt.status,
      providerAgent: WORKER_B_PROVIDER,
      amountHSK: formatEther(mandate.amount),
      nonce: mandate.nonce.toString(),
      taskHash,
      executionProofHash,
      mandateDigest: mandateDigest2,
      receiptId: receiptId2,
      settledAt: settledAt2
    },
    tx2_principalPolicy: {
      txHash: policyTxHash,
      explorerTxUrl: `${HSK_TESTNET.explorerUrl}/tx/${policyTxHash}`,
      blockNumber: policyReceipt.blockNumber.toString(),
      gasUsed: policyReceipt.gasUsed.toString(),
      status: policyReceipt.status,
      maxPerTxCeilingHSK: formatEther(policyAfter[0]),
      dailyCapCeilingHSK: formatEther(policyAfter[1]),
      enforced: policyAfter[2],
      frozen: policyAfter[3]
    },
    verification: {
      totalReceiptsAfter: totalReceiptsAfter.toString(),
      replaySimulationResult: replayBlockedError,
      balanceBeforeHSK: formatEther(balanceBefore),
      balanceAfterHSK: formatEther(balanceAfter),
      totalDeltaHSK: formatEther(totalSpent)
    }
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error("[live-showcase error]", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
