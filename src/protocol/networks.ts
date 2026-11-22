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

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

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
    // Live MandateSettlementVault deployed on HashKey Chain Testnet (chainId 133)
    defaultVaultAddress: "0xc91469d4acc815b485f5b961bf49c7f0764a50cf",
    settlementNote:
      "Live MandateSettlementVault deployed on HSK Testnet (133) with verified on-chain SettlementReceipt proof."
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
    defaultVaultAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    settlementNote: "Production L2 environment. Claim organizer gas grant in HashFans / DoraHacks Telegram before deploying."
  }
};

export const SETTLEMENT_TOKENS: Record<"USDC" | "HSK", SettlementToken> = {
  USDC: {
    symbol: "USDC.hsk",
    name: "USD Coin (HSP Settlement Unit)",
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    decimals: 6
  },
  HSK: {
    symbol: "HSK",
    name: "Native HSK Gas & Settlement Token",
    address: ZERO_ADDRESS,
    decimals: 18
  }
};

async function jsonRpcCall<T = string>(rpcUrl: string, method: string, timeoutMs = 6000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
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
