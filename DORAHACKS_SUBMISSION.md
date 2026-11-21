# DoraHacks Submission — HSK Chain Horizon Hackathon · Seoul

**Track:** Track 2 — Agent Payments & A2A Settlement (via HSP)  
**Project Name:** MandateRail HSP  
**Tagline:** Fail-closed EIP-712 Payment Mandates, `x402` HTTP Gatekeeper & Verifiable A2A Settlement Vault on HashKey Chain  
**GitHub Repository:** https://github.com/cocvn157/mandaterail-hsp  
**Live Web Console (GitHub Pages):** https://cocvn157.github.io/mandaterail-hsp/  

---

## 1. Problem Statement

As AI agents transition from chat assistants to autonomous economic actors, Agent-to-Agent (A2A) commerce faces three critical trust bottlenecks:

1. **Unbounded Agent Wallets:** Granting an AI orchestrator unrestricted private-key custody exposes principal treasuries to prompt injection, hallucinated loops, or malicious service endpoints.
2. **Lack of Protocol-Native Payment Challenges:** Standard REST/JSON-RPC agent endpoints have no cryptographic binding between an HTTP `402 Payment Required` invoice and the exact deterministic task payload (`taskHash`).
3. **Missing Compliance & Audit Receipts:** Institutional participants on HashKey Chain need verifiable on-chain settlement receipts linking `mandateDigest`, `taskHash`, `executionProofHash`, and principal-enforced spending guardrails.

---

## 2. Solution — MandateRail HSP

**MandateRail HSP** implements a programmable Agent-to-Agent payment rail tailored for the **HashKey Settlement Platform (HSP)** paradigm on **HashKey Chain (`133` Testnet / `177` Mainnet)**:

- **HTTP `402` (`x402`) Challenge-Response Codec (`src/protocol/x402.ts`):**  
  Worker agents return `HTTP 402` with a Base64URL-encoded `X-PAYMENT-REQUIRED` header specifying token (`USDC.hsk` / native `HSK`), amount, recipient, expiry, and canonical `taskHash`. Orchestrator agents attach a signed `X-PAYMENT` header without custom RPC roundtrips before execution.
- **EIP-712 `PaymentMandate` Cryptography (`src/protocol/eip712.ts`):**  
  Every mandate is signed via secp256k1 ECDSA over an explicit domain separator (`name: "MandateRail HSP"`, `version: "1"`, `chainId: 133 | 177`, `verifyingContract`) preventing cross-chain or cross-contract replay.
- **Fail-Closed Smart Contract Vault (`contracts/MandateSettlementVault.sol`):**  
  Compiles cleanly under Solidity `^0.8.24` (`solc`) and enforces:
  - Per-transaction spend ceiling (`amount <= maxPerTx`)
  - Rolling 24-hour budget tracker (`spent + amount <= dailyCap`)
  - Nonce replay protection + explicit nonce/digest revocation
  - Temporal window bounds (`validAfter <= block.timestamp <= validBefore`)
  - Optional Principal Policy Guardian (`assignPrincipal`, `setPrincipalPolicy`, instant `frozen` kill-switch)
  - Immutable `SettlementReceipt` event emission binding `receiptId`, `mandateDigest`, `taskHash`, and `executionProofHash`.
- **Interactive Fintech Console & Adversarial Guardrail Lab (`src/`):**  
  Probes live HashKey Chain RPCs (`https://testnet.hsk.xyz` / `https://mainnet.hsk.xyz`), executes real client-side EIP-712 signatures, inspects live `X-PAYMENT-REQUIRED` / `X-PAYMENT` headers, exports verifiable JSON `Mandate + Receipt` proofs, and stress-tests 6 real adversarial attack vectors (`ERR_OVER_MAX_PER_TX`, `ERR_DAILY_CAP_EXCEEDED`, `ERR_MANDATE_EXPIRED`, `ERR_NONCE_REPLAYED`, `ERR_TASK_HASH_MISMATCH`, `ERR_INVALID_SIGNATURE`).

---

## 3. Tech Stack

- **Smart Contract:** Solidity `^0.8.24`, compiled with `solc` (`scripts/compile.mjs`)
- **Cryptography & Chain Client:** `viem` (ECDSA EIP-712 signing/recovery, ABI encoding, HashKey Chain JSON-RPC)
- **Frontend Console:** React 19, TypeScript (strict), Vite 7, Lucide Icons
- **Verification:** Vitest (`17/17` deterministic unit & contract tests), live HSK JSON-RPC probes, `1280×720` live demo capture

---

## 4. Ghi chú Hành động cho `@cocvn157` (Tiếng Việt — Zero-Capital Checklist)

> [!IMPORTANT]
> **Tóm tắt xác minh thể lệ chính thức HSK Chain Horizon Hackathon · Seoul:**
> - **Hạn chót nộp bài:** `2026-12-03 11:00` giờ Việt Nam (`04:00 UTC` / `13:00 KST` / `12:00 SGT`).
> - **Điều kiện Solo & Remote:** Hợp lệ! Cuộc thi mở toàn cầu cho developer cá nhân (`solo builder`) hoặc nhóm; Demo Day (`2026-12-05`) hỗ trợ **slot thuyết trình online (remote)** cho thí sinh quốc tế (cần online đúng khung giờ được phân bổ sau khi có lịch ngày `2026-12-04`).
> - **Giải thưởng:** Tổng quỹ `12,000 USDT` chia cho 2 track (`AI Agent Trading` & `Agent Payments & A2A Settlement`). Đội thắng giải cần triển khai lên **HSK Chain Mainnet (`chainId 177`)** để nhận thưởng.
>
> **Các bước bạn cần làm bằng tay (giữ nguyên tắc `$0` vốn):**
> 1. **Tuyệt đối không tự mua HSK bằng tiền thật.**
> 2. Để test deploy trên **Testnet (`133`)**: lấy HSK miễn phí tại faucet chính thức `https://hsk.xyz/faucet`, điền private key ví test mới vào `.env` (không commit `.env`) và chạy `npm.cmd run deploy:testnet`.
> 3. Để deploy lên **Mainnet (`177`)**: tham gia kênh Telegram/cộng đồng chính thức từ trang HashFans (`https://hashfans.io`) / trang DoraHacks (`https://dorahacks.io/hackathon/hskchainseoul`) để **xin gói gas grant miễn phí từ BTC (organizer HSK mainnet gas grant)** rồi chạy `npm.cmd run deploy:mainnet`.
> 4. **GitHub & Live Demo đã publish sẵn (`$0`):** Repo công khai tại `https://github.com/cocvn157/mandaterail-hsp` (toàn bộ commit đã được ký SSH `Verified` và giữ lịch sử commit tuyến tính đúng yêu cầu của DoraHacks) và Web Console chạy trực tiếp tại `https://cocvn157.github.io/mandaterail-hsp/`.
> 5. Upload `demo/mandaterail-hsp-demo.mp4` (YouTube/Loom/DoraHacks), điền link GitHub + link GitHub Pages ở trên và dán nội dung mục 1–3 vào form Track 2 trên DoraHacks trước `11:00 VN ngày 03/12/2026`.
