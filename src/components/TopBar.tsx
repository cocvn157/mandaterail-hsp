import { ExternalLink, Play, RefreshCw, RotateCcw, ShieldAlert, ShieldCheck } from "lucide-react";
import { HSK_NETWORKS, type HskNetworkKey, type LiveRpcTelemetry } from "../protocol/networks";

interface TopBarProps {
  network: HskNetworkKey;
  onSelectNetwork: (network: HskNetworkKey) => void;
  telemetry: LiveRpcTelemetry | null;
  probing: boolean;
  onProbeRpc: () => void;
  busy: boolean;
  onRunSettlement: () => void;
  onRunAllAttacks: () => void;
  onReset: () => void;
}

export function TopBar({
  network,
  onSelectNetwork,
  telemetry,
  probing,
  onProbeRpc,
  busy,
  onRunSettlement,
  onRunAllAttacks,
  onReset
}: TopBarProps) {
  const cfg = HSK_NETWORKS[network];
  const dotClass = probing ? "dot-warn" : telemetry?.reachable ? "dot-live" : "dot-err";

  return (
    <header className="panel topbar">
      <div className="brand-wrap">
        <div className="brand-icon" aria-hidden="true">
          <ShieldCheck size={20} />
        </div>
        <div>
          <div className="brand-title-row">
            <h1 className="brand-title">MandateRail HSP</h1>
            <span className="badge badge-emerald">HSK Horizon · Track 2</span>
            <span className="badge badge-cyan mono">x402 + EIP-712</span>
          </div>
          <p className="brand-subtitle">
            Cryptographic Agent Payment Mandates, Fail-Closed Spend Guardrails &amp; A2A Settlement on HashKey Chain
          </p>
        </div>
      </div>

      <div className="topbar-controls">
        <div className="segmented" role="group" aria-label="HashKey Chain Network">
          <button
            type="button"
            className={`segmented-btn ${network === "testnet" ? "active" : ""}`}
            onClick={() => onSelectNetwork("testnet")}
          >
            HSK Testnet (133)
          </button>
          <button
            type="button"
            className={`segmented-btn ${network === "mainnet" ? "active" : ""}`}
            onClick={() => onSelectNetwork("mainnet")}
          >
            HSK Mainnet (177)
          </button>
        </div>

        <div className="rpc-pill mono" title={`RPC: ${cfg.rpcUrl}`}>
          <span className={`dot ${dotClass}`} />
          <span>
            {probing
              ? `Probing ${cfg.chainId}...`
              : telemetry?.reachable && telemetry.blockNumber !== null
                ? `Block #${telemetry.blockNumber.toLocaleString()} · ${telemetry.latencyMs}ms`
                : `RPC ${telemetry?.error ? "Offline" : "Idle"}`}
          </span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={onProbeRpc}
            disabled={probing}
            aria-label="Probe live HSK RPC"
          >
            <RefreshCw size={12} />
            Probe
          </button>
          <a
            href={cfg.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="btn btn-sm"
            title={`Open ${cfg.shortName} Explorer`}
          >
            <ExternalLink size={12} />
          </a>
        </div>

        <button type="button" className="btn btn-primary" onClick={onRunSettlement} disabled={busy}>
          <Play size={14} />
          Run A2A Settlement
        </button>

        <button type="button" className="btn btn-amber" onClick={onRunAllAttacks} disabled={busy}>
          <ShieldAlert size={14} />
          Run 6 Guardrail Attacks
        </button>

        <button type="button" className="btn" onClick={onReset} disabled={busy} title="Reset Sandbox State">
          <RotateCcw size={14} />
          Reset
        </button>
      </div>
    </header>
  );
}
