// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {KingBase} from "./KingBase.sol";
import {KingRouter} from "src/KingRouter.sol";
import {IKingHook} from "src/interfaces/IKingHook.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TransientStateLibrary} from "v4-core/src/libraries/TransientStateLibrary.sol";
import {CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {CustomRevert} from "v4-core/src/libraries/CustomRevert.sol";

contract ToggleKingReceiver {
    bool public rejecting = true;

    function acceptEth() external {
        rejecting = false;
    }

    receive() external payable {
        require(!rejecting, "recipient rejected ETH");
    }
}

/// @notice Failure after a checkpoint, accrual, takeover or settlement must undo the whole order.
contract KingRouterAtomicityTest is KingBase {
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;

    function setUp() public override {
        super.setUp();
        buyExactIn(carol, 10 ether, false);
        openGame();
        buyExactIn(alice, 1 ether, true);
        vm.warp(block.timestamp + 301);
    }

    // Hash the full game/history, balances, allowance, price and fee growth. A revert that only
    // restores the king but leaves behind a fee, credit or LP price movement must fail this check.
    function stateDigest(address account) internal view returns (bytes32) {
        bytes32 game = keccak256(
            abi.encode(
                hook.throne(),
                hook.getReigns(0, type(uint256).max),
                hook.pool(),
                hook.provisionalIncome(),
                hook.lastAccrual(),
                hook.takeoverPaid(),
                hook.priceBase()
            )
        );
        bytes32 money = keccak256(
            abi.encode(
                hookClaims(),
                hook.pendingIncome(alice),
                hook.pendingIncome(bob),
                hook.pendingIncome(team),
                hook.pendingIncome(account),
                account.balance,
                address(manager).balance,
                address(router).balance,
                address(hook).balance
            )
        );
        bytes32 tokens = keccak256(
            abi.encode(
                token.balanceOf(account),
                token.balanceOf(address(manager)),
                token.balanceOf(address(router)),
                token.allowance(account, address(router))
            )
        );
        (uint160 price, int24 tick, uint24 protocolFee, uint24 lpFee) =
            IPoolManager(address(manager)).getSlot0(key.toId());
        (uint256 fee0, uint256 fee1) = IPoolManager(address(manager)).getFeeGrowthGlobals(key.toId());
        return keccak256(abi.encode(game, money, tokens, price, tick, protocolFee, lpFee, fee0, fee1));
    }

    function assertSettled() internal view {
        IPoolManager pm = IPoolManager(address(manager));
        assertFalse(pm.isUnlocked());
        assertEq(pm.getNonzeroDeltaCount(), 0);
        assertEq(pm.currencyDelta(address(hook), key.currency0), 0);
        assertEq(pm.currencyDelta(address(hook), key.currency1), 0);
        assertEq(pm.currencyDelta(address(router), key.currency0), 0);
        assertEq(pm.currencyDelta(address(router), key.currency1), 0);
    }

    function callRejected(address account, uint256 value, bytes memory data, bytes4 expected) internal {
        bytes32 beforeState = stateDigest(account);
        vm.prank(account);
        (bool ok, bytes memory reason) = address(router).call{value: value}(data);
        assertFalse(ok, "invalid order succeeded");
        assertGe(reason.length, 4, "missing error selector");
        assertEq(bytes4(reason), expected, "wrong failure path");
        assertEq(stateDigest(account), beforeState, "failed order changed state");
        assertSettled();
    }

    function test_allFourExpiredOrdersPreserveAccruingReign() public {
        uint256 deadline = block.timestamp - 1;
        callRejected(
            alice, 2 ether, abi.encodeCall(router.buyExactIn, (0, true, deadline)), KingRouter.Expired.selector
        );
        callRejected(
            alice, 2 ether, abi.encodeCall(router.buyExactOut, (1 ether, true, deadline)), KingRouter.Expired.selector
        );
        callRejected(alice, 0, abi.encodeCall(router.sellExactIn, (1 ether, 0, deadline)), KingRouter.Expired.selector);
        callRejected(alice, 0, abi.encodeCall(router.sellExactOut, (1, 1 ether, deadline)), KingRouter.Expired.selector);
    }

    function test_zeroOrdersCannotCheckpointOrDethrone() public {
        callRejected(
            alice, 0, abi.encodeCall(router.buyExactIn, (0, true, block.timestamp)), KingRouter.ZeroAmount.selector
        );
        callRejected(
            alice,
            1 ether,
            abi.encodeCall(router.buyExactOut, (0, true, block.timestamp)),
            KingRouter.ZeroAmount.selector
        );
        callRejected(
            alice, 0, abi.encodeCall(router.sellExactIn, (0, 0, block.timestamp)), KingRouter.ZeroAmount.selector
        );
        callRejected(
            alice, 0, abi.encodeCall(router.sellExactOut, (0, 1 ether, block.timestamp)), KingRouter.ZeroAmount.selector
        );
        callRejected(
            alice, 0, abi.encodeCall(router.sellExactOut, (1, 0, block.timestamp)), KingRouter.ZeroAmount.selector
        );
    }

    /// forge-config: default.fuzz.runs = 1000
    function testFuzz_failedTakeoverSlippageRestoresPreviousKing(uint96 rawPayment) public {
        uint256 payment = bound(rawPayment, 2 ether, 20 ether);
        assertGt(payment, hook.currentThronePrice());
        callRejected(
            bob,
            payment,
            abi.encodeCall(router.buyExactIn, (type(uint256).max, true, block.timestamp)),
            KingRouter.TooLittleReceived.selector
        );
        // The same order with a valid minimum can subsequently settle and take the throne.
        assertGt(buyExactIn(bob, payment, true), 0);
        assertEq(hook.king(), bob);
        assertGt(hook.pendingIncome(alice), 0);
        assertSettled();
    }

    function test_exactOutputInsufficientEthRestoresAccrualAndTakeover() public {
        callRejected(
            bob,
            1,
            abi.encodeCall(router.buyExactOut, (100_000_000 ether, true, block.timestamp)),
            KingRouter.TooMuchRequested.selector
        );
    }

    function test_bothSellModesWithNoAllowanceRestoreCheckpoint() public {
        callRejected(
            alice,
            0,
            abi.encodeCall(router.sellExactIn, (1 ether, 0, block.timestamp)),
            IERC20Errors.ERC20InsufficientAllowance.selector
        );
        callRejected(
            alice,
            0,
            abi.encodeCall(router.sellExactOut, (1, 1 ether, block.timestamp)),
            IERC20Errors.ERC20InsufficientAllowance.selector
        );
    }

    function test_balanceFailureRestoresFiniteAllowanceAndCheckpoint() public {
        uint256 tooMany = token.balanceOf(alice) + 1;
        vm.prank(alice);
        token.approve(address(router), tooMany);
        callRejected(
            alice,
            0,
            abi.encodeCall(router.sellExactIn, (tooMany, 0, block.timestamp)),
            IERC20Errors.ERC20InsufficientBalance.selector
        );
        callRejected(
            alice,
            0,
            abi.encodeCall(router.sellExactOut, (1, tooMany, block.timestamp)),
            IERC20Errors.ERC20InsufficientBalance.selector
        );
    }

    function test_sellSlippageRestoresTokensAllowanceCreditsAndReign() public {
        uint256 amount = token.balanceOf(alice);
        vm.prank(alice);
        token.approve(address(router), amount);
        callRejected(
            alice,
            0,
            abi.encodeCall(router.sellExactIn, (amount, type(uint256).max, block.timestamp)),
            KingRouter.TooLittleReceived.selector
        );
        assertGt(sellExactIn(alice, amount), 0);
        assertEq(hook.king(), address(0));
        assertEq(uint256(hook.getReign(0).reason), uint256(IKingHook.EndReason.Sold));
        assertSettled();
    }

    function test_exactOutputSellBudgetFailureRestoresCheckpoint() public {
        vm.prank(alice);
        token.approve(address(router), 1);
        callRejected(
            alice,
            0,
            abi.encodeCall(router.sellExactOut, (0.1 ether, 1, block.timestamp)),
            KingRouter.TooMuchRequested.selector
        );
    }

    function test_rejectedIncomePayoutPreservesClaimsAndCanBeRetried() public {
        ToggleKingReceiver receiver = new ToggleKingReceiver();
        vm.deal(address(receiver), 5 ether);
        buyExactIn(address(receiver), 2 ether, true);
        vm.warp(block.timestamp + 1 hours);
        uint256 owed = hook.unclaimedIncome(address(receiver));
        assertGt(owed, 0);
        bytes32 beforeState = stateDigest(address(receiver));
        vm.prank(address(receiver));
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomRevert.WrappedError.selector,
                address(receiver),
                bytes4(0),
                abi.encodeWithSignature("Error(string)", "recipient rejected ETH"),
                abi.encodeWithSelector(CurrencyLibrary.NativeTransferFailed.selector)
            )
        );
        hook.claim();
        assertEq(stateDigest(address(receiver)), beforeState);
        assertSettled();
        receiver.acceptEth();
        uint256 beforeBalance = address(receiver).balance;
        uint256 claimsBefore = hookClaims();
        vm.prank(address(receiver));
        hook.claim();
        assertEq(address(receiver).balance - beforeBalance, owed);
        assertEq(claimsBefore - hookClaims(), owed);
        assertEq(hook.unclaimedIncome(address(receiver)), 0);
        vm.prank(address(receiver));
        vm.expectRevert(IKingHook.NothingToClaim.selector);
        hook.claim();
        assertSettled();
    }
}
