export function ArchitectureDiagram() {
  return (
    <div className="arch-card" aria-label="MandateRail HSP A2A Protocol Flow Diagram">
      <div className="arch-header">
        <span className="arch-title">A2A x402 + EIP-712 Protocol &amp; On-Chain Vault Settlement Architecture</span>
        <span className="badge badge-cyan mono">EIP-712 · HTTP 402 · HSK Testnet 133 → Mainnet 177</span>
      </div>
      <div className="arch-svg-wrap">
        <svg
          viewBox="0 0 1160 225"
          role="img"
          aria-label="Orchestrator Buyer Agent sends task request to Worker Agent, receives HTTP 402 X-PAYMENT-REQUIRED bound to taskHash, signs EIP-712 PaymentMandate in X-PAYMENT, and settles via MandateSettlementVault on HashKey Chain"
          style={{ width: "100%", height: "auto", display: "block" }}
        >
          <defs>
            <marker id="arrow-cyan" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" />
            </marker>
            <marker id="arrow-amber" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#f59e0b" />
            </marker>
            <marker id="arrow-emerald" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#10b981" />
            </marker>
          </defs>

          {/* Node 1: Buyer Orchestrator */}
          <rect x="12" y="34" width="206" height="122" rx="10" fill="#080d16" stroke="#38bdf8" strokeWidth="1.5" />
          <text x="25" y="57" fill="#7dd3fc" fontSize="10.5" fontWeight="700" fontFamily="monospace">
            1. BUYER ORCHESTRATOR
          </text>
          <text x="25" y="78" fill="#f1f5f9" fontSize="13" fontWeight="700">
            Autonomous Agent
          </text>
          <text x="25" y="99" fill="#94a3b8" fontSize="10.5">
            • Non-custodial vault balance
          </text>
          <text x="25" y="116" fill="#94a3b8" fontSize="10.5">
            • Signs EIP-712 Mandate
          </text>
          <text x="25" y="137" fill="#64748b" fontSize="10" fontFamily="monospace">
            0x2584f4...a7D26 (HSK 133)
          </text>

          {/* Arrow 1 -> 2 top (Task Request) */}
          <line x1="224" y1="68" x2="342" y2="68" stroke="#38bdf8" strokeWidth="1.6" markerEnd="url(#arrow-cyan)" />
          <text x="283" y="59" textAnchor="middle" fill="#7dd3fc" fontSize="9.5" fontFamily="monospace">
            1. POST Task
          </text>

          {/* Arrow 2 -> 1 bottom (HTTP 402) */}
          <line x1="342" y1="118" x2="224" y2="118" stroke="#f59e0b" strokeWidth="1.6" markerEnd="url(#arrow-amber)" />
          <text x="283" y="135" textAnchor="middle" fill="#fbbf24" fontSize="9.5" fontFamily="monospace">
            2. HTTP 402
          </text>
          <text x="283" y="148" textAnchor="middle" fill="#94a3b8" fontSize="8.8" fontFamily="monospace">
            X-PAYMENT-REQUIRED
          </text>

          {/* Node 2: Worker Agent A / B */}
          <rect x="348" y="34" width="212" height="122" rx="10" fill="#080d16" stroke="#f59e0b" strokeWidth="1.5" />
          <text x="361" y="57" fill="#fbbf24" fontSize="10.5" fontWeight="700" fontFamily="monospace">
            2. WORKER ENDPOINTS
          </text>
          <text x="361" y="78" fill="#f1f5f9" fontSize="13" fontWeight="700">
            Audit / KYT / Oracle
          </text>
          <text x="361" y="99" fill="#94a3b8" fontSize="10.5">
            • Binds canonical taskHash
          </text>
          <text x="361" y="116" fill="#94a3b8" fontSize="10.5">
            • Worker A (0x7099) &amp; B (0x3C44)
          </text>
          <text x="361" y="137" fill="#64748b" fontSize="10" fontFamily="monospace">
            Deliverable → proofHash
          </text>

          {/* Arrow 2 -> 3 (X-PAYMENT + Proof) */}
          <line x1="566" y1="94" x2="682" y2="94" stroke="#10b981" strokeWidth="1.7" markerEnd="url(#arrow-emerald)" />
          <text x="624" y="80" textAnchor="middle" fill="#34d399" fontSize="9.5" fontFamily="monospace">
            3. settleMandate()
          </text>
          <text x="624" y="112" textAnchor="middle" fill="#94a3b8" fontSize="8.8" fontFamily="monospace">
            X-PAYMENT + Proof
          </text>

          {/* Node 3: MandateSettlementVault */}
          <rect x="688" y="20" width="244" height="150" rx="10" fill="#0b171b" stroke="#10b981" strokeWidth="1.7" />
          <text x="702" y="43" fill="#34d399" fontSize="10.5" fontWeight="700" fontFamily="monospace">
            3. ON-CHAIN HSP VAULT
          </text>
          <text x="702" y="64" fill="#f1f5f9" fontSize="13" fontWeight="700">
            MandateSettlementVault
          </text>
          <text x="702" y="84" fill="#cbd5e1" fontSize="10.5">
            ✓ ECDSA ecrecover (half-n)
          </text>
          <text x="702" y="100" fill="#cbd5e1" fontSize="10.5">
            ✓ Nonce replay &amp; revoke guard
          </text>
          <text x="702" y="116" fill="#cbd5e1" fontSize="10.5">
            ✓ maxPerTx &amp; 24h rolling cap
          </text>
          <text x="702" y="132" fill="#cbd5e1" fontSize="10.5">
            ✓ PrincipalPolicy emergency freeze
          </text>
          <text x="702" y="153" fill="#34d399" fontSize="10" fontFamily="monospace">
            0xc91469d4...764a50cf (Verified)
          </text>

          {/* Arrow 3 -> 4 (Receipt + Payout) */}
          <line x1="938" y1="94" x2="994" y2="94" stroke="#10b981" strokeWidth="1.7" markerEnd="url(#arrow-emerald)" />
          <text x="966" y="81" textAnchor="middle" fill="#34d399" fontSize="9.5" fontFamily="monospace">
            4. Emit
          </text>

          {/* Node 4: SettlementReceipt + Dual Rail */}
          <rect x="1000" y="34" width="148" height="122" rx="10" fill="#080d16" stroke="#2c405f" strokeWidth="1.5" />
          <text x="1012" y="57" fill="#7dd3fc" fontSize="10.5" fontWeight="700" fontFamily="monospace">
            4. AUDIT &amp; RAIL
          </text>
          <text x="1012" y="78" fill="#f1f5f9" fontSize="12.5" fontWeight="700">
            Receipt + Payout
          </text>
          <text x="1012" y="99" fill="#34d399" fontSize="10.5">
            • totalReceipts = 2
          </text>
          <text x="1012" y="116" fill="#94a3b8" fontSize="10.5">
            • HSK Native (133)
          </text>
          <text x="1012" y="133" fill="#94a3b8" fontSize="10.5">
            • Circle USDC Ready
          </text>

          {/* Bottom Principle Policy Guardrail Bar */}
          <rect x="12" y="183" width="1136" height="28" rx="6" fill="#080d16" stroke="#1d2a3f" strokeWidth="1" />
          <text x="26" y="201" fill="#fbbf24" fontSize="10.5" fontWeight="700" fontFamily="monospace">
            FAIL-CLOSED INVARIANT:
          </text>
          <text x="176" y="201" fill="#cbd5e1" fontSize="10.5" fontFamily="monospace">
            Any replayed nonce, expired TTL, tampered taskHash, or principal ceiling breach reverts atomically before token transfer.
          </text>
        </svg>
      </div>
    </div>
  );
}
