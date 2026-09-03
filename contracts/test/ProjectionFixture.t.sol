// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {LaunchMarket} from "../src/LaunchMarket.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {FeeVault} from "../src/FeeVault.sol";
import {HolderRewardVault} from "../src/HolderRewardVault.sol";
import {IGraduationRouter} from "../src/interfaces/IGraduationRouter.sol";
import {Curve} from "../src/lib/Curve.sol";

contract ProjQuote is ERC20 {
    uint8 private immutable D;

    constructor(uint8 d) ERC20("Mock NVDAx", "NVDAx") {
        D = d;
    }

    function decimals() public view override returns (uint8) {
        return D;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract ProjRouter is IGraduationRouter {
    function graduate(address t, address, uint256, uint256, uint256, uint256)
        external
        pure
        override
        returns (address, uint256)
    {
        return (address(uint160(uint256(keccak256(abi.encode(t, "pool"))))), 7);
    }

    function swapExactQuoteForToken(address, address, uint256, address) external pure override returns (uint256) {
        return 0;
    }
}

/// @notice Captures a real trading session's EVENTS and final on-chain state, so
///         the off-chain projection can be proven to reproduce it.
///
/// §138 says the database is a rebuildable projection of the chain. That is a
/// strong claim: replaying events must reproduce the contract's own state
/// exactly, not approximately.
///
/// This test trades against a real market, records the emitted logs, and writes
/// both the decoded events and the market's self-reported final state to a
/// fixture. `services/indexer/sim/projection.ts` replays those events through the
/// production reducer and asserts equality.
///
/// The events are read from `vm.getRecordedLogs` rather than assembled from
/// values this test already knows. That difference matters: if an event omits a
/// field or emits a wrong one, this catches it, whereas hand-assembled fixtures
/// would simply agree with themselves.
contract ProjectionFixtureTest is Test {
    ProjQuote quote;
    LaunchToken token;
    LaunchMarket market;
    FeeVault feeVault;
    HolderRewardVault rewardVault;

    address governance = makeAddr("governanceSafe");
    address treasury = makeAddr("treasurySafe");
    address creator = makeAddr("creator");

    address[] traders;

    /// @dev Serialized events, drained after each action so every entry carries
    ///      the block it was ACTUALLY emitted in. Reading block.number once at
    ///      the end would stamp them all with the final block, which silently
    ///      makes any ordering assertion vacuous.
    string[] captured;
    uint256 capturedCount;
    uint256 logCursor;

    bytes32 constant BOUGHT_SIG =
        keccak256("Bought(address,uint256,uint256,uint256,uint256,uint256,uint256,uint256)");
    bytes32 constant SOLD_SIG =
        keccak256("Sold(address,uint256,uint256,uint256,uint256,uint256,uint256,uint256)");
    bytes32 constant GRADUATED_SIG = keccak256("Graduated(address,address,uint256,uint256,uint256)");
    bytes32 constant PENDING_SIG = keccak256("GraduationPending(address,uint256,uint256,uint256)");

    function setUp() public {
        quote = new ProjQuote(6); // 6 decimals: where unit errors are visible

        feeVault = new FeeVault(governance, treasury, address(this));
        rewardVault = new HolderRewardVault(governance, address(this));

        uint256 xStockUsd = 137.42e18;
        uint256 quoteMc = (2_000e18 * 1e18) / xStockUsd;
        uint256 p0 = (quoteMc * 1e18) / Curve.TOTAL_SUPPLY;

        token = new LaunchToken("Sent Projection", "PROJ", creator);
        market = new LaunchMarket(
            address(token), address(quote), 6, creator, address(feeVault), address(rewardVault), p0
        );
        token.setMarket(address(market));
        token.transfer(address(market), token.GENESIS_SUPPLY());

        feeVault.registerMarket(address(market));
        rewardVault.registerMarket(address(market), address(quote));
        market.setRouter(address(new ProjRouter()));

        for (uint256 i = 0; i < 6; i++) {
            address t = address(uint160(uint256(keccak256(abi.encode("trader", i)))));
            traders.push(t);
            quote.mint(t, 100_000 * (10 ** 6));
            vm.prank(t);
            quote.approve(address(market), type(uint256).max);
            vm.prank(t);
            token.approve(address(market), type(uint256).max);
        }
    }

    /// @dev A mixed session — buys, sells, several traders — then graduation.
    function test_captureProjectionFixture() public {
        captured = new string[](256);
        vm.recordLogs();

        uint256 nonce = 1;

        // Warm-up: everybody buys something different.
        for (uint256 i = 0; i < traders.length; i++) {
            uint256 amount = ((i + 1) * 3 + 1) * (10 ** 6);
            vm.prank(traders[i]);
            market.buy(amount, 0, block.timestamp + 1);
            _drain();
            vm.roll(block.number + 1);
        }

        // Mixed flow, deliberately uneven.
        for (uint256 round = 0; round < 12; round++) {
            uint256 i = (round * 7 + nonce) % traders.length;
            address t = traders[i];

            if (round % 3 == 2) {
                uint256 held = token.balanceOf(t);
                if (held > 1e18) {
                    vm.prank(t);
                    market.sell(held / 3, 0, block.timestamp + 1);
                }
            } else {
                vm.prank(t);
                market.buy((round + 2) * (10 ** 6), 0, block.timestamp + 1);
            }

            nonce++;
            _drain();
            vm.roll(block.number + 1);
        }

        // Finish the curve so the fixture covers graduation too.
        (,,, uint256 qG) = market.curve();
        uint256 remaining = qG - market.distributed();
        if (remaining > 0) {
            (uint256 p0, uint256 pg, uint256 dP, uint256 qg2) = market.curve();
            Curve.Params memory p = Curve.Params({p0: p0, pg: pg, dP: dP, qG: qg2});
            uint256 netNeeded = Curve.quoteInFor(p, market.distributed(), remaining);
            uint256 grossNeeded = (netNeeded * 10_000) / 9_800 / (10 ** 12) + 2;

            quote.mint(traders[0], grossNeeded);
            vm.prank(traders[0]);
            market.buy(grossNeeded, 0, block.timestamp + 1);
            _drain();

            // Graduation is two transactions in two blocks (D-016), so the
            // fixture is too. Replaying a single-block graduation would prove
            // the reducer handles a sequence the chain can no longer produce.
            vm.roll(block.number + 1);

            // From a stranger, which is what permissionless means. If the
            // reducer ever came to depend on WHO finalised, this is where it
            // would show.
            vm.prank(address(0xF1A115E));
            market.finalizeGraduation();
            _drain();
        }

        _writeFixture();
    }

    /// @dev Serialize whatever the market emitted since the last drain, stamping
    ///      each event with the CURRENT block rather than the final one.
    function _drain() internal {
        Vm.Log[] memory logs = vm.getRecordedLogs();

        for (uint256 i = 0; i < logs.length; i++) {
            Vm.Log memory log = logs[i];
            if (log.emitter != address(market)) continue;
            if (log.topics.length == 0) continue;

            string memory obj = string.concat("event", vm.toString(logCursor));
            logCursor++;

            if (log.topics[0] == BOUGHT_SIG) {
                (
                    uint256 grossQuoteIn,
                    uint256 netToCurve,
                    uint256 tokensOut,
                    uint256 coreFee,
                    uint256 stockback,
                    uint256 newDistributed,
                    uint256 newCollateral
                ) = abi.decode(log.data, (uint256, uint256, uint256, uint256, uint256, uint256, uint256));

                vm.serializeString(obj, "type", "Bought");
                vm.serializeUint(obj, "blockNumber", block.number);
                vm.serializeUint(obj, "logIndex", logCursor);
                vm.serializeAddress(obj, "account", address(uint160(uint256(log.topics[1]))));
                vm.serializeUint(obj, "a", grossQuoteIn);
                vm.serializeUint(obj, "b", netToCurve);
                vm.serializeUint(obj, "c", tokensOut);
                vm.serializeUint(obj, "coreFee", coreFee);
                vm.serializeUint(obj, "stockback", stockback);
                vm.serializeUint(obj, "newDistributed", newDistributed);
                captured[capturedCount] = vm.serializeUint(obj, "newCollateral", newCollateral);
                capturedCount++;
            } else if (log.topics[0] == SOLD_SIG) {
                (
                    uint256 tokensIn,
                    uint256 grossQuoteOut,
                    uint256 netQuoteOut,
                    uint256 coreFee,
                    uint256 stockback,
                    uint256 newDistributed,
                    uint256 newCollateral
                ) = abi.decode(log.data, (uint256, uint256, uint256, uint256, uint256, uint256, uint256));

                vm.serializeString(obj, "type", "Sold");
                vm.serializeUint(obj, "blockNumber", block.number);
                vm.serializeUint(obj, "logIndex", logCursor);
                vm.serializeAddress(obj, "account", address(uint160(uint256(log.topics[1]))));
                vm.serializeUint(obj, "a", tokensIn);
                vm.serializeUint(obj, "b", grossQuoteOut);
                vm.serializeUint(obj, "c", netQuoteOut);
                vm.serializeUint(obj, "coreFee", coreFee);
                vm.serializeUint(obj, "stockback", stockback);
                vm.serializeUint(obj, "newDistributed", newDistributed);
                captured[capturedCount] = vm.serializeUint(obj, "newCollateral", newCollateral);
                capturedCount++;
            } else if (log.topics[0] == PENDING_SIG) {
                (uint256 tokenAmount, uint256 quoteAmount, uint256 pg) =
                    abi.decode(log.data, (uint256, uint256, uint256));

                vm.serializeString(obj, "type", "GraduationPending");
                vm.serializeUint(obj, "blockNumber", block.number);
                vm.serializeUint(obj, "logIndex", logCursor);
                vm.serializeAddress(obj, "account", address(uint160(uint256(log.topics[1]))));
                vm.serializeUint(obj, "a", tokenAmount);
                vm.serializeUint(obj, "b", quoteAmount);
                vm.serializeUint(obj, "c", pg);
                vm.serializeUint(obj, "coreFee", 0);
                vm.serializeUint(obj, "stockback", 0);
                vm.serializeUint(obj, "newDistributed", 0);
                captured[capturedCount] = vm.serializeUint(obj, "newCollateral", 0);
                capturedCount++;
            } else if (log.topics[0] == GRADUATED_SIG) {
                (uint256 positionId, uint256 tokenAmount, uint256 quoteAmount) =
                    abi.decode(log.data, (uint256, uint256, uint256));

                vm.serializeString(obj, "type", "Graduated");
                vm.serializeUint(obj, "blockNumber", block.number);
                vm.serializeUint(obj, "logIndex", logCursor);
                vm.serializeAddress(obj, "account", address(uint160(uint256(log.topics[2]))));
                vm.serializeUint(obj, "a", positionId);
                vm.serializeUint(obj, "b", tokenAmount);
                vm.serializeUint(obj, "c", quoteAmount);
                vm.serializeUint(obj, "coreFee", 0);
                vm.serializeUint(obj, "stockback", 0);
                vm.serializeUint(obj, "newDistributed", 0);
                captured[capturedCount] = vm.serializeUint(obj, "newCollateral", 0);
                capturedCount++;
            }
        }
    }

    function _writeFixture() internal {
        string memory root = "projection";

        string[] memory used = new string[](capturedCount);
        for (uint256 i = 0; i < capturedCount; i++) used[i] = captured[i];

        // What the market reports about itself. This is what the projection must
        // reproduce, and it is read from the contract rather than accumulated
        // here, so the two cannot agree by construction.
        string memory finalState = "finalState";
        vm.serializeUint(finalState, "status", uint256(market.status()));
        vm.serializeUint(finalState, "distributed", market.distributed());
        vm.serializeUint(finalState, "curveCollateral", market.curveCollateral());
        vm.serializeAddress(finalState, "pool", market.pool());
        string memory stateJson = vm.serializeUint(finalState, "positionId", market.positionId());

        vm.serializeString(root, "events", used);
        string memory out = vm.serializeString(root, "finalState", stateJson);

        vm.writeJson(out, "test/fixtures/projection.json");
    }
}
