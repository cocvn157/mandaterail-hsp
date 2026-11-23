export type HskNetworkKey = "testnet" | "mainnet";

export interface HskNetworkConfig {
  key: HskNetworkKey;
  name: string;
  shortName: string;
  chainId: number;
  chainIdHex: `0x${string}`;
  rpcUrl: string;
  explorerUrl: string;
  faucetUrl: string | null;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  defaultVaultAddress: `0x${string}`;
  settlementNote: string;
}

export interface SettlementToken {
  symbol: string;
  name: string;
  address: `0x${string}`;
  decimals: number;
}

export interface LiveRpcTelemetry {
  network: HskNetworkKey;
  reachable: boolean;
  chainId: number | null;
  chainIdHex: string | null;
  blockNumber: bigint | null;
  gasPriceGwei: string | null;
  latencyMs: number;
  checkedAtIso: string;
  error?: string;
}

export interface CircleSepoliaTelemetry {
  reachable: boolean;
  chainId: number;
  blockNumber: bigint | null;
  tokenAddress: `0x${string}`;
  symbol: string;
  decimals: number;
  codeSizeBytes: number;
  latencyMs: number;
  checkedAtIso: string;
  error?: string;
}

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export const LIVE_TESTNET_SHOWCASE = {
  chainId: 133,
  vaultAddress: "0xc91469d4acc815b485f5b961bf49c7f0764a50cf" as const,
  deployerAddress: "0x2584f4d5a0f9486dEe857b7F997f20f1A21a7D26" as const,
  workerAAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const,
  workerBAddress: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const,
  deployTxHash: "0xb955f22a108fe694bf60a7b49d8e5a6b5c45e8be099279093c466b88c12bb4a0" as const,
  deployBlockNumber: 36081920n,
  settlementTx1Hash: "0x539c74e0bebf40aa38e1aabf8e297e6e2ccca9c8b80d3ca41caf1e024a083c12" as const,
  settlementTx1BlockNumber: 36081959n,
  settlementTx2Hash: "0xc7924b5da836c25437ee26a3e28e1abd3d7918ab003e9fbd93b463e4ba55a167" as const,
  settlementTx2BlockNumber: 36082753n,
  policyTxHash: "0x5fccb1b99fe7bd328ee01caab9ce6c98880a48848262d38469c9439bd26c0899" as const,
  policyTxBlockNumber: 36082755n,
  compilerVersion: "v0.8.39+commit.ce47f2c8",
  creationBytecodeSha256: "5179a18445690fada8e28754750bc0855c183a510e4da8dda1a1bcf78e7eefb7",
  deployedBytecodeSha256: "f51f977f91eeb2cb9dab2dbd617bd2828c432db9953c4db66319bd5b1d5a3007"
} as const;

export const CIRCLE_SEPOLIA_USDC = {
  name: "Circle Testnet USDC (Ethereum Sepolia)",
  chainId: 11155111,
  rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
  explorerUrl: "https://sepolia.etherscan.io",
  faucetUrl: "https://faucet.circle.com",
  tokenAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as const,
  symbol: "USDC",
  decimals: 6
} as const;

export const HSK_NETWORKS: Record<HskNetworkKey, HskNetworkConfig> = {
  testnet: {
    key: "testnet",
    name: "HashKey Chain Testnet",
    shortName: "HSK Testnet",
    chainId: 133,
    chainIdHex: "0x85",
    rpcUrl: "https://testnet.hsk.xyz",
    explorerUrl: "https://testnet-explorer.hskchain.net",
    faucetUrl: "https://faucet.hsk.xyz",
    nativeCurrency: {
      name: "HashKey EcoPoints",
      symbol: "HSK",
      decimals: 18
    },
    // Live Blockscout-verified MandateSettlementVault on HashKey Chain Testnet (chainId 133)
    defaultVaultAddress: LIVE_TESTNET_SHOWCASE.vaultAddress,
    settlementNote:
      "Blockscout-verified MandateSettlementVault on HSK Testnet (133) with 2 live SettlementReceipts & enforced PrincipalPolicy."
  },
  mainnet: {
    key: "mainnet",
    name: "HashKey Chain Mainnet",
    shortName: "HSK Mainnet",
    chainId: 177,
    chainIdHex: "0xb1",
    rpcUrl: "https://mainnet.hsk.xyz",
    explorerUrl: "https://hsk.blockscout.com",
    faucetUrl: null,
    nativeCurrency: {
      name: "HashKey Platform Token",
      symbol: "HSK",
      decimals: 18
    },
    defaultVaultAddress: "0x0000000000000000000000000000000000000177",
    settlementNote:
      "Production L2 target (post-win Mainnet 177 migration via organizer gas grant — zero-capital compliant)."
  }
};

export const SETTLEMENT_TOKENS: Record<"USDC" | "HSK", SettlementToken> = {
  USDC: {
    symbol: "USDC.hsk",
    name: "USD Coin (Circle Sepolia / HSP Settlement Unit)",
    address: CIRCLE_SEPOLIA_USDC.tokenAddress,
    decimals: 6
  },
  HSK: {
    symbol: "HSK",
    name: "Native HSK Gas & Settlement Token",
    address: ZERO_ADDRESS,
    decimals: 18
  }
};

async function jsonRpcCall<T = string>(
  rpcUrl: string,
  method: string,
  params: unknown[] = [],
  timeoutMs = 6000
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = (await response.json()) as { result?: T; error?: { message?: string } };
    if (payload.error) {
      throw new Error(payload.error.message || "RPC JSON error");
    }
    if (payload.result === undefined) {
      throw new Error("Missing JSON-RPC result");
    }
    return payload.result;
  } finally {
    clearTimeout(timer);
  }
}

export async function probeHskNetwork(network: HskNetworkKey): Promise<LiveRpcTelemetry> {
  const cfg = HSK_NETWORKS[network];
  const started = performance.now();
  const checkedAtIso = new Date().toISOString();

  try {
    const [chainHex, blockHex, gasHex] = await Promise.all([
      jsonRpcCall<string>(cfg.rpcUrl, "eth_chainId"),
      jsonRpcCall<string>(cfg.rpcUrl, "eth_blockNumber"),
      jsonRpcCall<string>(cfg.rpcUrl, "eth_gasPrice")
    ]);

    const chainId = Number.parseInt(chainHex, 16);
    const blockNumber = BigInt(blockHex);
    const gasWei = BigInt(gasHex);
    const gasGwei = (Number(gasWei) / 1e9).toFixed(4);
    const latencyMs = Math.round(performance.now() - started);

    return {
      network,
      reachable: chainId === cfg.chainId,
      chainId,
      chainIdHex: chainHex,
      blockNumber,
      gasPriceGwei: gasGwei,
      latencyMs,
      checkedAtIso,
      error: chainId === cfg.chainId ? undefined : `Expected chainId ${cfg.chainId}, got ${chainId}`
    };
  } catch (err) {
    return {
      network,
      reachable: false,
      chainId: null,
      chainIdHex: null,
      blockNumber: null,
      gasPriceGwei: null,
      latencyMs: Math.round(performance.now() - started),
      checkedAtIso,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

export async function probeCircleSepoliaUsdc(): Promise<CircleSepoliaTelemetry> {
  const started = performance.now();
  const checkedAtIso = new Date().toISOString();

  try {
    const [chainHex, blockHex, codeHex] = await Promise.all([
      jsonRpcCall<string>(CIRCLE_SEPOLIA_USDC.rpcUrl, "eth_chainId"),
      jsonRpcCall<string>(CIRCLE_SEPOLIA_USDC.rpcUrl, "eth_blockNumber"),
      jsonRpcCall<string>(CIRCLE_SEPOLIA_USDC.rpcUrl, "eth_getCode", [
        CIRCLE_SEPOLIA_USDC.tokenAddress,
        "latest"
      ])
    ]);
    const chainId = Number.parseInt(chainHex, 16);
    const codeSizeBytes = codeHex && codeHex.startsWith("0x") ? (codeHex.length - 2) / 2 : 0;
    const reachable = chainId === CIRCLE_SEPOLIA_USDC.chainId && codeSizeBytes > 0;

    return {
      reachable,
      chainId,
      blockNumber: BigInt(blockHex),
      tokenAddress: CIRCLE_SEPOLIA_USDC.tokenAddress,
      symbol: CIRCLE_SEPOLIA_USDC.symbol,
      decimals: CIRCLE_SEPOLIA_USDC.decimals,
      codeSizeBytes,
      latencyMs: Math.round(performance.now() - started),
      checkedAtIso,
      error: reachable ? undefined : `Unexpected chainId ${chainId} or missing USDC bytecode`
    };
  } catch (err) {
    return {
      reachable: false,
      chainId: CIRCLE_SEPOLIA_USDC.chainId,
      blockNumber: null,
      tokenAddress: CIRCLE_SEPOLIA_USDC.tokenAddress,
      symbol: CIRCLE_SEPOLIA_USDC.symbol,
      decimals: CIRCLE_SEPOLIA_USDC.decimals,
      codeSizeBytes: 0,
      latencyMs: Math.round(performance.now() - started),
      checkedAtIso,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
