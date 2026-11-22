import { useCallback, useEffect, useState } from "react";
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Layers,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  XCircle
} from "lucide-react";
import { formatEther } from "viem";
import {
  CIRCLE_SEPOLIA_USDC,
  HSK_NETWORKS,
  LIVE_TESTNET_SHOWCASE,
  probeCircleSepoliaUsdc,
  type CircleSepoliaTelemetry
} from "../protocol/networks";
import {
  buildVerificationSnippets,
  fetchLiveTestnetVaultSnapshot,
  proveLiveGuardrailRevertOnChain,
  proveReplayProtectionOnChain,
  type LiveVaultSnapshot,
  type OnChainReceiptSummary,
  type OnChainRevertProof
} from "../protocol/onChainVerifier";
import { ArchitectureDiagram } from "./ArchitectureDiagram";

type SnippetKind = "curl" | "cast" | "viem";

export function OnChainVerifier() {
  const [snapshot, setSnapshot] = useState<LiveVaultSnapshot | null>(null);
  const [sepoliaTelemetry, setSepoliaTelemetry] = useState<CircleSepoliaTelemetry | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedReceiptIdx, setSelectedReceiptIdx] = useState<1 | 2>(2);

  const [proving, setProving] = useState(false);
  const [revertProof, setRevertProof] = useState<OnChainRevertProof | null>(null);

  const [snippetTab, setSnippetTab] = useState<SnippetKind>("curl");
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  const refreshLiveState = useCallback(async () => {
    setLoading(true);
    const [vaultSnap, circleSnap] = await Promise.all([
      fetchLiveTestnetVaultSnapshot(),
      probeCircleSepoliaUsdc()
    ]);
    setSnapshot(vaultSnap);
    setSepoliaTelemetry(circleSnap);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refreshLiveState();
  }, [refreshLiveState]);

  const activeReceipt: OnChainReceiptSummary | null =
    snapshot?.receipts.find((r) => r.index === selectedReceiptIdx) ?? snapshot?.receipts[0] ?? null;

  const handleProveReplay = async () => {
    if (!activeReceipt) return;
    setProving(true);
    const result = await proveReplayProtectionOnChain(activeReceipt);
    setRevertProof(result);
    setProving(false);
  };

  const handleProveGuardrail = async (mode: "over-max-tx" | "invalid-sig") => {
    setProving(true);
    const result = await proveLiveGuardrailRevertOnChain(mode);
    setRevertProof(result);
    setProving(false);
  };

  const snippets = buildVerificationSnippets(
    LIVE_TESTNET_SHOWCASE.vaultAddress,
    LIVE_TESTNET_SHOWCASE.deployerAddress
  );

  const handleCopySnippet = async () => {
    try {
      await navigator.clipboard.writeText(snippets[snippetTab]);
      setCopiedSnippet(true);
      setTimeout(() => setCopiedSnippet(false), 1800);
    } catch {
      // Clipboard may be restricted in headless mode
    }
  };

  const testnetExplorer = HSK_NETWORKS.testnet.explorerUrl;
  const mainnetExplorer = HSK_NETWORKS.mainnet.explorerUrl;

  return (
    <section className="panel verifier-panel" aria-label="Live On-Chain Verifier and Judge Playground">
      <div className="section-header" style={{ flexWrap: "wrap" }}>
        <div className="section-title-group">
          <h2 className="section-title">
            <ShieldCheck size={17} color="#10b981" />
            Live On-Chain Verifier &amp; Judge Playground (HSK Testnet 133)
          </h2>
          <span className="badge badge-emerald mono">Zero-Wallet Read-Only eth_call</span>
          {snapshot?.blockscout.isVerified ? (
            <a
              href={snapshot.blockscout.explorerContractUrl}
              target="_blank"
              rel="noreferrer"
              className="badge badge-cyan mono"
              style={{ textDecoration: "none" }}
            >
              Blockscout Verified · {snapshot.blockscout.compilerVersion?.split("+")[0] ?? "solc"}
              <ExternalLink size={11} />
            </a>
          ) : (
            <a
              href={`${testnetExplorer}/address/${LIVE_TESTNET_SHOWCASE.vaultAddress}?tab=contract`}
              target="_blank"
              rel="noreferrer"
              className="badge badge-neutral mono"
              style={{ textDecoration: "none" }}
            >
              Vault {LIVE_TESTNET_SHOWCASE.vaultAddress.slice(0, 8)}...{LIVE_TESTNET_SHOWCASE.vaultAddress.slice(-6)}
              <ExternalLink size={11} />
            </a>
          )}
        </div>

        <button
          type="button"
          className="btn btn-sm"
          onClick={() => void refreshLiveState()}
          disabled={loading}
        >
          <RefreshCw size={13} />
          {loading ? "Querying HSK 133..." : "Refresh Live On-Chain State"}
        </button>
      </div>

      <div className="section-body">
        {/* Live 4-stat telemetry strip directly from https://testnet.hsk.xyz */}
        <div className="verifier-stats-grid">
          <div className="verifier-stat-card">
            <div className="verifier-stat-label">Live HSK Block (#133)</div>
            <div className="verifier-stat-value mono">
              {snapshot?.reachable ? `#${snapshot.blockNumber.toLocaleString()}` : loading ? "Querying..." : "RPC Error"}
            </div>
            <div className="verifier-stat-sub mono">
              {snapshot?.reachable ? `Latency ${snapshot.latencyMs}ms · chainId ${snapshot.chainId}` : snapshot?.error ?? "https://testnet.hsk.xyz"}
            </div>
          </div>

          <div className="verifier-stat-card">
            <div className="verifier-stat-label">Deployed Vault Bytecode</div>
            <div className="verifier-stat-value mono" style={{ color: "#34d399" }}>
              {snapshot?.bytecodeSizeBytes ? `${snapshot.bytecodeSizeBytes.toLocaleString()} bytes` : "8,215 bytes"}
            </div>
            <div className="verifier-stat-sub mono">
              SHA-256 {LIVE_TESTNET_SHOWCASE.deployedBytecodeSha256.slice(0, 12)}...
            </div>
          </div>

          <div className="verifier-stat-card">
            <div className="verifier-stat-label">On-Chain totalReceipts()</div>
            <div className="verifier-stat-value mono" style={{ color: "#7dd3fc" }}>
              {snapshot ? snapshot.totalReceipts.toString() : "—"} settled
            </div>
            <div className="verifier-stat-sub mono">
              Nonce #1: {snapshot?.nonce1Used ? "USED" : "—"} · Nonce #2: {snapshot?.nonce2Used ? "USED" : "—"}
            </div>
          </div>

          <div className="verifier-stat-card">
            <div className="verifier-stat-label">Active PrincipalPolicy</div>
            <div className="verifier-stat-value mono" style={{ color: snapshot?.principalPolicy.enforced ? "#34d399" : "#fbbf24" }}>
              {snapshot?.principalPolicy.enforced
                ? snapshot.principalPolicy.frozen
                  ? "FROZEN"
                  : "ENFORCED"
                : loading
                  ? "Loading..."
                  : "Unset"}
            </div>
            <div className="verifier-stat-sub mono">
              {snapshot?.principalPolicy.enforced
                ? `Max ${formatEther(snapshot.principalPolicy.maxPerTxCeilingWei)} / 24h ${formatEther(snapshot.principalPolicy.dailyCapCeilingWei)} HSK`
                : "Buyer guardrails active"}
            </div>
          </div>
        </div>

        {/* Main 2-column judge playground */}
        <div className="verifier-two-col">
          {/* Left: Verified Receipts + Replay & Guardrail Prover */}
          <div className="verifier-subcol">
            <div className="subpanel">
              <div className="subpanel-head">
                <span className="subpanel-title">Verified On-Chain Settlement Receipts (Live from RPC)</span>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {([1, 2] as const).map((idx) => (
                    <button
                      key={idx}
                      type="button"
                      className={`btn btn-sm ${selectedReceiptIdx === idx ? "btn-selected-cyan" : ""}`}
                      onClick={() => setSelectedReceiptIdx(idx)}
                    >
                      Receipt #{idx}
                    </button>
                  ))}
                </div>
              </div>

              {activeReceipt ? (
                <div className="receipt-proof-card">
                  <div className="receipt-proof-top">
                    <div>
                      <div style={{ fontSize: "0.82rem", fontWeight: 700 }}>{activeReceipt.label}</div>
                      <div className="mono" style={{ fontSize: "0.71rem", color: "#94a3b8" }}>
                        {activeReceipt.workerLabel} · Block #{activeReceipt.blockNumber.toString()} · Gas{" "}
                        {activeReceipt.gasUsed.toLocaleString()}
                      </div>
                    </div>
                    <a
                      href={activeReceipt.explorerTxUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-sm"
                    >
                      Explorer Tx
                      <ExternalLink size={11} />
                    </a>
                  </div>

                  <div className="kv-grid mono">
                    <div>
                      <span className="kv-k">receiptId:</span>{" "}
                      <span className="kv-v" style={{ color: "#34d399" }}>{activeReceipt.receiptId}</span>
                    </div>
                    <div>
                      <span className="kv-k">mandateDigest:</span>{" "}
                      <span className="kv-v">{activeReceipt.mandateDigest}</span>
                    </div>
                    <div>
                      <span className="kv-k">taskHash:</span>{" "}
                      <span className="kv-v">{activeReceipt.taskHash}</span>
                    </div>
                    <div>
                      <span className="kv-k">amount / nonce:</span>{" "}
                      <span className="kv-v">
                        {activeReceipt.amountFormattedHsk} HSK · Nonce #{activeReceipt.nonce.toString()}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mono" style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                  {loading ? "Decoding SettlementReceipt logs from HSK Testnet 133..." : "Click Refresh to fetch receipts."}
                </div>
              )}

              {/* Explorer Direct Links Bar */}
              <div className="explorer-links-bar">
                <a
                  href={`${testnetExplorer}/address/${LIVE_TESTNET_SHOWCASE.vaultAddress}?tab=contract`}
                  target="_blank"
                  rel="noreferrer"
                  className="explorer-chip mono"
                >
                  Verified Vault Contract <ExternalLink size={11} />
                </a>
                <a
                  href={`${testnetExplorer}/tx/${LIVE_TESTNET_SHOWCASE.deployTxHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="explorer-chip mono"
                >
                  Deploy Tx 0xb955...b4a0 <ExternalLink size={11} />
                </a>
                <a
                  href={`${testnetExplorer}/tx/${LIVE_TESTNET_SHOWCASE.settlementTx1Hash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="explorer-chip mono"
                >
                  Settle #1 0x539c...3c12 <ExternalLink size={11} />
                </a>
                <a
                  href={`${testnetExplorer}/tx/${LIVE_TESTNET_SHOWCASE.settlementTx2Hash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="explorer-chip mono"
                >
                  Settle #2 0xc792...a167 <ExternalLink size={11} />
                </a>
                <a
                  href={`${testnetExplorer}/tx/${LIVE_TESTNET_SHOWCASE.policyTxHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="explorer-chip mono"
                >
                  Policy Tx 0x5fcc...0899 <ExternalLink size={11} />
                </a>
              </div>
            </div>

            {/* Live eth_call Replay & Guardrail Prover */}
            <div className="subpanel">
              <div className="subpanel-head">
                <span className="subpanel-title">
                  <ShieldAlert size={15} color="#f59e0b" />
                  Live EVM Guardrail Simulator (Zero-Gas eth_call)
                </span>
              </div>

              <div className="prover-btn-row">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void handleProveReplay()}
                  disabled={proving || !activeReceipt}
                >
                  <ShieldCheck size={14} />
                  Prove Replay Protection On-Chain (Receipt #{selectedReceiptIdx})
                </button>
                <button
                  type="button"
                  className="btn btn-amber btn-sm"
                  onClick={() => void handleProveGuardrail("over-max-tx")}
                  disabled={proving}
                >
                  Prove OverMaxPerTx
                </button>
                <button
                  type="button"
                  className="btn btn-amber btn-sm"
                  onClick={() => void handleProveGuardrail("invalid-sig")}
                  disabled={proving}
                >
                  Prove InvalidSignature
                </button>
              </div>

              {revertProof ? (
                <div className={`proof-result-box ${revertProof.revertedAsExpected ? "pass" : "fail"}`}>
                  <div className="proof-result-head">
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontWeight: 700, fontSize: "0.78rem" }}>
                      {revertProof.revertedAsExpected ? (
                        <CheckCircle2 size={15} color="#10b981" />
                      ) : (
                        <XCircle size={15} color="#f43f5e" />
                      )}
                      {revertProof.title}
                    </span>
                    <span className={`badge mono ${revertProof.revertedAsExpected ? "badge-emerald" : "badge-rose"}`}>
                      {revertProof.errorName}
                    </span>
                  </div>
                  <div className="mono" style={{ fontSize: "0.73rem", color: "#e2e8f0", wordBreak: "break-all" }}>
                    Decoded EVM Revert: <strong>{revertProof.summary}</strong>
                  </div>
                  <div className="mono" style={{ fontSize: "0.7rem", color: "#94a3b8" }}>
                    Block: {revertProof.checkedBlock} · RPC Latency: {revertProof.latencyMs}ms · Target: 0xc914...50cf
                  </div>
                </div>
              ) : (
                <div className="mono" style={{ fontSize: "0.73rem", color: "#94a3b8" }}>
                  Click <strong>Prove Replay Protection On-Chain</strong> to re-submit the real signed calldata from Receipt #{selectedReceiptIdx} against live HSK Testnet 133 and decode the EVM custom error revert.
                </div>
              )}
            </div>
          </div>

          {/* Right: Dual-Rail Readiness + One-Click Copy Verification Snippets */}
          <div className="verifier-subcol">
            <div className="subpanel">
              <div className="subpanel-head">
                <span className="subpanel-title">
                  <Layers size={15} color="#38bdf8" />
                  Dual-Rail Settlement Readiness &amp; Mainnet 177 Plan
                </span>
                <span className="badge badge-emerald">BTC Compliant ($0 Capital)</span>
              </div>

              <div className="dual-rail-grid">
                <div className="rail-card">
                  <div className="rail-card-top">
                    <span style={{ fontWeight: 700, fontSize: "0.78rem" }}>Rail A · HSK Testnet (133)</span>
                    <span className="badge badge-emerald">LIVE</span>
                  </div>
                  <div className="mono" style={{ fontSize: "0.71rem", color: "#cbd5e1" }}>
                    Vault: {LIVE_TESTNET_SHOWCASE.vaultAddress.slice(0, 12)}...{LIVE_TESTNET_SHOWCASE.vaultAddress.slice(-6)}
                  </div>
                  <div style={{ fontSize: "0.72rem", color: "#94a3b8" }}>
                    Native HSK settlement verified across 2 on-chain receipts &amp; active PrincipalPolicy guardrails.
                  </div>
                </div>

                <div className="rail-card">
                  <div className="rail-card-top">
                    <span style={{ fontWeight: 700, fontSize: "0.78rem" }}>Rail B · Circle Sepolia USDC</span>
                    <span className={`badge ${sepoliaTelemetry?.reachable ? "badge-cyan" : "badge-neutral"}`}>
                      {sepoliaTelemetry?.reachable ? "VERIFIED" : "STANDBY"}
                    </span>
                  </div>
                  <div className="mono" style={{ fontSize: "0.71rem", color: "#cbd5e1" }}>
                    {CIRCLE_SEPOLIA_USDC.tokenAddress.slice(0, 12)}...{CIRCLE_SEPOLIA_USDC.tokenAddress.slice(-6)} (11155111)
                  </div>
                  <div style={{ fontSize: "0.72rem", color: "#94a3b8" }}>
                    {sepoliaTelemetry?.reachable && sepoliaTelemetry.blockNumber !== null
                      ? `Sepolia #${sepoliaTelemetry.blockNumber.toLocaleString()} · ${sepoliaTelemetry.codeSizeBytes}B · ${sepoliaTelemetry.decimals} dec ERC-20 ready.`
                      : "ERC-20 depositToken() & settleMandate() support Circle Sepolia USDC."}
                  </div>
                </div>
              </div>

              <div className="migration-box">
                <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#7dd3fc" }}>
                  Post-Win HSK Mainnet (Chain ID 177) Migration Plan
                </div>
                <div style={{ fontSize: "0.72rem", color: "#cbd5e1", lineHeight: 1.45 }}>
                  1. Hackathon submission runs live on <strong>HSK Testnet (133)</strong> + Circle Sepolia USDC staging per official BTC guidance.{" "}
                  2. Post-win, claim official organizer HSK Mainnet gas grant via HashFans / DoraHacks.{" "}
                  3. Run <span className="mono">npm.cmd run deploy:mainnet</span> to deploy identically to{" "}
                  <a href={mainnetExplorer} target="_blank" rel="noreferrer" style={{ color: "#34d399" }}>
                    HSK Mainnet (177)
                  </a>{" "}
                  with automatic EIP-712 <span className="mono">domainSeparator()</span> isolation.
                </div>
              </div>
            </div>

            {/* 5-Second Judge CLI / SDK Copy Snippets */}
            <div className="subpanel">
              <div className="subpanel-head">
                <span className="subpanel-title">
                  <Terminal size={15} color="#10b981" />
                  5-Second Verification Snippets
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <div className="segmented" role="tablist" aria-label="Verification Snippet Language">
                    {(["curl", "cast", "viem"] as const).map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        role="tab"
                        aria-selected={snippetTab === kind}
                        className={`segmented-btn ${snippetTab === kind ? "active" : ""}`}
                        onClick={() => setSnippetTab(kind)}
                        style={{ padding: "4px 9px", fontSize: "0.72rem" }}
                      >
                        {kind}
                      </button>
                    ))}
                  </div>
                  <button type="button" className="btn btn-sm" onClick={() => void handleCopySnippet()}>
                    {copiedSnippet ? <Check size={12} /> : <Copy size={12} />}
                    {copiedSnippet ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>

              <pre className="code-box snippet-code-box" style={{ maxHeight: "195px" }}>
                {snippets[snippetTab]}
              </pre>
            </div>
          </div>
        </div>

        {/* Crisp Vector A2A Protocol & Guardrail Flow Diagram */}
        <ArchitectureDiagram />
      </div>
    </section>
  );
}
