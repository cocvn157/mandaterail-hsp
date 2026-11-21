# MandateRail HSP

**Cryptographic EIP-712 Payment Mandates, `x402` Gatekeeper & Fail-Closed A2A Settlement on HashKey Chain**

Built for **HSK Chain Horizon Hackathon · Seoul (Track 2: Agent Payments & A2A Settlement)**.

---

## Why MandateRail HSP?

Autonomous AI agents hiring peer agents over HTTP cannot safely hold unrestricted hot wallets. **MandateRail HSP** introduces a programmable, fail-closed **HashKey Settlement Platform (HSP)** payment rail combining:

1. **HTTP `402 Payment Required` (`x402`) Handshake:** Worker agents advertise machine-readable payment challenges (`X-PAYMENT-REQUIRED`) bound to a canonical `taskHash`.
2. **EIP-712 Signed `PaymentMandate` Envelopes:** Orchestrator buyer agents sign typed-data spending mandates (`X-PAYMENT`) bounded by `maxPerTx`, rolling 24-hour `dailyCap`, `validAfter`/`validBefore` window, `nonce`, and `taskHash`.
3. **On-Chain Escrow & Guardrails (`MandateSettlementVault.sol`):** Enforces ECDSA `ecrecover` malleability protection (`s <= secp256k1n/2`), non-reentrant payout, nonce replay protection, principal emergency freeze/cap overrides, and emits immutable `SettlementReceipt` audit logs.
4. **Live HashKey Chain Telemetry:** Browser and CLI clients probe live `eth_chainId`, `eth_blockNumber`, and `eth_gasPrice` on **HSK Testnet (`133`)** and **HSK Mainnet (`177`)**.

---

## Architecture

```
+-----------------------+   1. Task Request    +-------------------------+
|  Orchestrator Agent   | -------------------> |   Worker / Audit Agent  |
|   (Buyer Treasury)    | <------------------- |   (Provider Endpoint)   |
+-----------------------+   2. HTTP 402 +      +-------------------------+
           |                 X-PAYMENT-REQUIRED             |
           |                                                |
           | 3. Sign EIP-712 PaymentMandate                 | 4. Submit X-PAYMENT +
           |    (amount, maxPerTx, dailyCap,                |    executionProofHash
           |     nonce, validBefore, taskHash)              v
           |                                   +-------------------------+
           +---------------------------------> | MandateSettlementVault  |
                                               | (HSP Gatekeeper L2)     |
                                               +-------------------------+
                                                            |
                                5. Verify ECDSA + 9 Guardrails
                                   -> Emit SettlementReceipt
                                   -> Release USDC.hsk / HSK
```

---

## Verified HashKey Chain Network Specs

| Network | Chain ID | Hex | Public RPC | Block Explorer | Gas Source (`$0` Capital) |
| :--- | :---: | :---: | :--- | :--- | :--- |
| **HashKey Chain Testnet** | `133` | `0x85` | `https://testnet.hsk.xyz` | `https://testnet-explorer.hskchain.net` | Free Faucet: `https://hsk.xyz/faucet` |
| **HashKey Chain Mainnet** | `177` | `0xb1` | `https://mainnet.hsk.xyz` | `https://hsk.blockscout.com` | Official HashFans / DoraHacks Organizer Gas Grant |

---

## Repository Structure

```text
contracts/
  MandateSettlementVault.sol   # Solidity ^0.8.24 EIP-712 vault & rolling 24h budget guardrails
scripts/
  compile.mjs                  # Pure-JS solc compiler -> artifacts/MandateSettlementVault.json
  deploy.ts                    # Safe HSK Testnet (133) / Mainnet (177) deployer with dry-run & $0 check
src/
  protocol/
    networks.ts                # Verified HSK Chain 133/177 endpoints + live JSON-RPC telemetry probe
    eip712.ts                  # Canonical taskHash + viem secp256k1 EIP-712 signing & recovery
    x402.ts                    # Base64URL X-PAYMENT-REQUIRED & X-PAYMENT HTTP header codec
    gatekeeper.ts              # Fail-closed HSP settlement state machine matching Solidity invariants
    a2aWorkflow.ts             # A2A task orchestrator + 6 live adversarial guardrail attack vectors
  components/                  # High-contrast dark fintech developer console UI
tests/
  contract.test.ts             # Solidity compilation, bytecode & EIP-712 ABI parity tests
  protocol.test.ts             # Cryptography, x402 codec, rolling budget & adversarial suite tests
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

# 3. Run full test suite (Solidity compilation + protocol + adversarial guardrails)
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
