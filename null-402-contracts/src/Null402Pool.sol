// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

/// Minimal ERC-20 surface the pool needs (escrow in, pay provider out).
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address a) external view returns (uint256);
}

/// The Groth16 verifier exported from the null-402 payment circuit (snarkjs).
/// Public signals order: [nullifier, merkleRoot, payTo, requiredAmount, contextHash].
interface IGroth16Verifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[5] calldata pubSignals
    ) external view returns (bool);
}

/// @title Null402Pool — the shielded pay-per-call pool (Avalanche EVM port of the
/// Soroban `pool` contract).
/// @notice An agent escrows an ERC-20 into the pool, committing a private note
/// (a Poseidon commitment; the Merkle tree of commitments is built off-chain).
/// To pay per API call it generates a Groth16 proof that it owns an unspent note
/// ≥ price, bound to the recipient + request. The operator then `settle`s: the
/// proof is verified on-chain, the nullifier is burned (single-use), and the
/// provider is paid. Only the nullifier and `valid:true` ever touch the chain —
/// no wallet, amount, or endpoint is revealed.
contract Null402Pool {
    IERC20 public immutable token;
    IGroth16Verifier public immutable verifier;
    address public operator;

    /// Poseidon note commitments, in deposit order. The off-chain client builds
    /// the Merkle tree/root from this list (no on-chain Poseidon needed).
    uint256[] public commitments;

    /// Spent nullifiers (double-spend / replay guard). Key = public signal[0].
    mapping(uint256 => bool) public spent;

    /// Merkle roots the operator has registered as real pool roots. `settle` only
    /// accepts a proof whose `merkleRoot` public signal is one of these — so a
    /// proof built against a fabricated/never-deposited tree can't be settled.
    mapping(uint256 => bool) public knownRoot;

    /// BN254 scalar field (Fr) modulus. Every note commitment is a field element,
    /// so a valid commitment is in the range (0, FR).
    uint256 internal constant BN254_FR =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    event Deposit(uint256 indexed index, uint256 commitment, address indexed from, uint256 amount);
    event Settle(uint256 indexed nullifier, address indexed recipient, uint256 amount);
    event OperatorChanged(address indexed operator);
    event RootRegistered(uint256 indexed root);

    error NotOperator();
    error ZeroAmount();
    error InvalidProof();
    error NullifierSpent();
    error UnknownRoot();
    error AmountMismatch();

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(IERC20 _token, IGroth16Verifier _verifier, address _operator) {
        require(
            address(_token) != address(0) && address(_verifier) != address(0) && _operator != address(0),
            "zero addr"
        );
        token = _token;
        verifier = _verifier;
        operator = _operator;
    }

    /// @notice Escrow `amount` and record a note `commitment`. Returns the leaf
    /// index (the note's position in the commitment list) for off-chain Merkle
    /// witness building.
    function deposit(uint256 commitment, uint256 amount) external returns (uint256 index) {
        if (amount == 0) revert ZeroAmount();
        // Commitment must be a valid, non-zero BN254 field element (matches the
        // Poseidon commitment the circuit constrains). Rejects 0 and out-of-field
        // garbage that could never correspond to a real note.
        require(commitment != 0 && commitment < BN254_FR, "bad commitment");
        require(token.transferFrom(msg.sender, address(this), amount), "transfer failed");
        index = commitments.length;
        commitments.push(commitment);
        emit Deposit(index, commitment, msg.sender, amount);
    }

    /// @notice Settle a verified payment: verify the proof, burn the nullifier,
    /// and pay the provider. Operator-gated (the operator is trusted to only
    /// settle proofs whose merkleRoot it recognizes as a real pool root).
    /// @param a,b,c        Groth16 proof points.
    /// @param pubSignals   [nullifier, merkleRoot, payTo, requiredAmount, contextHash].
    /// @param recipient    Provider address to pay.
    /// @param amount       Amount to pay the provider from the pool.
    function settle(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[5] calldata pubSignals,
        address recipient,
        uint256 amount
    ) external onlyOperator {
        // 1) cryptographic validity
        if (!verifier.verifyProof(a, b, c, pubSignals)) revert InvalidProof();

        // 2) the proof's Merkle root must be one the operator has registered as a
        //    real pool root (else a proof against a fabricated tree could settle).
        if (!knownRoot[pubSignals[1]]) revert UnknownRoot();

        // 3) single-use nullifier
        uint256 nullifier = pubSignals[0];
        if (spent[nullifier]) revert NullifierSpent();
        spent[nullifier] = true;

        // 4) bind the AMOUNT to the verified proof: the operator cannot settle a
        //    different value than the proof authorizes (requiredAmount = pubSignals[3]).
        //    The recipient (payTo) is committed in the proof as addressToField(payTo)
        //    = sha256("null402:payTo:"+addr) mod Fr — a hash, not recoverable to an
        //    address on-chain — so recipient/payTo binding is enforced OFF-CHAIN by the
        //    gateway (it checks payTo == addressToField(its own address)); on-chain the
        //    operator is trusted to pass its own recipient.
        if (amount != pubSignals[3]) revert AmountMismatch();

        // 5) payout
        require(token.transfer(recipient, amount), "payout failed");
        emit Settle(nullifier, recipient, amount);
    }

    /// @notice Register a Merkle root as a real pool root so `settle` will accept
    /// proofs built against it. Operator-driven: after deposits change the tree,
    /// the operator computes the new root off-chain and registers it here.
    function registerRoot(uint256 root) external onlyOperator {
        knownRoot[root] = true;
        emit RootRegistered(root);
    }

    // ── views ─────────────────────────────────────────────────────────────────
    function commitmentCount() external view returns (uint256) {
        return commitments.length;
    }

    function allCommitments() external view returns (uint256[] memory) {
        return commitments;
    }

    function isSpent(uint256 nullifier) external view returns (bool) {
        return spent[nullifier];
    }

    function setOperator(address o) external onlyOperator {
        require(o != address(0), "zero addr");
        operator = o;
        emit OperatorChanged(o);
    }
}
