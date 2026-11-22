# DoraHacks Submission — HSK Chain Horizon Hackathon · Seoul

**Track:** Track 2 — Agent Payments & A2A Settlement (via HSP)  
**Project Name:** MandateRail HSP  
**Tagline:** Fail-closed EIP-712 Payment Mandates, `x402` HTTP Gatekeeper & Blockscout-Verified A2A Settlement Vault on HashKey Chain  
**GitHub Repository:** https://github.com/cocvn157/mandaterail-hsp  
**Live Web Console (GitHub Pages):** https://cocvn157.github.io/mandaterail-hsp/  
**Blockscout-Verified Contract (HSK Testnet `133`):** https://testnet-explorer.hskchain.net/address/0xc91469d4acc815b485f5b961bf49c7f0764a50cf?tab=contract

---

## 1. Problem Statement

As AI agents transition from chat assistants to autonomous economic actors, Agent-to-Agent (A2A) commerce faces three critical trust bottlenecks:

1. **Unbounded Agent Wallets:** Granting an AI orchestrator unrestricted private-key custody exposes principal treasuries to prompt injection, hallucinated loops, or malicious service endpoints.
2. **Lack of Protocol-Native Payment Challenges:** Standard REST/JSON-RPC agent endpoints have no cryptographic binding between an HTTP `402 Payment Required` invoice and the exact deterministic task payload (`taskHash`).
3. **Missing Compliance & Audit Receipts:** Institutional participants on HashKey Chain need verifiable on-chain settlement receipts linking `mandateDigest`, `taskHash`, `executionProofHash`, and principal-enforced spending guardrails.

---

## 2. Solution & Live On-Chain Verification (`HSK Testnet 133`)

**MandateRail HSP** implements a programmable Agent-to-Agent payment rail tailored for the **HashKey Settlement Platform (HSP)** paradigm on **HashKey Chain (`133` Testnet / `177` Mainnet)**:

- **Live Blockscout-Verified Vault (`0xc91469d4acc815b485f5b961bf49c7f0764a50cf`):**
  - Compiler: `v0.8.39+commit.ce47f2c8`, MIT License, Optimizer `200` runs (`is_verified: true` on `testnet-explorer.hskchain.net`).
  - Creation Bytecode SHA-256: `5179a18445690fada8e28754750bc0855c183a510e4da8dda1a1bcf78e7eefb7`
  - Deployed Bytecode SHA-256: `f51f977f91eeb2cb9dab2dbd617bd2828c432db9953c4db66319bd5b1d5a3007`
- **4 Verified Live On-Chain Transactions (`chainId: 133`):**
  1. **Deploy Vault (Block `#36081920`):** [`0xb955f22a108fe694bf60a7b49d8e5a6b5c45e8be099279093c466b88c12bb4a0`](https://testnet-explorer.hskchain.net/tx/0xb955f22a108fe694bf60a7b49d8e5a6b5c45e8be099279093c466b88c12bb4a0) (`gasUsed: 1,854,975`)
  2. **Settlement #1 — Worker A `0x7099...79C8` (`0.001 HSK`, Nonce `#1`, Block `#36081959`):** [`0x539c74e0bebf40aa38e1aabf8e297e6e2ccca9c8b80d3ca41caf1e024a083c12`](https://testnet-explorer.hskchain.net/tx/0x539c74e0bebf40aa38e1aabf8e297e6e2ccca9c8b80d3ca41caf1e024a083c12) (`receiptId: 0xfbf168d51c8120f5a467fd38ab2f2e170c49af7449d71af8b5cae53e7f1e25c5`)
  3. **Settlement #2 — Worker B `0x3C44...93BC` Routed Multi-Agent Hop (`0.0005 HSK`, Nonce `#2`, Block `#36082753`):** [`0xc7924b5da836c25437ee26a3e28e1abd3d7918ab003e9fbd93b463e4ba55a167`](https://testnet-explorer.hskchain.net/tx/0xc7924b5da836c25437ee26a3e28e1abd3d7918ab003e9fbd93b463e4ba55a167) (`receiptId: 0xa264c1142360e2ceed148b9e1f98f40ef827c79494adf2f35ea80016e253db32`)
  4. **Principal Policy Activation (`setPrincipalPolicy`, Block `#36082755`):** [`0x5fccb1b99fe7bd328ee01caab9ce6c98880a48848262d38469c9439bd26c0899`](https://testnet-explorer.hskchain.net/tx/0x5fccb1b99fe7bd328ee01caab9ce6c98880a48848262d38469c9439bd26c0899) (`maxPerTxCeiling: 0.005 HSK`, `dailyCapCeiling: 0.02 HSK`, `enforced: true`, `frozen: false`)
- **Browser-Native Zero-Wallet Judge Verifier (`src/components/OnChainVerifier.tsx`):**
  - Queries `https://testnet.hsk.xyz` directly via `viem` `eth_call` with zero wallet setup.
  - Displays live block number, bytecode presence, `totalReceipts() == 2`, active `PrincipalPolicy`, clickable decoded **Receipt #1** & **Receipt #2**, and live EVM revert provers (`NonceAlreadyUsed`, `OverMaxPerTx`, `InvalidSignature`).
  - Includes **Circle Sepolia USDC (`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`, chainId `11155111`)** dual-rail readiness, inline **A2A SVG Architecture Diagram**, and 5-second `curl` / `cast` / `viem` copy snippets.
- **HTTP `402` (`x402`) Challenge-Response Codec (`src/protocol/x402.ts`) & EIP-712 Cryptography (`src/protocol/eip712.ts`):**
  - Worker agents issue Base64URL `X-PAYMENT-REQUIRED` bound to canonical `taskHash`; orchestrators reply with signed EIP-712 `X-PAYMENT` (`PaymentMandate`).
  - Domain separator binds `chainId` (`133` Testnet / `177` Mainnet) and `verifyingContract`, preventing cross-chain replay.
- **Post-Win HSK Mainnet (`177`) Migration Plan:**
  - Consistent with organizer (BTC) rules, hackathon testing runs on **HSK Testnet (`133`)** + **Circle Sepolia USDC**, while post-win deployment targets **HSK Mainnet (`177`)** (`npm.cmd run deploy:mainnet`) using the official organizer gas grant.

---

## 3. Tech Stack & Verification Summary

- **Smart Contract:** Solidity `^0.8.24` compiled with `solc v0.8.39+commit.ce47f2c8`, Blockscout verified (`0xc91469d4acc815b485f5b961bf49c7f0764a50cf`)
- **Cryptography & Chain Client:** `viem` (ECDSA EIP-712 signing/recovery, ABI encoding, `eth_call` revert decoding, HashKey Chain & Sepolia JSON-RPC)
- **Frontend Console:** React 19, TypeScript (strict), Vite 7, Lucide Icons
- **Verification:** Vitest (`29/29` passing contract, ABI parity, revert-decoding, and protocol tests), live HSK Testnet `133` transactions & `eth_call` probes, `1280×720` live demo video capture

---

## 4. Ghi chú Hành động cho `@cocvn157` (Tiếng Việt — Zero-Capital Checklist)

> [!IMPORTANT]
> **Tóm tắt xác minh thể lệ chính thức HSK Chain Horizon Hackathon · Seoul:**
> - **Hạn chót nộp bài:** `2026-12-03 11:00` giờ Việt Nam (`04:00 UTC` / `13:00 KST` / `12:00 SGT`).
> - **Điều kiện Solo & Remote:** Hợp lệ! Demo Day (`2026-12-05`) hỗ trợ **slot thuyết trình online (remote)** cho thí sinh quốc tế.
> - **Giải thưởng:** Tổng quỹ `12,000 USDT` chia cho 2 track (`6,000 USDT` / track). Theo hướng dẫn BTC, dùng **HSK Testnet (`133`)** & **Circle Sepolia USDC** trong lúc thi; đội thắng giải sẽ nhận gói gas grant để triển khai lên **HSK Mainnet (`177`)** sau cuộc thi.
>
> **Trạng thái sẵn sàng nộp bài (`$0` vốn):**
> 1. **Contract đã Verified trên Blockscout (`133`):** `0xc91469d4acc815b485f5b961bf49c7f0764a50cf` với **4 giao dịch thật** (`Deploy` + `Settlement #1` + `Settlement #2` Worker B + `setPrincipalPolicy`), còn dư `~0.09628 HSK` testnet.
> 2. **GitHub & Live Console đã đồng bộ:** `https://github.com/cocvn157/mandaterail-hsp` (commit ký SSH `Verified`) và `https://cocvn157.github.io/mandaterail-hsp/` (có sẵn Live On-Chain Verifier không cần nối ví cho giám khảo).
> 3. **Video Demo HD (`1280×720`):** Upload `demo/mandaterail-hsp-demo.mp4` lên YouTube/Loom/DoraHacks và nộp link GitHub + Live Demo + nội dung mục 1–3 lên DoraHacks Track 2 trước `11:00 VN ngày 03/12/2026`.
