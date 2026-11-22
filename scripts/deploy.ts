import fs from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, defineChain, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

interface ArtifactShape {
  contractName: string;
  abi: readonly unknown[];
  bytecode: `0x${string}`;
}

const HSK_NETWORKS = {
  testnet: {
    name: "HashKey Chain Testnet",
    chainId: 133,
    rpcUrl: process.env.HSK_TESTNET_RPC || "https://testnet.hsk.xyz",
    explorerUrl: "https://testnet-explorer.hskchain.net",
    gasGrantNote: "Claim free Testnet HSK at https://faucet.hsk.xyz"
  },
  mainnet: {
    name: "HashKey Chain Mainnet",
    chainId: 177,
    rpcUrl: process.env.HSK_MAINNET_RPC || "https://mainnet.hsk.xyz",
    explorerUrl: "https://hsk.blockscout.com",
    gasGrantNote: "Request free organizer HSK gas grant via HashFans / DoraHacks Telegram (zero-capital guard)"
  }
} as const;

function parseArgs(): "testnet" | "mainnet" {
  const idx = process.argv.indexOf("--network");
  const raw = idx !== -1 ? process.argv[idx + 1] : process.env.HSK_NETWORK || "testnet";
  if (raw === "hsk_mainnet" || raw === "mainnet") return "mainnet";
  return "testnet";
}

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

async function main(): Promise<void> {
  const rootDir = process.cwd();
  loadEnvIfPresent(rootDir);

  const networkKey = parseArgs();
  const cfg = HSK_NETWORKS[networkKey];

  const artifactPath = path.join(rootDir, "artifacts", "MandateSettlementVault.json");
  if (!fs.existsSync(artifactPath)) {
    throw new Error("Compiled artifact not found. Run `npm.cmd run compile:contracts` first.");
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as ArtifactShape;

  const chain = defineChain({
    id: cfg.chainId,
    name: cfg.name,
    nativeCurrency: { name: "HSK", symbol: "HSK", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
    blockExplorers: { default: { name: "Explorer", url: cfg.explorerUrl } }
  });

  const publicClient = createPublicClient({
    chain,
    transport: http(cfg.rpcUrl)
  });

  const liveChainId = await publicClient.getChainId();
  if (liveChainId !== cfg.chainId) {
    throw new Error(`RPC chainId mismatch: expected ${cfg.chainId}, got ${liveChainId}`);
  }

  const rawKey = process.env.DEPLOYER_PRIVATE_KEY?.trim();
  if (!rawKey) {
    console.log(`[dry-run] Verified ${cfg.name} (chainId ${liveChainId}) RPC reachable at ${cfg.rpcUrl}.`);
    console.log(`[action] Set DEPLOYER_PRIVATE_KEY in .env (git-ignored) and ${cfg.gasGrantNote}.`);
    return;
  }

  const normalizedKey = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`;
  const account = privateKeyToAccount(normalizedKey);
  const balance = await publicClient.getBalance({ address: account.address });

  console.log(`Target Network: ${cfg.name} (chainId ${cfg.chainId})`);
  console.log(`Deployer: ${account.address}`);
  console.log(`Balance: ${formatEther(balance)} HSK`);

  if (balance === 0n) {
    throw new Error(`Deployer balance is 0 HSK. ${cfg.gasGrantNote}.`);
  }

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(cfg.rpcUrl)
  });

  const txHash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args: []
  });

  console.log(`Deployment tx submitted: ${cfg.explorerUrl}/tx/${txHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log(`MandateSettlementVault deployed at: ${receipt.contractAddress}`);
  console.log(`Explorer contract: ${cfg.explorerUrl}/address/${receipt.contractAddress}`);
}

main().catch((err) => {
  console.error("[deploy error]", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
