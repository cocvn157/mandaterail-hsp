import { Activity, Lock, ShieldCheck, Wallet } from "lucide-react";

interface KpiStripProps {
  vaultBalanceUsdc: string;
  providerEarnedUsdc: string;
  dailySpentUsdc: string;
  dailyCapUsdc: string;
  noncesConsumed: number;
  threatsBlocked: number;
}

export function KpiStrip({
  vaultBalanceUsdc,
  providerEarnedUsdc,
  dailySpentUsdc,
  dailyCapUsdc,
  noncesConsumed,
  threatsBlocked
}: KpiStripProps) {
  const spentNum = Number.parseFloat(dailySpentUsdc) || 0;
  const capNum = Number.parseFloat(dailyCapUsdc) || 1;
  const pct = Math.min(100, Math.round((spentNum / capNum) * 100));

  return (
    <section className="kpi-grid" aria-label="Vault and Policy Telemetry">
      <div className="panel kpi-card">
        <div className="kpi-label">
          <span>Buyer Vault Escrow</span>
          <Wallet size={14} color="#38bdf8" />
        </div>
        <div className="kpi-value mono">{vaultBalanceUsdc} USDC.hsk</div>
        <div className="kpi-sub">Pre-funded non-custodial agent allowance</div>
      </div>

      <div className="panel kpi-card">
        <div className="kpi-label">
          <span>Provider Settled</span>
          <Activity size={14} color="#10b981" />
        </div>
        <div className="kpi-value mono" style={{ color: "#34d399" }}>
          {providerEarnedUsdc} USDC.hsk
        </div>
        <div className="kpi-sub">Released only with valid ECDSA + taskHash proof</div>
      </div>

      <div className="panel kpi-card">
        <div className="kpi-label">
          <span>24h Rolling Daily Cap</span>
          <Lock size={14} color="#f59e0b" />
        </div>
        <div className="kpi-value mono">
          {dailySpentUsdc} / {dailyCapUsdc}
        </div>
        <div className="progress-track" aria-label="Rolling 24h cap utilization">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="panel kpi-card">
        <div className="kpi-label">
          <span>Guardrail Integrity</span>
          <ShieldCheck size={14} color="#10b981" />
        </div>
        <div className="kpi-value mono">
          {noncesConsumed} settled · {threatsBlocked} blocked
        </div>
        <div className="kpi-sub">Replay &amp; over-cap mandates fail closed</div>
      </div>
    </section>
  );
}
