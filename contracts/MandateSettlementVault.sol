// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Minimal ERC-20 interface for stablecoin / token settlement
interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title MandateSettlementVault
/// @notice EIP-712 payment mandate verifier and A2A escrow settlement vault for HashKey Chain (Testnet 133 / Mainnet 177).
/// @dev Enforces per-transaction spend ceilings, rolling 24-hour daily budgets, nonce replay protection,
///      mandate revocation, optional principal-level policy ceilings, and immutable SettlementReceipt audit logs.
contract MandateSettlementVault {
    // -------------------------------------------------------------------------
    // Constants & Immutables
    // -------------------------------------------------------------------------

    string public constant NAME = "MandateRail HSP";
    string public constant VERSION = "1";
    uint256 public constant DAILY_WINDOW = 24 hours;

    bytes32 public constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    bytes32 public constant PAYMENT_MANDATE_TYPEHASH = keccak256(
        "PaymentMandate(address buyerAgent,address providerAgent,address token,uint256 amount,uint256 maxPerTx,uint256 dailyCap,uint256 nonce,uint256 validAfter,uint256 validBefore,bytes32 taskHash)"
    );

    uint256 private constant SECP256K1_HALF_N =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    uint256 public immutable INITIAL_CHAIN_ID;
    bytes32 public immutable INITIAL_DOMAIN_SEPARATOR;

    // -------------------------------------------------------------------------
    // Data Structures
    // -------------------------------------------------------------------------

    struct PaymentMandate {
        address buyerAgent;
        address providerAgent;
        address token; // address(0) for native HSK, ERC-20 address otherwise
        uint256 amount;
        uint256 maxPerTx;
        uint256 dailyCap;
        uint256 nonce;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 taskHash;
    }

    struct DailyTracker {
        uint256 windowStart;
        uint256 spent;
    }

    struct PrincipalPolicy {
        uint256 maxPerTxCeiling;
        uint256 dailyCapCeiling;
        bool enforced;
        bool frozen;
    }

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    uint256 private _locked = 1;

    /// @notice Vault balances held by buyer agents per token (address(0) = native HSK).
    mapping(address buyerAgent => mapping(address token => uint256 balance)) public vaultBalances;

    /// @notice Tracks consumed nonces per buyerAgent to prevent replay attacks.
    mapping(address buyerAgent => mapping(uint256 nonce => bool used)) public usedNonces;

    /// @notice Tracks explicitly revoked nonces per buyerAgent.
    mapping(address buyerAgent => mapping(uint256 nonce => bool revoked)) public revokedNonces;

    /// @notice Tracks explicitly revoked EIP-712 mandate digests.
    mapping(bytes32 mandateDigest => bool revoked) public revokedMandates;

    /// @notice Rolling 24-hour spend window per buyerAgent and token.
    mapping(address buyerAgent => mapping(address token => DailyTracker)) public dailyTrackers;

    /// @notice Optional principal guardian assigned to oversee a buyerAgent.
    mapping(address buyerAgent => address principal) public principals;

    /// @notice Optional principal-enforced hard ceiling overriding mandate caps.
    mapping(address buyerAgent => mapping(address token => PrincipalPolicy)) public principalPolicies;

    /// @notice Total number of settled receipts recorded by this vault.
    uint256 public totalReceipts;

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error ReentrancyGuard();
    error ZeroAddress();
    error ZeroAmount();
    error Unauthorized();
    error AgentFrozen();
    error InvalidCapConfiguration();
    error OverMaxPerTx(uint256 amount, uint256 maxPerTx);
    error DailyCapExceeded(uint256 projectedSpend, uint256 dailyCap);
    error MandateNotYetValid(uint256 currentTime, uint256 validAfter);
    error MandateExpired(uint256 currentTime, uint256 validBefore);
    error NonceAlreadyUsed(address buyerAgent, uint256 nonce);
    error MandateWasRevoked(bytes32 mandateDigest, uint256 nonce);
    error InvalidTaskHash();
    error InvalidSignature();
    error InsufficientVaultBalance(uint256 available, uint256 required);
    error NativeTransferFailed();
    error TokenTransferFailed();

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event VaultDeposited(address indexed buyerAgent, address indexed token, uint256 amount);
    event VaultWithdrawn(address indexed buyerAgent, address indexed token, address indexed to, uint256 amount);
    event PrincipalAssigned(address indexed buyerAgent, address indexed principal);
    event PrincipalPolicyUpdated(
        address indexed buyerAgent,
        address indexed token,
        uint256 maxPerTxCeiling,
        uint256 dailyCapCeiling,
        bool enforced,
        bool frozen
    );
    event NonceRevoked(address indexed buyerAgent, uint256 indexed nonce, address indexed revoker);
    event MandateRevoked(bytes32 indexed mandateDigest, address indexed revoker);
    event DailyWindowReset(address indexed buyerAgent, address indexed token, uint256 windowStart);
    event SettlementReceipt(
        bytes32 indexed receiptId,
        bytes32 indexed mandateDigest,
        address indexed buyerAgent,
        address providerAgent,
        address token,
        uint256 amount,
        uint256 nonce,
        bytes32 taskHash,
        bytes32 executionProofHash,
        uint256 chainId,
        uint256 settledAt
    );

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier nonReentrant() {
        if (_locked != 1) revert ReentrancyGuard();
        _locked = 2;
        _;
        _locked = 1;
    }

    // -------------------------------------------------------------------------
    // Constructor & EIP-712 Domain
    // -------------------------------------------------------------------------

    constructor() {
        INITIAL_CHAIN_ID = block.chainid;
        INITIAL_DOMAIN_SEPARATOR = _computeDomainSeparator(block.chainid);
    }

    function domainSeparator() public view returns (bytes32) {
        if (block.chainid == INITIAL_CHAIN_ID) {
            return INITIAL_DOMAIN_SEPARATOR;
        }
        return _computeDomainSeparator(block.chainid);
    }

    function _computeDomainSeparator(uint256 chainId_) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes(NAME)),
                keccak256(bytes(VERSION)),
                chainId_,
                address(this)
            )
        );
    }

    /// @notice Computes the EIP-712 struct hash for a PaymentMandate.
    function hashPaymentMandate(PaymentMandate calldata mandate) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                PAYMENT_MANDATE_TYPEHASH,
                mandate.buyerAgent,
                mandate.providerAgent,
                mandate.token,
                mandate.amount,
                mandate.maxPerTx,
                mandate.dailyCap,
                mandate.nonce,
                mandate.validAfter,
                mandate.validBefore,
                mandate.taskHash
            )
        );
    }

    /// @notice Computes the full EIP-712 digest signed by buyerAgent.
    function computeMandateDigest(PaymentMandate calldata mandate) public view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), hashPaymentMandate(mandate)));
    }

    // -------------------------------------------------------------------------
    // Vault Funding & Withdrawals
    // -------------------------------------------------------------------------

    function depositNative(address buyerAgent) external payable {
        if (buyerAgent == address(0)) revert ZeroAddress();
        if (msg.value == 0) revert ZeroAmount();
        vaultBalances[buyerAgent][address(0)] += msg.value;
        emit VaultDeposited(buyerAgent, address(0), msg.value);
    }

    function depositToken(address buyerAgent, address token, uint256 amount) external nonReentrant {
        if (buyerAgent == address(0) || token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        bool ok = IERC20(token).transferFrom(msg.sender, address(this), amount);
        if (!ok) revert TokenTransferFailed();
        uint256 received = IERC20(token).balanceOf(address(this)) - balanceBefore;
        if (received == 0) revert ZeroAmount();

        vaultBalances[buyerAgent][token] += received;
        emit VaultDeposited(buyerAgent, token, received);
    }

    function withdrawVault(address buyerAgent, address token, address to, uint256 amount) external nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (!_isAuthorizedController(buyerAgent, msg.sender)) revert Unauthorized();

        uint256 available = vaultBalances[buyerAgent][token];
        if (available < amount) revert InsufficientVaultBalance(available, amount);

        vaultBalances[buyerAgent][token] = available - amount;
        _payout(token, to, amount);

        emit VaultWithdrawn(buyerAgent, token, to, amount);
    }

    // -------------------------------------------------------------------------
    // Principal Governance & Mandate Revocation
    // -------------------------------------------------------------------------

    function assignPrincipal(address buyerAgent, address principal) external {
        if (buyerAgent == address(0) || principal == address(0)) revert ZeroAddress();
        address currentPrincipal = principals[buyerAgent];
        if (currentPrincipal == address(0)) {
            if (msg.sender != buyerAgent) revert Unauthorized();
        } else {
            if (msg.sender != currentPrincipal) revert Unauthorized();
        }
        principals[buyerAgent] = principal;
        emit PrincipalAssigned(buyerAgent, principal);
    }

    function setPrincipalPolicy(
        address buyerAgent,
        address token,
        uint256 maxPerTxCeiling,
        uint256 dailyCapCeiling,
        bool enforced,
        bool frozen
    ) external {
        if (!_isAuthorizedController(buyerAgent, msg.sender)) revert Unauthorized();
        if (enforced && (maxPerTxCeiling == 0 || dailyCapCeiling < maxPerTxCeiling)) {
            revert InvalidCapConfiguration();
        }
        principalPolicies[buyerAgent][token] = PrincipalPolicy({
            maxPerTxCeiling: maxPerTxCeiling,
            dailyCapCeiling: dailyCapCeiling,
            enforced: enforced,
            frozen: frozen
        });
        emit PrincipalPolicyUpdated(buyerAgent, token, maxPerTxCeiling, dailyCapCeiling, enforced, frozen);
    }

    function revokeNonce(address buyerAgent, uint256 nonce) external {
        if (!_isAuthorizedController(buyerAgent, msg.sender)) revert Unauthorized();
        revokedNonces[buyerAgent][nonce] = true;
        emit NonceRevoked(buyerAgent, nonce, msg.sender);
    }

    function revokeMandate(PaymentMandate calldata mandate) external {
        if (!_isAuthorizedController(mandate.buyerAgent, msg.sender)) revert Unauthorized();
        bytes32 digest = computeMandateDigest(mandate);
        revokedMandates[digest] = true;
        emit MandateRevoked(digest, msg.sender);
    }

    // -------------------------------------------------------------------------
    // Core HSP A2A Mandate Verification & Settlement
    // -------------------------------------------------------------------------

    function settleMandate(
        PaymentMandate calldata mandate,
        bytes calldata signature,
        bytes32 executionProofHash
    ) external payable nonReentrant returns (bytes32 receiptId) {
        bytes32 mandateDigest = _verifyAndTrackMandate(mandate, signature);

        totalReceipts += 1;
        receiptId = keccak256(
            abi.encode(
                mandateDigest,
                executionProofHash,
                block.chainid,
                block.timestamp,
                totalReceipts
            )
        );

        // Payout to providerAgent
        _payout(mandate.token, mandate.providerAgent, mandate.amount);

        emit SettlementReceipt(
            receiptId,
            mandateDigest,
            mandate.buyerAgent,
            mandate.providerAgent,
            mandate.token,
            mandate.amount,
            mandate.nonce,
            mandate.taskHash,
            executionProofHash,
            block.chainid,
            block.timestamp
        );
    }

    function _verifyAndTrackMandate(
        PaymentMandate calldata mandate,
        bytes calldata signature
    ) internal returns (bytes32 mandateDigest) {
        if (mandate.buyerAgent == address(0) || mandate.providerAgent == address(0)) {
            revert ZeroAddress();
        }
        if (mandate.amount == 0) revert ZeroAmount();
        if (mandate.taskHash == bytes32(0)) revert InvalidTaskHash();
        if (mandate.maxPerTx == 0 || mandate.dailyCap < mandate.maxPerTx) {
            revert InvalidCapConfiguration();
        }

        // Optional inline native top-up when buyerAgent invokes directly
        if (msg.value > 0) {
            if (mandate.token != address(0) || msg.sender != mandate.buyerAgent) {
                revert Unauthorized();
            }
            vaultBalances[mandate.buyerAgent][address(0)] += msg.value;
            emit VaultDeposited(mandate.buyerAgent, address(0), msg.value);
        }

        // Check temporal validity window
        if (block.timestamp < mandate.validAfter) {
            revert MandateNotYetValid(block.timestamp, mandate.validAfter);
        }
        if (block.timestamp > mandate.validBefore) {
            revert MandateExpired(block.timestamp, mandate.validBefore);
        }

        // Check replay and explicit revocations
        if (usedNonces[mandate.buyerAgent][mandate.nonce]) {
            revert NonceAlreadyUsed(mandate.buyerAgent, mandate.nonce);
        }

        mandateDigest = computeMandateDigest(mandate);
        if (revokedNonces[mandate.buyerAgent][mandate.nonce] || revokedMandates[mandateDigest]) {
            revert MandateWasRevoked(mandateDigest, mandate.nonce);
        }

        // Verify ECDSA EIP-712 signature against buyerAgent
        if (_recoverSigner(mandateDigest, signature) != mandate.buyerAgent) {
            revert InvalidSignature();
        }

        // Resolve effective caps (bounded by principal policy if configured)
        (uint256 effectiveMaxPerTx, uint256 effectiveDailyCap) = _resolveEffectiveCaps(
            mandate.buyerAgent,
            mandate.token,
            mandate.maxPerTx,
            mandate.dailyCap
        );

        // Enforce per-transaction spend ceiling
        if (mandate.amount > effectiveMaxPerTx) {
            revert OverMaxPerTx(mandate.amount, effectiveMaxPerTx);
        }

        // Enforce rolling 24-hour daily budget
        DailyTracker storage tracker = dailyTrackers[mandate.buyerAgent][mandate.token];
        if (tracker.windowStart == 0 || block.timestamp >= tracker.windowStart + DAILY_WINDOW) {
            tracker.windowStart = block.timestamp;
            tracker.spent = 0;
            emit DailyWindowReset(mandate.buyerAgent, mandate.token, block.timestamp);
        }

        uint256 projectedSpend = tracker.spent + mandate.amount;
        if (projectedSpend > effectiveDailyCap) {
            revert DailyCapExceeded(projectedSpend, effectiveDailyCap);
        }

        // Ensure funded vault balance
        uint256 available = vaultBalances[mandate.buyerAgent][mandate.token];
        if (available < mandate.amount) {
            revert InsufficientVaultBalance(available, mandate.amount);
        }

        // Effects before external interactions
        usedNonces[mandate.buyerAgent][mandate.nonce] = true;
        tracker.spent = projectedSpend;
        vaultBalances[mandate.buyerAgent][mandate.token] = available - mandate.amount;
    }

    function _resolveEffectiveCaps(
        address buyerAgent,
        address token,
        uint256 mandateMaxPerTx,
        uint256 mandateDailyCap
    ) internal view returns (uint256 effectiveMaxPerTx, uint256 effectiveDailyCap) {
        PrincipalPolicy memory policy = principalPolicies[buyerAgent][token];
        if (policy.frozen) revert AgentFrozen();

        effectiveMaxPerTx = mandateMaxPerTx;
        effectiveDailyCap = mandateDailyCap;
        if (policy.enforced) {
            if (policy.maxPerTxCeiling < effectiveMaxPerTx) {
                effectiveMaxPerTx = policy.maxPerTxCeiling;
            }
            if (policy.dailyCapCeiling < effectiveDailyCap) {
                effectiveDailyCap = policy.dailyCapCeiling;
            }
        }
    }

    // -------------------------------------------------------------------------
    // Read Helpers
    // -------------------------------------------------------------------------

    function remainingDailyBudget(address buyerAgent, address token) external view returns (uint256 spent, uint256 windowStart) {
        DailyTracker memory tracker = dailyTrackers[buyerAgent][token];
        if (tracker.windowStart == 0 || block.timestamp >= tracker.windowStart + DAILY_WINDOW) {
            return (0, block.timestamp);
        }
        return (tracker.spent, tracker.windowStart);
    }

    // -------------------------------------------------------------------------
    // Internal Helpers
    // -------------------------------------------------------------------------

    function _isAuthorizedController(address buyerAgent, address caller) internal view returns (bool) {
        address principal = principals[buyerAgent];
        if (principal == address(0)) {
            return caller == buyerAgent;
        }
        return caller == principal;
    }

    function _payout(address token, address to, uint256 amount) internal {
        if (token == address(0)) {
            (bool ok, ) = payable(to).call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            bool ok = IERC20(token).transfer(to, amount);
            if (!ok) revert TokenTransferFailed();
        }
    }

    function _recoverSigner(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) return address(0);

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        if (v < 27) {
            v += 27;
        }
        if (v != 27 && v != 28) return address(0);
        if (uint256(s) > SECP256K1_HALF_N) return address(0);

        address recovered = ecrecover(digest, v, r, s);
        if (recovered == address(0)) return address(0);
        return recovered;
    }
}
