// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IReferencePriceAdapter} from "./interfaces/IReferencePriceAdapter.sol";

/// @notice The subset of a Chainlink-style aggregator this adapter reads.
/// @dev Declared here rather than imported so the dependency is one interface
///      with three members instead of a library. If HyperEVM's chosen feed has a
///      different shape (V-11), this file is what changes — which is the entire
///      reason the factory depends on `IReferencePriceAdapter` and not on this.
interface IAggregatorV3 {
    function decimals() external view returns (uint8);

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @title ReferencePriceAdapter
/// @notice The launch anchor, read from a feed rather than from the caller
///         (§135, §402).
///
/// WHAT §135 REQUIRES, AND WHERE EACH ONE IS
/// -----------------------------------------
///   production source verified   V-11, owner decision. `configure` is how it
///                                lands; until then no asset is priceable and
///                                no launch is possible.
///   decimals normalized          `_toWad`, from the feed's own `decimals()`.
///   stale detection              `maxAge` per asset, checked against the feed's
///                                `updatedAt`.
///   invalid-price behavior       every failure reverts by name.
///   launch snapshot reproducible the factory emits the price it used.
///   no custody                   nothing here holds or moves an asset.
///   no arbitrary manual override the load-bearing one. See below.
///
/// THERE IS NO SETTER FOR A PRICE
/// ------------------------------
/// This is the requirement the whole design turns on. Governance can point an
/// asset at a FEED and can stop pricing an asset entirely; it cannot write a
/// number. The difference matters because §18 forbids an admin injecting a
/// manual price to force a graduation, and a `setPrice` — however well guarded —
/// is that capability with a comment attached.
///
/// The nearest thing to an override is `configure`, which names a source. A
/// governance key that points an asset at a contract it controls has effectively
/// set the price, so the guard is not the code: it is that the source address is
/// public, immutable per configuration, and emitted. §280's configuration freeze
/// and the Safe that holds governance are what make that expensive, and neither
/// belongs in this file.
///
/// THE SANITY BAND IS A REFUSAL, NOT A CLAMP
/// -----------------------------------------
/// §135 asks for "extreme" behaviour to be tested. A feed returning $0.0000001
/// or $10,000,000 for an equity is not a price to be corrected — it is a broken
/// feed, and a market anchored to it is mis-priced for its entire life.
///
/// So the band rejects rather than clamps. Clamping would let a launch proceed
/// at a number the feed never said, which is the arbitrary manual price §135
/// forbids, arrived at from the other direction.
contract ReferencePriceAdapter is IReferencePriceAdapter {
    struct Source {
        /// @dev The feed. Zero means this asset is not priceable at all.
        address aggregator;
        /// @dev Seconds after which an answer is refused. Per asset, because a
        ///      thinly traded equity legitimately updates less often than an
        ///      index and one global bound would either be too tight for the
        ///      first or uselessly loose for the second.
        uint32 maxAge;
        /// @dev Inclusive sanity band, wad. Outside it the answer is refused.
        uint128 minUsdWad;
        uint128 maxUsdWad;
    }

    address public governance;

    mapping(address asset => Source) private _sources;

    event GovernanceTransferred(address indexed from, address indexed to);
    event SourceConfigured(
        address indexed asset,
        address indexed aggregator,
        uint32 maxAge,
        uint128 minUsdWad,
        uint128 maxUsdWad
    );
    event SourceRemoved(address indexed asset);

    error NotGovernance();
    error ZeroAddress();
    error NoSource(address asset);
    error StalePrice(address asset, uint256 updatedAt, uint256 maxAge);
    error NonPositivePrice(address asset, int256 answer);
    error PriceOutOfBand(address asset, uint256 usdWad, uint256 minUsdWad, uint256 maxUsdWad);
    error IncompleteRound(address asset);
    error InvalidBand();
    error InvalidMaxAge();
    error FeedUnreadable(address asset);

    modifier onlyGovernance() {
        if (msg.sender != governance) revert NotGovernance();
        _;
    }

    constructor(address governance_) {
        if (governance_ == address(0)) revert ZeroAddress();
        governance = governance_;
        emit GovernanceTransferred(address(0), governance_);
    }

    // -----------------------------------------------------------------------
    // Reads
    // -----------------------------------------------------------------------

    /// @inheritdoc IReferencePriceAdapter
    function usdPriceWad(address asset) external view returns (uint256) {
        (uint256 price,) = _read(asset);
        return price;
    }

    /// @inheritdoc IReferencePriceAdapter
    function peekUsdPriceWad(address asset)
        external
        view
        returns (bool ok, uint256 usdWad, uint256 updatedAt)
    {
        // `try` on an internal call is not available, so the checks are
        // re-expressed here as conditions. They are kept in one order with
        // `_read` deliberately: a preview that said "fine" where a launch
        // reverts is worse than no preview, because the creator pays gas to
        // learn otherwise.
        Source memory source = _sources[asset];
        if (source.aggregator == address(0)) return (false, 0, 0);

        (bool readable, uint256 price, uint256 at) = _tryRead(source, asset);
        if (!readable) return (false, 0, at);

        if (at == 0 || block.timestamp - at > source.maxAge) return (false, 0, at);
        if (price < source.minUsdWad || price > source.maxUsdWad) return (false, 0, at);

        return (true, price, at);
    }

    /// @notice The source configured for an asset, for verification off-chain.
    function sourceOf(address asset) external view returns (Source memory) {
        return _sources[asset];
    }

    // -----------------------------------------------------------------------
    // Governance — sources only, never prices
    // -----------------------------------------------------------------------

    /// @notice Point an asset at a feed, with its staleness bound and band.
    /// @dev The band is inclusive and must be a real interval. A zero `maxAge`
    ///      would refuse every answer produced before this block, which is every
    ///      answer — so it is rejected rather than silently disabling the asset.
    function configure(
        address asset,
        address aggregator,
        uint32 maxAge,
        uint128 minUsdWad,
        uint128 maxUsdWad
    ) external onlyGovernance {
        if (asset == address(0) || aggregator == address(0)) revert ZeroAddress();
        if (maxAge == 0) revert InvalidMaxAge();
        if (minUsdWad == 0 || maxUsdWad < minUsdWad) revert InvalidBand();

        _sources[asset] = Source({
            aggregator: aggregator,
            maxAge: maxAge,
            minUsdWad: minUsdWad,
            maxUsdWad: maxUsdWad
        });

        emit SourceConfigured(asset, aggregator, maxAge, minUsdWad, maxUsdWad);
    }

    /// @notice Stop pricing an asset. Every launch against it is blocked.
    /// @dev Does not touch markets that already launched. Their anchor was
    ///      snapshotted at launch and is immutable by §402 — removing a source
    ///      cannot and must not reprice an existing market.
    function removeSource(address asset) external onlyGovernance {
        delete _sources[asset];
        emit SourceRemoved(asset);
    }

    function transferGovernance(address to) external onlyGovernance {
        if (to == address(0)) revert ZeroAddress();
        emit GovernanceTransferred(governance, to);
        governance = to;
    }

    // -----------------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------------

    /// @dev The single enforcement point. Every failure is a named revert; there
    ///      is no path that returns a usable number for a price that failed a
    ///      check, because a caller that has to inspect a flag is one that will
    ///      eventually not.
    function _read(address asset) private view returns (uint256 usdWad, uint256 updatedAt) {
        Source memory source = _sources[asset];
        if (source.aggregator == address(0)) revert NoSource(asset);

        (bool readable, uint256 price, uint256 at) = _tryRead(source, asset);
        if (!readable) revert FeedUnreadable(asset);

        // A round that never completed reports zero here. Treating it as "very
        // old" would be the same refusal by accident; naming it separately is
        // what makes the difference visible in a trace.
        if (at == 0) revert IncompleteRound(asset);

        if (block.timestamp - at > source.maxAge) {
            revert StalePrice(asset, at, source.maxAge);
        }

        if (price < source.minUsdWad || price > source.maxUsdWad) {
            revert PriceOutOfBand(asset, price, source.minUsdWad, source.maxUsdWad);
        }

        return (price, at);
    }

    /// @dev Reads and normalises, reporting unreadability rather than reverting,
    ///      so `peek` and `_read` can share one implementation of the arithmetic.
    ///      A non-positive answer reverts here regardless: a negative price is
    ///      not a degraded reading, it is a feed that is not describing an
    ///      equity, and returning `false` would let a preview render it as
    ///      "temporarily unavailable".
    function _tryRead(Source memory source, address asset)
        private
        view
        returns (bool readable, uint256 usdWad, uint256 updatedAt)
    {
        try IAggregatorV3(source.aggregator).latestRoundData() returns (
            uint80, int256 answer, uint256, uint256 at, uint80
        ) {
            if (answer <= 0) revert NonPositivePrice(asset, answer);

            try IAggregatorV3(source.aggregator).decimals() returns (uint8 feedDecimals) {
                return (true, _toWad(uint256(answer), feedDecimals), at);
            } catch {
                return (false, 0, at);
            }
        } catch {
            return (false, 0, 0);
        }
    }

    /// @dev Feed units to wad. Chainlink USD feeds are usually 8 decimals, which
    ///      is a fact about one provider rather than a rule — so it is read from
    ///      the feed every time instead of assumed. Assuming eighteen here would
    ///      be the same defect that once scaled every price in the projection by
    ///      10^12.
    function _toWad(uint256 answer, uint8 feedDecimals) private pure returns (uint256) {
        if (feedDecimals == 18) return answer;
        if (feedDecimals < 18) return answer * (10 ** (18 - feedDecimals));
        return answer / (10 ** (feedDecimals - 18));
    }
}
