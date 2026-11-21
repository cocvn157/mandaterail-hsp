import { useState } from "react";
import { Check, Copy, Download, FileCode2, Receipt } from "lucide-react";
import type { A2ARunTrace } from "../protocol/a2aWorkflow";
import { PAYMENT_MANDATE_TYPEHASH, PAYMENT_MANDATE_TYPE_STRING } from "../protocol/eip712";
import type { GatekeeperDecision } from "../protocol/gatekeeper";
import { HSK_NETWORKS, type HskNetworkKey } from "../protocol/networks";

interface ReceiptInspectorProps {
  network: HskNetworkKey;
  history: GatekeeperDecision[];
  selectedDecision: GatekeeperDecision | null;
  onSelectDecision: (decision: GatekeeperDecision) => void;
  latestRun: A2ARunTrace | null;
  verifyingContract: `0x${string}`;
}

export function ReceiptInspector({
  network,
  history,
  selectedDecision,
  onSelectDecision,
  latestRun,
  verifyingContract
}: ReceiptInspectorProps) {
  const [tab, setTab] = useState<"ledger" | "x402" | "contract">("ledger");
  const [copied, setCopied] = useState(false);

  const cfg = HSK_NETWORKS[network];
  const activeDecision = selectedDecision ?? history[0] ?? null;
  const exportPayload = activeDecision ? JSON.stringify(activeDecision, null, 2) : "{}";

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(exportPayload);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard may be restricted in headless contexts
    }
  };

  const handleDownloadJson = () => {
    const blob = new Blob([exportPayload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mandaterail-receipt-chain-${cfg.chainId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <aside className="panel" aria-label="Receipt and Protocol Inspector">
      <div className="section-header">
        <h2 className="section-title">
          <Receipt size={16} color="#10b981" />
          Settlement Receipt &amp; x402 Inspector
        </h2>
        <span className="badge badge-neutral mono">{history.length} events</span>
      </div>

      <div className="tabs-row" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "ledger"}
          className={`tab-btn ${tab === "ledger" ? "active" : ""}`}
          onClick={() => setTab("ledger")}
        >
          Receipt Ledger
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "x402"}
          className={`tab-btn ${tab === "x402" ? "active" : ""}`}
          onClick={() => setTab("x402")}
        >
          HTTP 402 Wire Headers
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "contract"}
          className={`tab-btn ${tab === "contract" ? "active" : ""}`}
          onClick={() => setTab("contract")}
        >
          Solidity Vault ABI
        </button>
      </div>

      <div className="section-body">
        {tab === "ledger" && (
          <>
            <div className="receipt-list">
              {history.length === 0 ? (
                <div style={{ fontSize: "0.78rem", color: "#94a3b8" }}>
                  No settlement attempts recorded yet. Run an A2A settlement to generate an immutable receipt.
                </div>
              ) : (
                history.map((item, idx) => {
                  const id = item.status === "SETTLED" ? item.receiptId : `${item.errorCode}-${idx}`;
                  const isSelected = activeDecision === item;
                  return (
                    <button
                      key={`${id}-${idx}`}
                      type="button"
                      className={`receipt-item ${isSelected ? "selected" : ""}`}
                      onClick={() => onSelectDecision(item)}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div className="mono" style={{ fontSize: "0.74rem", fontWeight: 700 }}>
                          {item.status === "SETTLED"
                            ? `Receipt ${item.receiptId.slice(0, 14)}...`
                            : item.errorCode}
                        </div>
                        <div className="mono" style={{ fontSize: "0.7rem", color: "#94a3b8" }}>
                          Nonce #{item.nonce} · Chain {item.chainId} · {(Number(item.amount) / 1e6).toFixed(2)} USDC
                        </div>
                      </div>
                      {item.status === "SETTLED" ? (
                        <span className="badge badge-emerald">SETTLED</span>
                      ) : (
                        <span className="badge badge-rose">BLOCKED</span>
                      )}
                    </button>
                  );
                })
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
              <span style={{ fontSize: "0.76rem", fontWeight: 700, color: "#cbd5e1" }}>
                Mandate + Receipt JSON Proof
              </span>
              <div style={{ display: "flex", gap: "6px" }}>
                <button type="button" className="btn btn-sm" onClick={handleCopyJson} disabled={!activeDecision}>
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? "Copied" : "Copy JSON"}
                </button>
                <button type="button" className="btn btn-sm" onClick={handleDownloadJson} disabled={!activeDecision}>
                  <Download size={12} />
                  Export
                </button>
              </div>
            </div>

            <pre className="code-box">{exportPayload}</pre>
          </>
        )}

        {tab === "x402" && (
          <>
            <div style={{ fontSize: "0.76rem", color: "#94a3b8" }}>
              RFC-aligned HTTP <span className="mono">402 Payment Required</span> challenge &amp; signed EIP-712{" "}
              <span className="mono">X-PAYMENT</span> carrier header:
            </div>
            <div>
              <div style={{ fontSize: "0.73rem", fontWeight: 700, color: "#fbbf24", marginBottom: "5px" }}>
                1. Worker Response — HTTP 402 · X-PAYMENT-REQUIRED
              </div>
              <pre className="code-box">
                {latestRun
                  ? `HTTP/1.1 402 Payment Required\nX-PAYMENT-REQUIRED: ${latestRun.http402Frame.headers["X-PAYMENT-REQUIRED"]}\n\n${JSON.stringify(latestRun.http402Frame.challenge, null, 2)}`
                  : "Run A2A Settlement to inspect live HTTP 402 headers."}
              </pre>
            </div>
            <div>
              <div style={{ fontSize: "0.73rem", fontWeight: 700, color: "#34d399", marginBottom: "5px" }}>
                2. Buyer Agent Retry — X-PAYMENT (Signed EIP-712 Mandate)
              </div>
              <pre className="code-box">
                {latestRun
                  ? `X-PAYMENT: ${latestRun.xPaymentHeader}\n\nECDSA Signature:\n${latestRun.signature}`
                  : "Run A2A Settlement to inspect signed X-PAYMENT header."}
              </pre>
            </div>
          </>
        )}

        {tab === "contract" && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.77rem", color: "#cbd5e1" }}>
              <FileCode2 size={15} color="#38bdf8" />
              <span className="mono">contracts/MandateSettlementVault.sol (^0.8.24)</span>
            </div>
            <pre className="code-box">
              {JSON.stringify(
                {
                  network: cfg.name,
                  chainId: cfg.chainId,
                  rpcUrl: cfg.rpcUrl,
                  explorerUrl: cfg.explorerUrl,
                  verifyingContract,
                  eip712Domain: {
                    name: "MandateRail HSP",
                    version: "1",
                    chainId: cfg.chainId,
                    verifyingContract
                  },
                  paymentMandateTypeString: PAYMENT_MANDATE_TYPE_STRING,
                  paymentMandateTypeHash: PAYMENT_MANDATE_TYPEHASH,
                  entryPoint: "settleMandate(PaymentMandate mandate, bytes signature, bytes32 executionProofHash)"
                },
                null,
                2
              )}
            </pre>
          </>
        )}
      </div>
    </aside>
  );
}
