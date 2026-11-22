import { parseAbi, type Abi } from "viem";

const VAULT_ABI_SIGNATURES: readonly string[] = [
  // Constants & Immutables
  "function NAME() view returns (string)",
  "function VERSION() view returns (string)",
  "function DAILY_WINDOW() view returns (uint256)",
  "function INITIAL_CHAIN_ID() view returns (uint256)",
  "function INITIAL_DOMAIN_SEPARATOR() view returns (bytes32)",
  "function domainSeparator() view returns (bytes32)",
  "function EIP712_DOMAIN_TYPEHASH() view returns (bytes32)",
  "function PAYMENT_MANDATE_TYPEHASH() view returns (bytes32)",

  // Public State Getters
  "function totalReceipts() view returns (uint256)",
  "function vaultBalances(address buyerAgent, address token) view returns (uint256)",
  "function usedNonces(address buyerAgent, uint256 nonce) view returns (bool)",
  "function revokedNonces(address buyerAgent, uint256 nonce) view returns (bool)",
  "function revokedMandates(bytes32 mandateDigest) view returns (bool)",
  "function dailyTrackers(address buyerAgent, address token) view returns (uint256 windowStart, uint256 spent)",
  "function principals(address buyerAgent) view returns (address)",
  "function principalPolicies(address buyerAgent, address token) view returns (uint256 maxPerTxCeiling, uint256 dailyCapCeiling, bool enforced, bool frozen)",
  "function remainingDailyBudget(address buyerAgent, address token) view returns (uint256 spent, uint256 windowStart)",

  // EIP-712 Hashing Helpers
  "function hashPaymentMandate((address buyerAgent, address providerAgent, address token, uint256 amount, uint256 maxPerTx, uint256 dailyCap, uint256 nonce, uint256 validAfter, uint256 validBefore, bytes32 taskHash) mandate) pure returns (bytes32)",
  "function computeMandateDigest((address buyerAgent, address providerAgent, address token, uint256 amount, uint256 maxPerTx, uint256 dailyCap, uint256 nonce, uint256 validAfter, uint256 validBefore, bytes32 taskHash) mandate) view returns (bytes32)",

  // Vault Funding, Governance & Settlement
  "function depositNative(address buyerAgent) payable",
  "function depositToken(address buyerAgent, address token, uint256 amount)",
  "function withdrawVault(address buyerAgent, address token, address to, uint256 amount)",
  "function assignPrincipal(address buyerAgent, address principal)",
  "function setPrincipalPolicy(address buyerAgent, address token, uint256 maxPerTxCeiling, uint256 dailyCapCeiling, bool enforced, bool frozen)",
  "function revokeNonce(address buyerAgent, uint256 nonce)",
  "function revokeMandate((address buyerAgent, address providerAgent, address token, uint256 amount, uint256 maxPerTx, uint256 dailyCap, uint256 nonce, uint256 validAfter, uint256 validBefore, bytes32 taskHash) mandate)",
  "function settleMandate((address buyerAgent, address providerAgent, address token, uint256 amount, uint256 maxPerTx, uint256 dailyCap, uint256 nonce, uint256 validAfter, uint256 validBefore, bytes32 taskHash) mandate, bytes signature, bytes32 executionProofHash) payable returns (bytes32 receiptId)",

  // Events
  "event VaultDeposited(address indexed buyerAgent, address indexed token, uint256 amount)",
  "event VaultWithdrawn(address indexed buyerAgent, address indexed token, address indexed to, uint256 amount)",
  "event PrincipalAssigned(address indexed buyerAgent, address indexed principal)",
  "event PrincipalPolicyUpdated(address indexed buyerAgent, address indexed token, uint256 maxPerTxCeiling, uint256 dailyCapCeiling, bool enforced, bool frozen)",
  "event NonceRevoked(address indexed buyerAgent, uint256 indexed nonce, address indexed revoker)",
  "event MandateRevoked(bytes32 indexed mandateDigest, address indexed revoker)",
  "event DailyWindowReset(address indexed buyerAgent, address indexed token, uint256 windowStart)",
  "event SettlementReceipt(bytes32 indexed receiptId, bytes32 indexed mandateDigest, address indexed buyerAgent, address providerAgent, address token, uint256 amount, uint256 nonce, bytes32 taskHash, bytes32 executionProofHash, uint256 chainId, uint256 settledAt)",

  // Custom Errors
  "error ReentrancyGuard()",
  "error ZeroAddress()",
  "error ZeroAmount()",
  "error Unauthorized()",
  "error AgentFrozen()",
  "error InvalidCapConfiguration()",
  "error OverMaxPerTx(uint256 amount, uint256 maxPerTx)",
  "error DailyCapExceeded(uint256 projectedSpend, uint256 dailyCap)",
  "error MandateNotYetValid(uint256 currentTime, uint256 validAfter)",
  "error MandateExpired(uint256 currentTime, uint256 validBefore)",
  "error NonceAlreadyUsed(address buyerAgent, uint256 nonce)",
  "error MandateWasRevoked(bytes32 mandateDigest, uint256 nonce)",
  "error InvalidTaskHash()",
  "error InvalidSignature()",
  "error InsufficientVaultBalance(uint256 available, uint256 required)",
  "error NativeTransferFailed()",
  "error TokenTransferFailed()"
];

/**
 * Strongly typed ABI matching contracts/MandateSettlementVault.sol (^0.8.24).
 * Kept compact for frontend bundle efficiency and verified in tests/contract.test.ts
 * against the live solc compilation artifact.
 */
export const MANDATE_VAULT_ABI: Abi = parseAbi(VAULT_ABI_SIGNATURES);
