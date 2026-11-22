# MandateRail HSP

**Cryptographic EIP-712 Payment Mandates, `x402` Gatekeeper & Fail-Closed A2A Settlement on HashKey Chain**

Built for **HSK Chain Horizon Hackathon · Seoul (Track 2: Agent Payments & A2A Settlement)**.

---

## Live On-Chain Verification (HashKey Chain Testnet `133`)

> Per official HSK Chain Horizon organizer guidance, Testnet (`133`) deployments are accepted throughout the hackathon while winning teams migrate to Mainnet (`177`) post-hackathon. Every on-chain invariant has been executed and verified live:

- **Deployed Contract (`MandateSettlementVault.sol`):** [`0xc91469d4acc815b485f5b961bf49c7f0764a50cf`](https://testnet-explorer.hskchain.net/address/0xc91469d4acc815b485f5b961bf49c7f0764a50cf) (`chainId: 133`)
- **Deployer EOA:** `0x2584f4d5a0f9486dEe857b7F997f20f1A21a7D26`
- **Deployment Tx Hash:** [`0xb955f22a108fe694bf60a7b49d8e5a6b5c45e8be099279093c466b88c12bb4a0`](https://testnet-explorer.hskchain.net/tx/0xb955f22a108fe694bf60a7b49d8e5a6b5c45e8be099279093c466b88c12bb4a0)
- **Live EIP-712 `settleMandate()` Tx Hash (Block `#36081959`):** [`0x539c74e0bebf40aa38e1aabf8e297e6e2ccca9c8b80d3ca41caf1e024a083c12`](https://testnet-explorer.hskchain.net/tx/0x539c74e0bebf40aa38e1aabf8e297e6e2ccca9c8b80d3ca41caf1e024a083c12)
  - Emitted `SettlementReceipt` ID: `0xfbf168d51c8120f5a467fd38ab2f2e170c49af7449d71af8b5cae53e7f1e25c5`
  - EIP-712 `mandateDigest`: `0x82bd22c5d6519222190b8c4c9c11a929c9d8de3252203b4c872600822ac47460`
  - Verified State: `totalReceipts() == 1`, `usedNonces(deployer, 1) == true`, and re-simulating the exact signed mandate reverts on-chain (`NonceAlreadyUsed`).

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
| **HashKey Chain Testnet** | `133` | `0x85` | `https://testnet.hsk.xyz` | `https://testnet-explorer.hskchain.net` | Free Faucet: `https://faucet.hsk.xyz` |
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
