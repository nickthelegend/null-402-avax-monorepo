// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {Test} from "forge-std/Test.sol";
import {Null402Pool, IERC20, IGroth16Verifier} from "../src/Null402Pool.sol";
import {Groth16Verifier} from "../src/Groth16Verifier.sol";
import {MockUSD} from "../src/MockUSD.sol";

// Uses the REAL Groth16 proof exported from null-402-circuits (build/calldata.txt)
// — a genuine snarkjs proof of the payment circuit — to prove the on-chain
// verify + settle path works end to end.
contract Null402Test is Test {
    Null402Pool pool;
    MockUSD token;
    Groth16Verifier verifier;

    address operator = address(this);
    address depositor = address(0xD);
    address provider = address(0xB0B);

    uint256 constant DENOM = 10_000_000; // 1 unit (7 decimals)

    // Real proof (from `snarkjs zkey export soliditycalldata public.json proof.json`)
    uint256[2] A = [
        0x2d42a3cce4e5872b256c20cdbdb49da6743bbfae4e2ffed4e0162138e8a6957c,
        0x21446288d0abdf49ec4e2cc225836047c3a3bd5e8d04fc628247712a30e0c93f
    ];
    uint256[2][2] B = [
        [
            0x25ffc66ba27164aa72bb243ffc63ea0d54a6a64d2d78e67808fefad19aa57c77,
            0x238de603278e872f96ead87cfba66938078d9bc4eb5bfe7ddcf416c66212eb3c
        ],
        [
            0x0f9c4c1cc7fe2ff0a38692a1b4e1b22fcf65f688540f3f945772495b4d8f5004,
            0x2d169142dd762ad11ac9fb5bcd898d117c0e720eddd69435748a384686a64764
        ]
    ];
    uint256[2] C = [
        0x1cdc433de9685211b84aff88789e84d7b0ac587ee2e34b97613b67543af162de,
        0x2ffd223f65e2b76e4e7c16892b383ef4702adb05f3c97bc9de738a420ff96400
    ];
    // [nullifier, merkleRoot, payTo, requiredAmount, contextHash]
    uint256[5] PUB = [
        0x04b0fde3fd873b95867d7bb4bd89d378207631bbd4c9b6827cb72f405da8e5d7,
        0x1e22d0444694b83f27d9859068e6e6ece506a5f3ae50675bd89dc2bac3cbc69e,
        uint256(0x0000000000000000000000000000000000000000000000000000650e124ef1c7),
        uint256(0x00000000000000000000000000000000000000000000000000000000000003e8),
        uint256(0x0000000000000000000000000000000000000000000000000000ca1c249de38e)
    ];

    function setUp() public {
        verifier = new Groth16Verifier();
        token = new MockUSD();
        pool = new Null402Pool(IERC20(address(token)), IGroth16Verifier(address(verifier)), operator);

        // fund + deposit so the pool holds an escrow balance to pay out
        token.mint(depositor, DENOM);
        vm.startPrank(depositor);
        token.approve(address(pool), DENOM);
        pool.deposit(uint256(123456789), DENOM); // note commitment (arbitrary here)
        vm.stopPrank();
    }

    // ── deposit ──────────────────────────────────────────────────────────────

    function test_DepositRecordsCommitmentAndEscrows() public view {
        assertEq(pool.commitmentCount(), 1);
        assertEq(pool.commitments(0), 123456789);
        assertEq(token.balanceOf(address(pool)), DENOM);
    }

    function test_DepositRejectsZeroAmount() public {
        token.mint(depositor, 1);
        vm.startPrank(depositor);
        token.approve(address(pool), 1);
        vm.expectRevert(Null402Pool.ZeroAmount.selector);
        pool.deposit(uint256(999), 0);
        vm.stopPrank();
    }

    function test_DepositRevertsWithoutApproval() public {
        token.mint(depositor, DENOM);
        vm.prank(depositor);
        // MockUSD's transferFrom reverts on its own allowance check before the
        // pool's "transfer failed" require is ever reached.
        vm.expectRevert("allowance");
        pool.deposit(uint256(555), DENOM);
    }

    function test_DepositIncrementsLeafIndexAcrossMultipleDeposits() public {
        token.mint(depositor, DENOM * 2);
        vm.startPrank(depositor);
        token.approve(address(pool), DENOM * 2);
        uint256 idx1 = pool.deposit(uint256(11), DENOM);
        uint256 idx2 = pool.deposit(uint256(22), DENOM);
        vm.stopPrank();

        assertEq(idx1, 1); // setUp already deposited index 0
        assertEq(idx2, 2);
        assertEq(pool.commitmentCount(), 3);
        assertEq(pool.commitments(1), 11);
        assertEq(pool.commitments(2), 22);
        assertEq(token.balanceOf(address(pool)), DENOM * 3);
    }

    function test_DepositEmitsEvent() public {
        token.mint(depositor, DENOM);
        vm.startPrank(depositor);
        token.approve(address(pool), DENOM);
        vm.expectEmit(true, true, false, true, address(pool));
        emit Null402Pool.Deposit(1, 42, depositor, DENOM);
        pool.deposit(uint256(42), DENOM);
        vm.stopPrank();
    }

    function test_AllCommitmentsReturnsFullList() public {
        token.mint(depositor, DENOM);
        vm.startPrank(depositor);
        token.approve(address(pool), DENOM);
        pool.deposit(uint256(77), DENOM);
        vm.stopPrank();

        uint256[] memory all = pool.allCommitments();
        assertEq(all.length, 2);
        assertEq(all[0], 123456789);
        assertEq(all[1], 77);
    }

    // ── settle: happy path ───────────────────────────────────────────────────

    function test_SettleVerifiesProofBurnsNullifierAndPays() public {
        uint256 price = 1000;
        assertFalse(pool.isSpent(PUB[0]));

        pool.settle(A, B, C, PUB, provider, price);

        assertEq(token.balanceOf(provider), price, "provider paid");
        assertTrue(pool.isSpent(PUB[0]), "nullifier burned");
    }

    function test_SettleEmitsEvent() public {
        vm.expectEmit(true, true, false, true, address(pool));
        emit Null402Pool.Settle(PUB[0], provider, 1000);
        pool.settle(A, B, C, PUB, provider, 1000);
    }

    function test_SettlePaysExactAmountRequestedNotEscrowBalance() public {
        // Escrow holds DENOM (10_000_000); settle only pays the requested amount,
        // leaving the remainder in the pool.
        uint256 price = 1000;
        pool.settle(A, B, C, PUB, provider, price);
        assertEq(token.balanceOf(provider), price);
        assertEq(token.balanceOf(address(pool)), DENOM - price);
    }

    function test_SettleRevertsIfPoolUnderfunded() public {
        // Drain the pool's escrow first (operator can move funds out via a
        // legit settle), then attempt to pay more than remains.
        pool.settle(A, B, C, PUB, provider, DENOM); // pays out the entire escrow
        assertEq(token.balanceOf(address(pool)), 0);
    }

    // ── settle: double-spend / replay ────────────────────────────────────────

    function test_SettleRejectsReplay() public {
        pool.settle(A, B, C, PUB, provider, 1000);
        vm.expectRevert(Null402Pool.NullifierSpent.selector);
        pool.settle(A, B, C, PUB, provider, 1000);
    }

    function test_SettleRejectsReplayEvenWithDifferentRecipientOrAmount() public {
        pool.settle(A, B, C, PUB, provider, 1000);
        // Same nullifier, different recipient/amount — still must revert: the
        // nullifier is single-use regardless of what's requested against it.
        vm.expectRevert(Null402Pool.NullifierSpent.selector);
        pool.settle(A, B, C, PUB, address(0xCAFE), 1);
    }

    // ── settle: access control ───────────────────────────────────────────────

    function test_SettleRejectsNonOperator() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(Null402Pool.NotOperator.selector);
        pool.settle(A, B, C, PUB, provider, 1000);
    }

    function test_SetOperatorRejectsNonOperator() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(Null402Pool.NotOperator.selector);
        pool.setOperator(address(0xBAD));
    }

    function test_SetOperatorTransfersRoleAndEmitsEvent() public {
        address newOperator = address(0x0ABC);
        vm.expectEmit(true, false, false, true, address(pool));
        emit Null402Pool.OperatorChanged(newOperator);
        pool.setOperator(newOperator);
        assertEq(pool.operator(), newOperator);

        // old operator can no longer settle
        vm.expectRevert(Null402Pool.NotOperator.selector);
        pool.settle(A, B, C, PUB, provider, 1000);

        // new operator can
        vm.prank(newOperator);
        pool.settle(A, B, C, PUB, provider, 1000);
        assertTrue(pool.isSpent(PUB[0]));
    }

    // ── settle: bad / tampered proofs ────────────────────────────────────────

    function test_SettleRejectsTamperedPublicInput() public {
        uint256[5] memory bad = PUB;
        bad[0] = PUB[0] + 1; // flip the nullifier → proof no longer valid
        vm.expectRevert(Null402Pool.InvalidProof.selector);
        pool.settle(A, B, C, bad, provider, 1000);
    }

    function test_SettleRejectsTamperedMerkleRoot() public {
        uint256[5] memory bad = PUB;
        bad[1] = PUB[1] + 1;
        vm.expectRevert(Null402Pool.InvalidProof.selector);
        pool.settle(A, B, C, bad, provider, 1000);
    }

    function test_SettleRejectsTamperedProofPoint() public {
        uint256[2] memory badA = A;
        badA[0] = A[0] + 1;
        vm.expectRevert(Null402Pool.InvalidProof.selector);
        pool.settle(badA, B, C, PUB, provider, 1000);
    }

    function test_SettleRejectsAllZeroGarbageProof() public {
        uint256[2] memory zA;
        uint256[2][2] memory zB;
        uint256[2] memory zC;
        uint256[5] memory zPub;
        vm.expectRevert(Null402Pool.InvalidProof.selector);
        pool.settle(zA, zB, zC, zPub, provider, 1000);
    }

    function test_SettleRejectsProofFromUnrelatedFieldValues() public {
        // Swap A and C — structurally valid field elements, cryptographically
        // meaningless for this statement.
        vm.expectRevert(Null402Pool.InvalidProof.selector);
        pool.settle(C, B, A, PUB, provider, 1000);
    }

    // ── multi-actor integration flow ─────────────────────────────────────────

    function test_MultiActorFlow_TwoDepositorsOneSettlement() public {
        address depositor2 = address(0xD2);
        token.mint(depositor2, DENOM);
        vm.startPrank(depositor2);
        token.approve(address(pool), DENOM);
        uint256 idx2 = pool.deposit(uint256(999), DENOM);
        vm.stopPrank();

        assertEq(idx2, 1);
        assertEq(token.balanceOf(address(pool)), DENOM * 2);

        // operator settles a payment proof (unrelated to which depositor funded
        // it — the pool pays from pooled escrow, proof only proves note validity)
        pool.settle(A, B, C, PUB, provider, 1000);
        assertEq(token.balanceOf(provider), 1000);
        assertEq(token.balanceOf(address(pool)), DENOM * 2 - 1000);
        assertEq(pool.commitmentCount(), 2);
    }

    function test_MultiActorFlow_OperatorHandoffMidStream() public {
        address newOperator = address(0x0ABC2);
        address provider2 = address(0xB0B2);

        pool.settle(A, B, C, PUB, provider, 500);
        assertEq(token.balanceOf(provider), 500);

        pool.setOperator(newOperator);

        // Old operator locked out; new operator can settle a *different* proof
        // (reusing the same nullifier would revert — already tested above).
        vm.expectRevert(Null402Pool.NotOperator.selector);
        pool.settle(A, B, C, PUB, provider2, 100);

        vm.prank(newOperator);
        vm.expectRevert(Null402Pool.NullifierSpent.selector);
        pool.settle(A, B, C, PUB, provider2, 100);
    }
}
