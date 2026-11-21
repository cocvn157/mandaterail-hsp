import { AlertTriangle, ArrowRightLeft, CheckCircle2, ShieldAlert, XCircle } from "lucide-react";
import {
  AGENT_TASK_CATALOG,
  type A2ARunTrace,
  type AdversarialScenarioResult,
  type AgentTaskTemplate
} from "../protocol/a2aWorkflow";

type AttackId = "over-max-tx" | "daily-cap" | "expired" | "replay-nonce" | "tampered-task" | "forged-sig";

interface WorkflowConsoleProps {
  selectedTask: AgentTaskTemplate;
  onSelectTask: (task: AgentTaskTemplate) => void;
  amountUsdc: string;
  onChangeAmount: (value: string) => void;
  maxPerTxUsdc: string;
  onChangeMaxPerTx: (value: string) => void;
  dailyCapUsdc: string;
  onChangeDailyCap: (value: string) => void;
  ttlSeconds: string;
  onChangeTtlSeconds: (value: string) => void;
  principalFrozen: boolean;
  onTogglePrincipalFrozen: () => void;
  busy: boolean;
  onRunSettlement: () => void;
  latestRun: A2ARunTrace | null;
  attackResults: AdversarialScenarioResult[];
  onRunSingleAttack: (attackId: AttackId) => void;
  onRunAllAttacks: () => void;
}

const ATTACK_CATALOG: { id: AttackId; title: string; code: string; desc: string }[] = [
  {
    id: "over-max-tx",
    title: "Over maxPerTx Ceiling",
    code: "ERR_OVER_MAX_PER_TX",
    desc: "Agent requests 75 USDC under 25 USDC per-tx mandate limit"
  },
  {
    id: "daily-cap",
    title: "Exceed 24h Daily Budget",
    code: "ERR_DAILY_CAP_EXCEEDED",
    desc: "Cumulative 24h spend (80 + 30) crosses 100 USDC ceiling"
  },
  {
    id: "expired",
    title: "Expired Mandate TTL",
    code: "ERR_MANDATE_EXPIRED",
    desc: "Settlement submitted past validBefore timestamp"
  },
  {
    id: "replay-nonce",
    title: "Replay Consumed Nonce",
    code: "ERR_NONCE_REPLAYED",
    desc: "Worker attempts double-spend using previously settled nonce #401"
  },
  {
    id: "tampered-task",
    title: "Tampered taskHash Scope",
    code: "ERR_TASK_HASH_MISMATCH",
    desc: "Mandate digest binds a modified task payload hash"
  },
  {
    id: "forged-sig",
    title: "Forged ECDSA Signer",
    code: "ERR_INVALID_SIGNATURE",
    desc: "Payload signed by unauthorized attacker private key"
  }
];

export function WorkflowConsole({
  selectedTask,
  onSelectTask,
  amountUsdc,
  onChangeAmount,
  maxPerTxUsdc,
  onChangeMaxPerTx,
  dailyCapUsdc,
  onChangeDailyCap,
  ttlSeconds,
  onChangeTtlSeconds,
  principalFrozen,
  onTogglePrincipalFrozen,
  busy,
  onRunSettlement,
  latestRun,
  attackResults,
  onRunSingleAttack,
  onRunAllAttacks
}: WorkflowConsoleProps) {
  const resultById = new Map(attackResults.map((item) => [item.id, item]));

  return (
    <div className="column-stack">
      {/* A2A Worker Task + Mandate Policy Panel */}
      <section className="panel">
        <div className="section-header">
          <h2 className="section-title">
            <ArrowRightLeft size={16} color="#38bdf8" />
            A2A Task Dispatch &amp; Mandate Policy Guardrails
          </h2>
          <span className="badge badge-cyan">EIP-712 Policy Enforced</span>
        </div>

        <div className="section-body">
          <div className="task-grid">
            {AGENT_TASK_CATALOG.map((task) => {
              const active = task.id === selectedTask.id;
              return (
                <button
                  key={task.id}
                  type="button"
                  className={`task-card ${active ? "selected" : ""}`}
                  onClick={() => onSelectTask(task)}
                >
                  <div className="task-card-title">{task.title}</div>
                  <div className="task-card-meta">{task.workerName}</div>
                  <div className="mono" style={{ fontSize: "0.75rem", color: "#34d399" }}>
                    {task.defaultPriceUsdc} USDC.hsk
                  </div>
                </button>
              );
            })}
          </div>

          <div className="policy-grid">
            <div className="field">
              <label htmlFor="mandate-amount">Task Fee (USDC)</label>
              <input
                id="mandate-amount"
                type="text"
                value={amountUsdc}
                onChange={(e) => onChangeAmount(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="mandate-max-tx">maxPerTx Ceiling</label>
              <input
                id="mandate-max-tx"
                type="text"
                value={maxPerTxUsdc}
                onChange={(e) => onChangeMaxPerTx(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="mandate-daily-cap">24h dailyCap</label>
              <input
                id="mandate-daily-cap"
                type="text"
                value={dailyCapUsdc}
                onChange={(e) => onChangeDailyCap(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="mandate-ttl">Mandate TTL (sec)</label>
              <input
                id="mandate-ttl"
                type="text"
                value={ttlSeconds}
                onChange={(e) => onChangeTtlSeconds(e.target.value)}
              />
            </div>
          </div>

          <div className="action-row">
            <label className="toggle-pill">
              <input
                type="checkbox"
                checked={principalFrozen}
                onChange={onTogglePrincipalFrozen}
              />
              <span>
                Principal Emergency Freeze{" "}
                <strong style={{ color: principalFrozen ? "#fb7185" : "#94a3b8" }}>
                  ({principalFrozen ? "FROZEN" : "ACTIVE"})
                </strong>
              </span>
            </label>

            <button type="button" className="btn btn-primary" onClick={onRunSettlement} disabled={busy}>
              Sign EIP-712 Mandate &amp; Settle via HSP
            </button>
          </div>

          {/* 4-Step Pipeline Trace */}
          {latestRun && (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#cbd5e1" }}>
                  Latest Execution Trace · {latestRun.taskTitle}
                </span>
                {latestRun.decision.status === "SETTLED" ? (
                  <span className="badge badge-emerald">SETTLED · Receipt Issued</span>
                ) : (
                  <span className="badge badge-rose">BLOCKED · {latestRun.decision.errorCode}</span>
                )}
              </div>

              <div className="steps-list">
                {latestRun.steps.map((s) => (
                  <div key={s.step} className={`step-card ${s.status === "BLOCKED" ? "blocked" : ""}`}>
                    <div className="step-top">
                      <span>
                        {s.step}. {s.actor}
                      </span>
                      {s.status === "PASS" ? (
                        <CheckCircle2 size={14} color="#10b981" />
                      ) : (
                        <XCircle size={14} color="#f43f5e" />
                      )}
                    </div>
                    <div style={{ fontSize: "0.76rem", fontWeight: 600 }}>{s.title}</div>
                    <div className="step-detail mono">{s.detail}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Adversarial Guardrail Stress-Test Matrix */}
      <section className="panel">
        <div className="section-header">
          <h2 className="section-title">
            <ShieldAlert size={16} color="#f59e0b" />
            Live Adversarial Guardrail Verification (Fail-Closed)
          </h2>
          <button type="button" className="btn btn-sm btn-amber" onClick={onRunAllAttacks} disabled={busy}>
            Run All 6 Vectors
          </button>
        </div>

        <div className="section-body">
          <div className="adversarial-grid">
            {ATTACK_CATALOG.map((atk) => {
              const res = resultById.get(atk.id);
              const blocked = res?.blockedAsExpected;
              return (
                <button
                  key={atk.id}
                  type="button"
                  className={`attack-card ${blocked ? "verified-block" : ""}`}
                  onClick={() => onRunSingleAttack(atk.id)}
                  disabled={busy}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                    <span style={{ fontSize: "0.8rem", fontWeight: 700 }}>{atk.title}</span>
                    {res ? (
                      blocked ? (
                        <span className="badge badge-emerald">BLOCKED</span>
                      ) : (
                        <span className="badge badge-rose">UNEXPECTED</span>
                      )
                    ) : (
                      <span className="badge badge-neutral">Click to Test</span>
                    )}
                  </div>
                  <div style={{ fontSize: "0.74rem", color: "#94a3b8", lineHeight: 1.35 }}>{atk.desc}</div>
                  <div className="mono" style={{ fontSize: "0.71rem", color: blocked ? "#34d399" : "#fbbf24" }}>
                    {res && res.actualDecision.status === "REJECTED"
                      ? `Caught: ${res.actualDecision.errorCode}`
                      : `Expect: ${atk.code}`}
                  </div>
                </button>
              );
            })}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "0.75rem",
              color: "#94a3b8"
            }}
          >
            <AlertTriangle size={14} color="#f59e0b" />
            <span>
              Every attack executes real secp256k1 EIP-712 verification against an isolated MandateGatekeeper instance.
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
