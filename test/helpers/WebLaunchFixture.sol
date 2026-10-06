// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {KingToken} from "../../src/KingToken.sol";
import {KingHook} from "../../src/KingHook.sol";
import {HookFlags} from "../../src/HookFlags.sol";

/// @notice Local web integration fixture only. Never the production launch factory.
/// This aggregate harness embeds multiple creation codes; Anvil lifts its harness size limit.
contract WebLaunchFixture {
    PoolManager public manager;
    KingToken public token;
    KingHook public hook;

    constructor() {
        manager = new PoolManager(address(this));
        token = new KingToken();
        bytes memory code = abi.encodePacked(type(KingHook).creationCode, abi.encode(manager, address(token)));
        (, bytes32 salt) = HookFlags.mine(address(this), HookFlags.KING_HOOK_FLAGS, code, 500_000);
        hook = new KingHook{salt: salt}(IPoolManager(address(manager)), address(token));
        PoolKey memory key =
            PoolKey(Currency.wrap(address(0)), Currency.wrap(address(token)), 12_500, 60, IHooks(address(hook)));
        manager.initialize(key, 792281625142643375935439503360000);
        PoolModifyLiquidityTest lp = new PoolModifyLiquidityTest(IPoolManager(address(manager)));
        uint128 liquidity = uint128(
            FullMath.mulDiv(
                900_000_000 ether, 1 << 96, TickMath.getSqrtPriceAtTick(184200) - TickMath.getSqrtPriceAtTick(-887220)
            )
        );
        token.approve(address(lp), 900_000_000 ether);
        lp.modifyLiquidity(key, ModifyLiquidityParams(-887220, 184200, int256(uint256(liquidity)), 0), "");
    }
}
