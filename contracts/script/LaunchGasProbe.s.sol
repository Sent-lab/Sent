// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {LaunchpadFactory} from "../src/LaunchpadFactory.sol";
import {XStockRegistry} from "../src/XStockRegistry.sol";
import {ReferencePriceAdapter} from "../src/ReferencePriceAdapter.sol";
import {Metadata} from "../src/lib/Metadata.sol";
import {IGraduationRouter} from "../src/interfaces/IGraduationRouter.sol";

/**
 * @notice What one launch COSTS — the creator's gas, against the block lane.
 *
 *     forge script script/LaunchGasProbe.s.sol:LaunchGasProbe
 *
 * WHY THIS NEEDED MEASURING SEPARATELY
 * ------------------------------------
 * `launch()` deploys two contracts inside one transaction: a `LaunchToken`
 * (2,231 bytes of runtime) and a `LaunchMarket` (9,516 bytes). Code deposit
 * alone is 200 gas per byte, so those two are ~2.35M gas before the factory
 * does any work of its own.
 *
 * HyperEVM's default lane caps at 3,000,000 (V-20). That is close enough that
 * guessing was not good enough: if a launch does not fit, then **every creator**
 * needs the large-lane opt-in, which is a Hyperliquid L1 action most of them
 * will never have heard of. That would be a product problem, not an ops one.
 *
 * It also answers the question that decides `LAUNCH_FEE`: what does a launch
 * cost the person doing it, before the platform charges anything at all.
 *
 * A SCRIPT, NOT A TEST
 * --------------------
 * Same reason as `GasProbe.s.sol`. `forge test` does not meter the code-deposit
 * cost, so the same measurement taken there comes back three orders of
 * magnitude too small and looks fine.
 */
contract LaunchGasProbe is Script {
    uint256 constant DEFAULT_LANE = 3_000_000;
    uint256 constant XSTOCK_USD = 500e18;

    function run() external {
        address governance = address(0xA11CE);
        address treasury = address(0xB0B);
        address creator = address(0xC0FFEE);

        ProbeQuote quote = new ProbeQuote();
        ProbeRouter router = new ProbeRouter();
        ProbeFeed feed = new ProbeFeed(int256(XSTOCK_USD / 1e10), 8);

        XStockRegistry registry = new XStockRegistry(governance, address(0));
        LaunchpadFactory factory = new LaunchpadFactory(governance, treasury, address(registry), 0);
        ReferencePriceAdapter adapter = new ReferencePriceAdapter(governance);

        vm.startPrank(governance);
        factory.setRouter(address(router));
        adapter.configure(address(quote), address(feed), 1 hours, 1e18, 100_000e18);
        factory.setReferencePrice(address(adapter));
        registry.registerAsset(address(quote), 18, 1385, 0);
        registry.setGates(
            address(quote),
            XStockRegistry.Gates({
                canonicalRepresentation: true,
                transferBehaviour: true,
                multiplierBehaviour: true,
                priceSource: true,
                haltSource: true,
                hyperSwapCompatible: true,
                normalizedAccountingTested: true,
                legalReviewed: true
            })
        );
        registry.enableAsset(address(quote));
        vm.stopPrank();

        Metadata.Link[] memory links = new Metadata.Link[](2);
        links[0] = Metadata.Link({label: "website", url: "https://example.com"});
        links[1] = Metadata.Link({label: "x", url: "https://x.com/example"});

        Metadata.Content memory content = Metadata.Content({
            description: "A launch, measured for what it costs the person making it.",
            imageCid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
            links: links
        });

        LaunchpadFactory.LaunchParams memory p = LaunchpadFactory.LaunchParams({
            name: "Gas Probe",
            symbol: "PROBE",
            quoteAsset: address(quote),
            userSalt: bytes32(uint256(1)),
            launchIntentHash: keccak256(abi.encode(content)),
            xStockUsdWad: XSTOCK_USD,
            expectedToken: address(0),
            metadata: content
        });

        vm.prank(creator);
        uint256 g = gasleft();
        factory.launch(p);
        uint256 used = g - gasleft();

        // The same launch with nothing optional attached, to separate the
        // floor from what metadata adds. If even the floor is over, the
        // problem is the contracts; if only the rich case is, it is a limit
        // to document.
        Metadata.Content memory bare = Metadata.Content({
            description: "",
            imageCid: "",
            links: new Metadata.Link[](0)
        });
        LaunchpadFactory.LaunchParams memory q = p;
        q.userSalt = bytes32(uint256(2));
        q.metadata = bare;
        q.launchIntentHash = keccak256(abi.encode(bare));

        vm.prank(creator);
        g = gasleft();
        factory.launch(q);
        uint256 bareUsed = g - gasleft();

        // Runtime cost, measured on the market that was just launched.
        //
        // The launch fits under the ceiling only if the optimizer emits smaller
        // code, and smaller code is slower code. Trades happen far more often
        // than launches, so a setting that fixes launch by taxing every buy and
        // sell forever is a bad trade unless the runtime cost barely moves.
        address mkt;
        {
            // The launch returns both, but this probe threw the first one away.
            // Re-run a third launch and keep them.
            LaunchpadFactory.LaunchParams memory z = q;
            z.userSalt = bytes32(uint256(3));
            vm.prank(creator);
            (, mkt) = factory.launch(z);
        }

        quote.mint(creator, 1_000e18);
        vm.startPrank(creator);
        quote.approve(mkt, type(uint256).max);

        g = gasleft();
        IMarket(mkt).buy(10e18, 0, block.timestamp + 1);
        uint256 gBuy = g - gasleft();

        g = gasleft();
        IMarket(mkt).buy(10e18, 0, block.timestamp + 1);
        uint256 gBuy2 = g - gasleft();
        vm.stopPrank();

        // The largest metadata the contract will accept, so the headroom is
        // measured against the worst case a creator can actually submit rather
        // than against a convenient example.
        {
            Metadata.Link[] memory maxLinks = new Metadata.Link[](4);
            for (uint256 i = 0; i < 4; i++) {
                maxLinks[i] = Metadata.Link({
                    label: "123456789012345678901234",
                    // Exactly MAX_LINK_URL (200): 8 + 50*3 + 42
                    url: string.concat(
                        "https://",
                        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.com"
                    )
                });
            }
            string memory bigDesc;
            for (uint256 i = 0; i < 16; i++) {
                bigDesc = string.concat(bigDesc, "01234567890123456789012345678901");
            }
            Metadata.Content memory big = Metadata.Content({
                description: bigDesc,
                imageCid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
                links: maxLinks
            });
            LaunchpadFactory.LaunchParams memory m = q;
            m.userSalt = bytes32(uint256(4));
            m.metadata = big;
            m.launchIntentHash = keccak256(abi.encode(big));

            vm.prank(creator);
            uint256 gm = gasleft();
            factory.launch(m);
            uint256 maxUsed = gm - gasleft();
            console2.log("launch() MAX metadata  ", maxUsed);

            /*
             * The check, not a note.
             *
             * If the largest launch a creator can submit stops fitting the
             * default lane, then every creator needs a Hyperliquid L1 opt-in
             * before they can use the product at all. That is not a gas
             * regression to note in a changelog - it is the launchpad becoming
             * unusable for its own users.
             *
             * So this reverts. Whoever made the contracts bigger finds out here.
             */
            require(maxUsed < DEFAULT_LANE, "launch() no longer fits the default block lane");
            console2.log("headroom at MAX        ", DEFAULT_LANE - maxUsed);
        }

        console2.log("buy() first            ", gBuy);
        console2.log("buy() warm             ", gBuy2);
        console2.log("launch() minimal meta  ", bareUsed);
        console2.log("launch() with metadata ", used);
        console2.log("metadata costs         ", used - bareUsed);
        console2.log("default lane ceiling   ", DEFAULT_LANE);

        if (used > DEFAULT_LANE) {
            console2.log("  OVER THE CEILING - every creator would need the large lane");
        } else {
            console2.log("  fits - creators need no opt-in");
            console2.log("headroom               ", DEFAULT_LANE - used);
        }
    }
}

interface IMarket {
    function buy(uint256 grossQuoteIn, uint256 minTokensOut, uint256 deadline)
        external
        returns (uint256);
}

contract ProbeQuote is ERC20 {
    constructor() ERC20("Probe xStock", "PROBEx") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract ProbeFeed {
    int256 private immutable ANSWER;
    uint8 private immutable DECIMALS;

    constructor(int256 answer, uint8 decimals_) {
        ANSWER = answer;
        DECIMALS = decimals_;
    }

    function decimals() external view returns (uint8) {
        return DECIMALS;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, ANSWER, block.timestamp, block.timestamp, 1);
    }
}

contract ProbeRouter is IGraduationRouter {
    function graduate(address t, address, uint256, uint256, uint256, uint256)
        external
        pure
        override
        returns (address, uint256)
    {
        return (address(uint160(uint256(keccak256(abi.encode(t, "pool"))))), 1);
    }

    function swapExactQuoteForToken(address, address, uint256, address)
        external
        pure
        override
        returns (uint256)
    {
        return 0;
    }
}
