import { useCallback, useEffect, useRef, useState } from "react";
import { KpiStrip } from "./components/KpiStrip";
import { ReceiptInspector } from "./components/ReceiptInspector";
import { TopBar } from "./components/TopBar";
import { WorkflowConsole } from "./components/WorkflowConsole";
import {
  AGENT_TASK_CATALOG,
  createSeededGatekeeper,
  executeA2ASettlement,
  formatTokenAmount,
  runAdversarialScenario,
  runAllAdversarialScenarios,
  SANDBOX_BUYER_ADDRESS,
  SANDBOX_PROVIDER_ADDRESS,
  type A2ARunTrace,
  type AdversarialScenarioResult,
  type AgentTaskTemplate
} from "./protocol/a2aWorkflow";
import { MandateGatekeeper, type GatekeeperDecision } from "./protocol/gatekeeper";
import {
  HSK_NETWORKS,
  probeHskNetwork,
  SETTLEMENT_TOKENS,
  type HskNetworkKey,
  type LiveRpcTelemetry
} from "./protocol/networks";
import { parseUnits } from "viem";

export default function App() {
  const [network, setNetwork] = useState<HskNetworkKey>("testnet");
  const [telemetry, setTelemetry] = useState<LiveRpcTelemetry | null>(null);
  const [probing, setProbing] = useState(false);

  const gatekeeperRef = useRef<MandateGatekeeper>(createSeededGatekeeper("testnet", "250.00"));
  const nonceRef = useRef<bigint>(1n);

  const [selectedTask, setSelectedTask] = useState<AgentTaskTemplate>(AGENT_TASK_CATALOG[0]);
  const [amountUsdc, setAmountUsdc] = useState(AGENT_TASK_CATALOG[0].defaultPriceUsdc);
  const [maxPerTxUsdc, setMaxPerTxUsdc] = useState("25.00");
  const [dailyCapUsdc, setDailyCapUsdc] = useState("100.00");
  const [ttlSeconds, setTtlSeconds] = useState("300");
  const [principalFrozen, setPrincipalFrozen] = useState(false);

  const [busy, setBusy] = useState(false);
  const [latestRun, setLatestRun] = useState<A2ARunTrace | null>(null);
  const [history, setHistory] = useState<GatekeeperDecision[]>([]);
  const [selectedDecision, setSelectedDecision] = useState<GatekeeperDecision | null>(null);
  const [attackResults, setAttackResults] = useState<AdversarialScenarioResult[]>([]);
  const [snapshotTick, setSnapshotTick] = useState(0);

  const probeRpc = useCallback(async (targetNetwork: HskNetworkKey) => {
    setProbing(true);
    const result = await probeHskNetwork(targetNetwork);
    setTelemetry(result);
    setProbing(false);
  }, []);

  const syncPolicyAndRunInitial = useCallback(
    async (targetNetwork: HskNetworkKey) => {
      setBusy(true);
      const gk = createSeededGatekeeper(targetNetwork, "250.00");
      gatekeeperRef.current = gk;
      nonceRef.current = 1n;
      setPrincipalFrozen(false);

      const initialTrace = await executeA2ASettlement({
        gatekeeper: gk,
        network: targetNetwork,
        task: AGENT_TASK_CATALOG[0],
        amountUsdc: AGENT_TASK_CATALOG[0].defaultPriceUsdc,
        maxPerTxUsdc: "25.00",
        dailyCapUsdc: "100.00",
        nonce: nonceRef.current
      });
      nonceRef.current += 1n;

      setLatestRun(initialTrace);
      const nextHistory = gk.getHistory();
      setHistory(nextHistory);
      setSelectedDecision(nextHistory[0] ?? null);
      setAttackResults([]);
      setSnapshotTick((t) => t + 1);
      setBusy(false);
    },
    []
  );

  useEffect(() => {
    void probeRpc(network);
    void syncPolicyAndRunInitial(network);
  }, [network, probeRpc, syncPolicyAndRunInitial]);

  const handleSelectTask = (task: AgentTaskTemplate) => {
    setSelectedTask(task);
    setAmountUsdc(task.defaultPriceUsdc);
  };

  const handleToggleFreeze = () => {
    const nextFrozen = !principalFrozen;
    setPrincipalFrozen(nextFrozen);
    gatekeeperRef.current.setPrincipalPolicy(SANDBOX_BUYER_ADDRESS, SETTLEMENT_TOKENS.USDC.address, {
      maxPerTxCeiling: parseUnits(maxPerTxUsdc || "25.00", 6),
      dailyCapCeiling: parseUnits(dailyCapUsdc || "100.00", 6),
      enforced: true,
      frozen: nextFrozen
    });
  };

  const handleRunSettlement = async () => {
    setBusy(true);
    try {
      const gk = gatekeeperRef.current;
      gk.setPrincipalPolicy(SANDBOX_BUYER_ADDRESS, SETTLEMENT_TOKENS.USDC.address, {
        maxPerTxCeiling: parseUnits(maxPerTxUsdc || "25.00", 6),
        dailyCapCeiling: parseUnits(dailyCapUsdc || "100.00", 6),
        enforced: true,
        frozen: principalFrozen
      });

      const currentNonce = nonceRef.current;
      nonceRef.current += 1n;
      const ttl = Number.parseInt(ttlSeconds, 10);

      const trace = await executeA2ASettlement({
        gatekeeper: gk,
        network,
        task: selectedTask,
        amountUsdc: amountUsdc || "1.00",
        maxPerTxUsdc: maxPerTxUsdc || "25.00",
        dailyCapUsdc: dailyCapUsdc || "100.00",
        nonce: currentNonce,
        ttlSeconds: Number.isFinite(ttl) ? ttl : 300
      });

      setLatestRun(trace);
      const nextHistory = gk.getHistory();
      setHistory(nextHistory);
      setSelectedDecision(nextHistory[0] ?? null);
      setSnapshotTick((t) => t + 1);
    } finally {
      setBusy(false);
    }
  };

  const handleRunSingleAttack = async (
    attackId: "over-max-tx" | "daily-cap" | "expired" | "replay-nonce" | "tampered-task" | "forged-sig"
  ) => {
    setBusy(true);
    try {
      const result = await runAdversarialScenario(attackId, network);
      setAttackResults((prev) => {
        const filtered = prev.filter((item) => item.id !== attackId);
        return [...filtered, result];
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRunAllAttacks = async () => {
    setBusy(true);
    try {
      const all = await runAllAdversarialScenarios(network);
      setAttackResults(all);
    } finally {
      setBusy(false);
    }
  };

  // Derive live vault telemetry from Gatekeeper (snapshotTick triggers deterministic re-read)
  void snapshotTick;
  const gk = gatekeeperRef.current;
  const vaultBal = formatTokenAmount(gk.getVaultBalance(SANDBOX_BUYER_ADDRESS, SETTLEMENT_TOKENS.USDC.address));
  const providerEarned = formatTokenAmount(
    gk.getProviderEarnings(SANDBOX_PROVIDER_ADDRESS, SETTLEMENT_TOKENS.USDC.address)
  );
  const dailyTracker = gk.getDailyTracker(
    SANDBOX_BUYER_ADDRESS,
    SETTLEMENT_TOKENS.USDC.address,
    BigInt(Math.floor(Date.now() / 1000))
  );
  const dailySpent = formatTokenAmount(dailyTracker.spent);
  const cfg = HSK_NETWORKS[network];

  return (
    <div className="app-shell">
      <TopBar
        network={network}
        onSelectNetwork={setNetwork}
        telemetry={telemetry}
        probing={probing}
        onProbeRpc={() => void probeRpc(network)}
        busy={busy}
        onRunSettlement={() => void handleRunSettlement()}
        onRunAllAttacks={() => void handleRunAllAttacks()}
        onReset={() => void syncPolicyAndRunInitial(network)}
      />

      <KpiStrip
        vaultBalanceUsdc={Number(vaultBal).toFixed(2)}
        providerEarnedUsdc={Number(providerEarned).toFixed(2)}
        dailySpentUsdc={Number(dailySpent).toFixed(2)}
        dailyCapUsdc={Number(dailyCapUsdc || "100").toFixed(2)}
        noncesConsumed={gk.getUsedNonceCount()}
        threatsBlocked={gk.getRejectedCount() + attackResults.filter((a) => a.blockedAsExpected).length}
      />

      <main className="main-grid">
        <WorkflowConsole
          selectedTask={selectedTask}
          onSelectTask={handleSelectTask}
          amountUsdc={amountUsdc}
          onChangeAmount={setAmountUsdc}
          maxPerTxUsdc={maxPerTxUsdc}
          onChangeMaxPerTx={setMaxPerTxUsdc}
          dailyCapUsdc={dailyCapUsdc}
          onChangeDailyCap={setDailyCapUsdc}
          ttlSeconds={ttlSeconds}
          onChangeTtlSeconds={setTtlSeconds}
          principalFrozen={principalFrozen}
          onTogglePrincipalFrozen={handleToggleFreeze}
          busy={busy}
          onRunSettlement={() => void handleRunSettlement()}
          latestRun={latestRun}
          attackResults={attackResults}
          onRunSingleAttack={(id) => void handleRunSingleAttack(id)}
          onRunAllAttacks={() => void handleRunAllAttacks()}
        />

        <ReceiptInspector
          network={network}
          history={history}
          selectedDecision={selectedDecision}
          onSelectDecision={setSelectedDecision}
          latestRun={latestRun}
          verifyingContract={gk.getVerifyingContract()}
        />
      </main>

      <footer className="panel footer-note">
        <span>
          <strong>{cfg.name}</strong> (Chain ID <span className="mono">{cfg.chainId}</span>) ·{" "}
          {cfg.settlementNote}
          {network === "testnet" && (
            <>
              {" "}
              <a
                href={`${cfg.explorerUrl}/address/${cfg.defaultVaultAddress}`}
                target="_blank"
                rel="noreferrer"
                className="mono"
                style={{ color: "#34d399", textDecoration: "underline" }}
              >
                Vault {cfg.defaultVaultAddress.slice(0, 8)}...{cfg.defaultVaultAddress.slice(-6)}
              </a>
              {" · "}
              <a
                href={`${cfg.explorerUrl}/tx/0x539c74e0bebf40aa38e1aabf8e297e6e2ccca9c8b80d3ca41caf1e024a083c12`}
                target="_blank"
                rel="noreferrer"
                className="mono"
                style={{ color: "#38bdf8", textDecoration: "underline" }}
              >
                Live Settle Tx 0x539c...3c12
              </a>
            </>
          )}
        </span>
        <span className="mono">
          Buyer {SANDBOX_BUYER_ADDRESS.slice(0, 8)}... → Provider {SANDBOX_PROVIDER_ADDRESS.slice(0, 8)}...
        </span>
      </footer>
    </div>
  );
}
