// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {KingBase} from "./KingBase.sol";
import {KingHook} from "src/KingHook.sol";
import {KingToken} from "src/KingToken.sol";
import {KingRouter} from "src/KingRouter.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TransientStateLibrary} from "v4-core/src/libraries/TransientStateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {SqrtPriceMath} from "v4-core/src/libraries/SqrtPriceMath.sol";

/// @dev One LP and three traders. No injected balances after setup, mocks, swallowed reverts,
/// or token mints. Liquidity changes are interleaved with swaps, time, holdings and payouts.
contract KingLiquidityHandler is Test {
    using StateLibrary for IPoolManager;

    KingHook public immutable hook;
    KingToken public immutable token;
    KingRouter public immutable router;
    IPoolManager public immutable manager;
    PoolModifyLiquidityTest public immutable lp;
    PoolKey internal key;
    address[3] public actors;
    int24 internal constant LOWER = -887220;
    int24 internal constant UPPER = 184200;
    uint128 public immutable initialLiquidity;
    uint256 public liquidity;
    uint256 public fees;
    uint256 public paid;
    uint256 public successfulBuys;
    uint256 public successfulSells;
    uint256 public liquidityChanges;
    uint256 public payouts;

    constructor(KingHook h, KingToken t, IPoolManager pm, PoolModifyLiquidityTest lp_, address[3] memory users) {
        hook = h;
        token = t;
        router = h.router();
        manager = pm;
        lp = lp_;
        key = h.poolKey();
        actors = users;
        (uint128 starting,,) = pm.getPositionInfo(key.toId(), address(lp_), LOWER, UPPER, bytes32(0));
        initialLiquidity = starting;
        liquidity = starting;
        t.approve(address(lp_), type(uint256).max);
    }

    receive() external payable {}

    function buy(uint256 who, uint96 raw) external {
        address user = actors[who % 3];
        uint256 amount = bound(raw, 1, 1 ether);
        uint256 beforeKing = token.balanceOf(user);
        uint256 beforeEth = user.balance;
        uint256 beforeClaims = manager.balanceOf(address(hook), 0);
        uint256 expectedFee = amount * hook.feeRate() / 1_000_000;
        vm.prank(user);
        uint256 got = router.buyExactIn{value: amount}(0, false, block.timestamp);
        assertEq(beforeEth - user.balance, amount);
        assertEq(token.balanceOf(user) - beforeKing, got);
        assertEq(manager.balanceOf(address(hook), 0) - beforeClaims, expectedFee);
        fees += expectedFee;
        successfulBuys++;
    }

    function sell(uint256 who, uint256 raw) external {
        address user = actors[who % 3];
        uint256 held = token.balanceOf(user);
        if (held == 0) return;
        // Exact-input sells can partially fill. Preserve the refund obligation without imposing
        // an artificial capacity cap; skip only the manager's already-reached price boundary.
        (uint160 price,,,) = manager.getSlot0(key.toId());
        if (price == TickMath.MAX_SQRT_PRICE - 1) return;
        uint256 amount = bound(raw, 1, held);
        uint256 beforeEth = user.balance;
        uint256 beforeClaims = manager.balanceOf(address(hook), 0);
        uint256 beforeManagerTokens = token.balanceOf(address(manager));
        vm.startPrank(user);
        token.approve(address(router), amount);
        uint256 received = router.sellExactIn(amount, 0, block.timestamp);
        vm.stopPrank();
        uint256 fee = manager.balanceOf(address(hook), 0) - beforeClaims;
        assertEq(user.balance - beforeEth, received);
        assertEq(held - token.balanceOf(user), token.balanceOf(address(manager)) - beforeManagerTokens);
        assertEq(fee, (received + fee) * hook.feeRate() / 1_000_000);
        fees += fee;
        successfulSells++;
    }

    function elapse(uint32 raw) external {
        vm.warp(block.timestamp + bound(raw, 0, 2 hours));
    }

    function transferKing(uint256 from, uint256 to, uint256 raw) external {
        address sender = actors[from % 3];
        uint256 amount = bound(raw, 0, token.balanceOf(sender));
        bytes32 beforeGame = gameDigest();
        vm.prank(sender);
        token.transfer(actors[to % 3], amount);
        // Check stored game state, not the live balance projections in throne().
        assertEq(gameDigest(), beforeGame, "plain transfer executed hook logic");
    }

    function dethroneIfShort() external {
        address king = hook.king();
        if (king == address(0) || token.balanceOf(king) >= hook.requiredBalance()) return;
        hook.dethrone();
        assertEq(hook.king(), address(0));
    }

    function claim(uint256 who) external {
        address user = who % 4 == 3 ? hook.TEAM_WALLET() : actors[who % 4];
        uint256 expected = hook.unclaimedIncome(user);
        if (expected == 0) return;
        uint256 beforeEth = user.balance;
        uint256 beforeClaims = manager.balanceOf(address(hook), 0);
        vm.prank(user);
        hook.claim();
        assertEq(user.balance - beforeEth, expected);
        assertEq(beforeClaims - manager.balanceOf(address(hook), 0), expected);
        paid += expected;
        payouts++;
    }

    function gameDigest() public view returns (bytes32) {
        bytes32 reign = keccak256(
            abi.encode(
                hook.king(),
                hook.reignStart(),
                hook.lastAccrual(),
                hook.requiredBalance(),
                hook.takeoverPaid(),
                hook.priceBase()
            )
        );
        return keccak256(
            abi.encode(
                reign,
                hook.pool(),
                hook.provisionalIncome(),
                hook.reignCount(),
                manager.balanceOf(address(hook), 0),
                hook.pendingIncome(actors[0]),
                hook.pendingIncome(actors[1]),
                hook.pendingIncome(actors[2]),
                hook.pendingIncome(hook.TEAM_WALLET())
            )
        );
    }

    function changeLiquidity(uint96 raw, bool add) external {
        uint256 amount;
        if (add) {
            // At most 10,000 KING initially. Initial treasury and withdrawn assets fund additions.
            amount = bound(raw, 1e15, 1e18);
        } else {
            uint256 minimum = initialLiquidity / 4;
            if (liquidity <= minimum) return;
            amount = bound(raw, 1, liquidity - minimum);
        }
        modify(add ? int256(amount) : -int256(amount));
    }

    function collectLpFees() external {
        if (liquidity == 0) return;
        modify(0);
    }

    function modify(int256 delta) internal {
        uint256 ethValue;
        if (delta > 0) {
            (uint160 current,,,) = manager.getSlot0(key.toId());
            uint160 lower = TickMath.getSqrtPriceAtTick(LOWER);
            uint160 upper = TickMath.getSqrtPriceAtTick(UPPER);
            if (current < upper) {
                ethValue = SqrtPriceMath.getAmount0Delta(
                    current > lower ? current : lower, upper, uint128(uint256(delta)), true
                );
            }
        }
        bytes32 beforeGame = gameDigest();
        // The vendored LP test router asserts the sign of an addition's net delta. Collect any
        // accrued fees first, so fees cannot exceed a small deposit and trip that fixture assertion.
        if (delta > 0) lp.modifyLiquidity(key, ModifyLiquidityParams(LOWER, UPPER, 0, bytes32(0)), "");
        lp.modifyLiquidity{value: ethValue}(key, ModifyLiquidityParams(LOWER, UPPER, delta, bytes32(0)), "");
        if (delta >= 0) liquidity += uint256(delta);
        else liquidity -= uint256(-delta);
        assertEq(gameDigest(), beforeGame, "liquidity change executed hook logic");
        liquidityChanges++;
    }

    // Excluded from random selectors: a terminal exit checks claim backing after ALL LP funds leave.
    function exitLiquidity() external {
        if (liquidity > 0) modify(-int256(liquidity));
    }
}

/// forge-config: default.invariant.runs = 256
/// forge-config: default.invariant.depth = 64
/// forge-config: default.invariant.fail-on-revert = true
contract KingHookLiquidityInvariantTest is KingBase {
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;

    KingLiquidityHandler internal handler;
    uint256 internal startingEth;

    function setUp() public override {
        super.setUp();
        handler = new KingLiquidityHandler(hook, token, IPoolManager(address(manager)), lpRouter, [alice, bob, carol]);
        token.transfer(address(handler), token.balanceOf(address(this)));
        vm.deal(address(handler), 1000 ether);
        startingEth = systemEth();
        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = handler.buy.selector;
        selectors[1] = handler.sell.selector;
        selectors[2] = handler.elapse.selector;
        selectors[3] = handler.transferKing.selector;
        selectors[4] = handler.dethroneIfShort.selector;
        selectors[5] = handler.claim.selector;
        selectors[6] = handler.changeLiquidity.selector;
        selectors[7] = handler.collectLpFees.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector(address(handler), selectors));
    }

    function systemEth() internal view returns (uint256) {
        return alice.balance + bob.balance + carol.balance + team.balance + address(handler).balance
            + address(manager).balance + address(hook).balance + address(router).balance + address(lpRouter).balance;
    }

    function invariant_valueAndSettlementAreConservedDuringLiquidityChanges() public view {
        uint256 pending =
            hook.pendingIncome(alice) + hook.pendingIncome(bob) + hook.pendingIncome(carol) + hook.pendingIncome(team);
        assertEq(hookClaims(), hook.pool() + hook.provisionalIncome() + pending);
        assertEq(handler.fees(), hookClaims() + handler.paid());
        assertGe(address(manager).balance, hookClaims());
        assertEq(systemEth(), startingEth);
        assertEq(token.totalSupply(), 1_000_000_000 ether);
        uint256 balances = token.balanceOf(alice) + token.balanceOf(bob) + token.balanceOf(carol)
            + token.balanceOf(address(handler)) + token.balanceOf(address(manager));
        assertEq(balances, token.totalSupply(), "KING created, lost or stranded");
        assertEq(address(router).balance + address(hook).balance + address(lpRouter).balance, 0);
        IPoolManager pm = IPoolManager(address(manager));
        assertFalse(pm.isUnlocked());
        assertEq(pm.getNonzeroDeltaCount(), 0);
        (uint128 actual,,) = pm.getPositionInfo(key.toId(), address(lpRouter), LP_LOWER, LP_UPPER, bytes32(0));
        assertEq(actual, handler.liquidity());
    }

    function afterInvariant() public {
        handler.exitLiquidity();
        assertGe(address(manager).balance, hookClaims(), "LP exit consumed hook collateral");
        // Accounts with a credit must still receive it after the LP has taken its principal/fees.
        for (uint256 i; i < 4; ++i) {
            handler.claim(i);
        }
        invariant_valueAndSettlementAreConservedDuringLiquidityChanges();
        assertLt(address(manager).balance - hookClaims(), 100_000, "unexplained ETH after LP exit");
        assertLt(token.balanceOf(address(manager)), 100_000, "unexplained KING after LP exit");
    }

    function test_liquidityActionsAndClaimsAreReachable() public {
        handler.buy(2, 1 ether);
        handler.elapse(1800);
        handler.buy(0, 0.1 ether);
        handler.elapse(301);
        handler.changeLiquidity(1e18, true);
        handler.changeLiquidity(1e18, false);
        handler.collectLpFees();
        handler.claim(0);
        handler.claim(3);
        handler.sell(0, 1 ether);
        assertEq(handler.successfulBuys(), 2);
        assertEq(handler.successfulSells(), 1);
        assertEq(handler.payouts(), 2);
        assertEq(handler.liquidityChanges(), 3);
        afterInvariant();
    }
}
