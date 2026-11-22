# MandateRail HSP

**Cryptographic EIP-712 Payment Mandates, `x402` Gatekeeper & Fail-Closed A2A Settlement on HashKey Chain**

Built for **HSK Chain Horizon Hackathon · Seoul (Track 2: Agent Payments & A2A Settlement)**.

- **Live Judge Console (GitHub Pages):** https://cocvn157.github.io/mandaterail-hsp/
- **Verified Contract (Blockscout · HSK Testnet `133`):** [`0xc91469d4acc815b485f5b961bf49c7f0764a50cf`](https://testnet-explorer.hskchain.net/address/0xc91469d4acc815b485f5b961bf49c7f0764a50cf?tab=contract)

---

## Live On-Chain Verification (HashKey Chain Testnet `133`)

> Per official HSK Chain Horizon organizer (BTC) guidance, Testnet (`133`) + Circle Sepolia USDC staging is accepted throughout the hackathon while winning teams migrate to Mainnet (`177`) post-hackathon using the organizer gas grant. Every on-chain invariant below is verified live and reproducible read-only directly from the browser UI (zero wallet connection required):

- **Blockscout-Verified Contract (`MandateSettlementVault.sol`, `v0.8.39+commit.ce47f2c8`, MIT, Optimizer 200):** [`0xc91469d4acc815b485f5b961bf49c7f0764a50cf`](https://testnet-explorer.hskchain.net/address/0xc91469d4acc815b485f5b961bf49c7f0764a50cf?tab=contract)
  - Creation Bytecode SHA-256: `5179a18445690fada8e28754750bc0855c183a510e4da8dda1a1bcf78e7eefb7`
  - Deployed Bytecode SHA-256: `f51f977f91eeb2cb9dab2dbd617bd2828c432db9953c4db66319bd5b1d5a3007`
- **Deployer / Buyer Orchestrator EOA:** `0x2584f4d5a0f9486dEe857b7F997f20f1A21a7D26`

### Verified HSK Testnet (`133`) Transaction Ledger

| Step | Action | Block | Gas Used | Verified Tx Hash |
| :--- | :--- | :---: | :---: | :--- |
| **1. Deploy** | Deploy `MandateSettlementVault` | `#36081920` | `1,854,975` | [`0xb955f22a...12bb4a0`](https://testnet-explorer.hskchain.net/tx/0xb955f22a108fe694bf60a7b49d8e5a6b5c45e8be099279093c466b88c12bb4a0) |
| **2. Settlement #1** | Worker A (`0x7099...79C8`) · `0.001 HSK` · Nonce `#1` | `#36081959` | `160,093` | [`0x539c74e0...a083c12`](https://testnet-explorer.hskchain.net/tx/0x539c74e0bebf40aa38e1aabf8e297e6e2ccca9c8b80d3ca41caf1e024a083c12) |
| **3. Settlement #2** | Worker B (`0x3C44...93BC`) Routed Hop · `0.0005 HSK` · Nonce `#2` | `#36082753` | `103,671` | [`0xc7924b5d...a55a167`](https://testnet-explorer.hskchain.net/tx/0xc7924b5da836c25437ee26a3e28e1abd3d7918ab003e9fbd93b463e4ba55a167) |
| **4. Policy Guardrail** | `setPrincipalPolicy` (`0.005` max/tx, `0.02` 24h cap, `enforced=true`) | `#36082755` | `94,755` | [`0x5fccb1b9...d26c0899`](https://testnet-explorer.hskchain.net/tx/0x5fccb1b99fe7bd328ee01caab9ce6c98880a48848262d38469c9439bd26c0899) |

- **Settlement #1 Proof:**
  - `receiptId`: `0xfbf168d51c8120f5a467fd38ab2f2e170c49af7449d71af8b5cae53e7f1e25c5`
  - `mandateDigest`: `0x82bd22c5d6519222190b8c4c9c11a929c9d8de3252203b4c872600822ac47460`
- **Settlement #2 Proof (Multi-Agent Split-Hop):**
  - `receiptId`: `0xa264c1142360e2ceed148b9e1f98f40ef827c79494adf2f35ea80016e253db32`
  - `mandateDigest`: `0x5f6bc25124d4c5924af191f31f00a60f44e44c44c49b52f09090cfe999f83a0e`
- **Live On-Chain State:** `totalReceipts() == 2`, `usedNonces(deployer, 1) == true`, `usedNonces(deployer, 2) == true`, `principalPolicies(deployer, address(0)) == (0.005 HSK, 0.02 HSK, enforced: true, frozen: false)`, and re-simulating settled calldata reverts atomically with `NonceAlreadyUsed`.

---

## Judge Walkthrough (30-Second Live Console Verification)

1. Open the live web console: https://cocvn157.github.io/mandaterail-hsp/ (no wallet connection required).
2. In **Live On-Chain Verifier & Judge Playground (HSK Testnet 133)**, verify the live block height, **Blockscout Verified (`solc v0.8.39`)** badge, bytecode size (`8,215 bytes`), `totalReceipts() == 2`, and enforced `PrincipalPolicy`.
3. Click **Receipt #1** and **Receipt #2** to inspect decoded on-chain `SettlementReceipt` logs fetched live from `https://testnet.hsk.xyz`.
4. Click **Prove Replay Protection On-Chain**, **Prove OverMaxPerTx**, and **Prove InvalidSignature** to trigger real zero-gas `eth_call` simulations against `0xc91469d4acc815b485f5b961bf49c7f0764a50cf` and view decoded EVM custom error reverts (`NonceAlreadyUsed`, `OverMaxPerTx`, `InvalidSignature`).
5. Use the **5-Second Verification Snippets** (`curl`, `cast`, `viem`) to verify on-chain state directly from any terminal, and run **Run 6 Guardrail Attacks** in the interactive A2A simulator below.

---

## Why MandateRail HSP?

Autonomous AI agents hiring peer agents over HTTP cannot safely hold unrestricted hot wallets. **MandateRail HSP** introduces a programmable, fail-closed **HashKey Settlement Platform (HSP)** payment rail combining:

1. **HTTP `402 Payment Required` (`x402`) Handshake:** Worker agents advertise machine-readable payment challenges (`X-PAYMENT-REQUIRED`) bound to a canonical `taskHash`.
2. **EIP-712 Signed `PaymentMandate` Envelopes:** Orchestrator buyer agents sign typed-data spending mandates (`X-PAYMENT`) bounded by `maxPerTx`, rolling 24-hour `dailyCap`, `validAfter`/`validBefore` window, `nonce`, and `taskHash`.
3. **On-Chain Escrow & Guardrails (`MandateSettlementVault.sol`):** Enforces ECDSA `ecrecover` malleability protection (`s <= secp256k1n/2`), non-reentrant payout, nonce replay protection, principal emergency freeze/cap overrides, and emits immutable `SettlementReceipt` audit logs.
4. **Dual-Rail Readiness & Mainnet `177` Migration Plan:** Supports native `HSK` on Testnet (`133`) alongside **Circle Sepolia USDC** (`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`, `chainId: 11155111`) ERC-20 escrow (`depositToken()` / `settleMandate()`), with one-command post-win deployment to **HSK Mainnet (`177`)** (`npm.cmd run deploy:mainnet`) using the official organizer gas grant.

---

## Architecture

```
+-----------------------+   1. Task Request    +-------------------------+
|  Orchestrator Agent   | -------------------> |  Worker A / Worker B    |
|   (Buyer Treasury)    | <------------------- |   (Audit / KYT / TWAP)  |
+-----------------------+   2. HTTP 402 +      +-------------------------+
           |                 X-PAYMENT-REQUIRED             |
           |                                                |
           | 3. Sign EIP-712 PaymentMandate                 | 4. Submit X-PAYMENT +
           |    (amount, maxPerTx, dailyCap,                |    executionProofHash
           |     nonce, validBefore, taskHash)              v
           |                                   +-------------------------+
           +---------------------------------> | MandateSettlementVault  |
                                               | 0xc91469d4...764a50cf   |
                                               +-------------------------+
                                                            |
                                5. Verify ECDSA + 9 Guardrails
                                   -> Emit SettlementReceipt
                                   -> Release HSK / USDC.hsk
```

---

## Verified Network & Dual-Rail Specs

| Network / Rail | Chain ID | Public RPC | Block Explorer | Status |
| :--- | :---: | :--- | :--- | :--- |
| **HashKey Chain Testnet** | `133` (`0x85`) | `https://testnet.hsk.xyz` | `https://testnet-explorer.hskchain.net` | Live & Blockscout Verified |
| **Circle Sepolia USDC** | `11155111` | `https://ethereum-sepolia-rpc.publicnode.com` | `https://sepolia.etherscan.io` | ERC-20 `0x1c7D...7238` Ready |
| **HashKey Chain Mainnet** | `177` (`0xb1`) | `https://mainnet.hsk.xyz` | `https://hsk.blockscout.com` | Post-Win Migration (Organizer Gas Grant) |

---

## Repository Structure

```text
contracts/
  MandateSettlementVault.sol   # Solidity ^0.8.24 EIP-712 vault & rolling 24h budget guardrails
scripts/
  compile.mjs                  # Pure-JS solc compiler -> artifacts/MandateSettlementVault.json
  deploy.ts                    # Safe HSK Testnet (133) / Mainnet (177) deployer with dry-run & $0 check
  live-showcase.ts             # Verifiable HSK Testnet (133) multi-agent & policy showcase runner
src/
  protocol/
    networks.ts                # Verified HSK Chain 133/177 + Circle Sepolia USDC + live RPC probes
    vaultAbi.ts                # Compact strongly-typed ABI synced with compiled Solidity artifact
    eip712.ts                  # Canonical taskHash + viem secp256k1 EIP-712 signing & recovery
    x402.ts                    # Base64URL X-PAYMENT-REQUIRED & X-PAYMENT HTTP header codec
    gatekeeper.ts              # Fail-closed HSP settlement state machine matching Solidity invariants
    onChainVerifier.ts         # Browser-native read-only viem eth_call verifier & revert decoder
    a2aWorkflow.ts             # A2A task orchestrator + 6 live adversarial guardrail attack vectors
  components/                  # High-contrast dark fintech console + OnChainVerifier + SVG diagram
tests/
  contract.test.ts             # Solidity compilation, ABI parity & Blockscout bytecode SHA-256 tests
  protocol.test.ts             # Cryptography, x402 codec, revert decoding & multi-hop A2A tests
demo/
  mandaterail-hsp-demo.mp4     # 1280x720 H.264 live console walkthrough
```

---

## Quick Start (Local Verification)

> On Windows PowerShell, use `npm.cmd` instead of `npm`.

```bash
# 1. Install dependencies
npm.cmd install

# 2. Compile MandateSettlementVault.sol -> artifacts/MandateSettlementVault.json
npm.cmd run compile:contracts

# 3. Run full test suite (29 deterministic unit & contract tests)
npm.cmd test

# 4. Type-check and build production web bundle
npm.cmd run build

# 5. Probe live HSK RPCs via dry-run deploy script (safe, $0 spend)
npm.cmd run deploy:testnet
npm.cmd run deploy:mainnet

# 6. Launch interactive web console
npm.cmd run preview
```

---

## License

[MIT](./LICENSE)
