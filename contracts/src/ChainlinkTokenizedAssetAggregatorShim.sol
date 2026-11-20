// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @notice Chainlink Data Streams verifier proxy surface used by this adapter.
interface IChainlinkVerifierProxy {
    function verify(bytes calldata payload, bytes calldata parameterPayload)
        external
        payable
        returns (bytes memory verifierResponse);
}

/// @notice Optional asset binding consumed by ReferencePriceAdapter.
interface IAssetBoundPriceSource {
    function priceAsset() external view returns (address);
}

/// @title ChainlinkTokenizedAssetAggregatorShim
/// @notice Verifies a Chainlink Tokenized Asset (v10) report and exposes its
///         underlying-equity price through the Chainlink AggregatorV3 shape
///         consumed by SENT's existing ReferencePriceAdapter.
///
/// @dev This is a pull-report cache. Anyone with permitted access to a fresh
///      signed report may submit it; the immutable verifier authenticates it and
///      the shim pins it to the immutable feed ID. A report must be submitted
///      before a launch can use this source.
///      Reads fail closed for an unset, expired, closed or not-yet-valid report;
///      SENT's ReferencePriceAdapter adds the configured maximum-age and sanity
///      checks before a launch can use this source. The shim never accepts a
///      caller-supplied price.
///
///      The returned price is `price * currentMultiplier`, the theoretical
///      value for one share represented by SENT's non-rebasing wrapper. Both
///      fields are v10 18-decimal values for the configured xStocks stream.
///      A pending or activating corporate action refuses reads until a fresh
///      report confirms activation. This is deliberately stricter than using
///      `tokenizedPrice`, which is a secondary-market value and can be thin.
contract ChainlinkTokenizedAssetAggregatorShim {
    struct ReportV10 {
        bytes32 feedId;
        uint32 validFromTimestamp;
        uint32 observationsTimestamp;
        uint192 nativeFee;
        uint192 linkFee;
        uint32 expiresAt;
        uint64 lastUpdateTimestamp;
        int192 price;
        uint32 marketStatus;
        int192 currentMultiplier;
        int192 newMultiplier;
        uint32 activationDateTime;
        int192 tokenizedPrice;
    }

    struct CachedReport {
        uint32 validFromTimestamp;
        uint32 observationsTimestamp;
        uint32 expiresAt;
        uint64 lastUpdateTimestamp;
        int192 price;
        uint32 marketStatus;
        int192 currentMultiplier;
        int192 newMultiplier;
        uint32 activationDateTime;
    }

    uint16 private constant TOKENIZED_ASSET_SCHEMA = 10;
    uint32 private constant MARKET_OPEN = 2;
    uint256 private constant NANOS_PER_SECOND = 1e9;
    uint256 private constant MULTIPLIER_SCALE = 1e18;
    uint256 private constant MAX_INPUT_WAD = 1e30;
    uint64 private constant CORPORATE_ACTION_COOLDOWN = 15 minutes;

    address public immutable verifierProxy;
    bytes32 public immutable feedId;
    /// @notice Quote asset this feed is authorized to price, checked by the adapter.
    address public immutable priceAsset;
    /// @notice Price reads stay disabled until the initial report/multiplier pause ends.
    uint64 public pricePauseUntil;
    /// @notice A multiplier transition stays blocked until the underlying price
    ///         has a source update strictly after this timestamp.
    uint32 public priceUpdateMustBeAfter;
    CachedReport private _latest;

    event ReportUpdated(
        bytes32 indexed feedId,
        uint32 indexed observationsTimestamp,
        uint64 lastUpdateTimestamp,
        uint32 marketStatus,
        int192 price,
        int192 currentMultiplier
    );
    event PricePauseSet(uint64 indexed until, int192 currentMultiplier);

    error ZeroAddress();
    error ZeroAsset();
    error ZeroFeedId();
    error VerifierHasNoCode(address verifier);
    error InvalidPayload();
    error UnsupportedSchema(uint16 schema);
    error WrongFeed(bytes32 expected, bytes32 actual);
    error ReportNotYetValid(uint32 validFromTimestamp, uint256 nowTimestamp);
    error ReportExpired(uint32 expiresAt, uint256 nowTimestamp);
    error InvalidReportWindow(uint32 validFromTimestamp, uint32 observationsTimestamp, uint32 expiresAt);
    error FutureObservation(uint32 observationsTimestamp, uint256 nowTimestamp);
    error InvalidLastUpdate(uint64 lastUpdateTimestamp, uint256 nowTimestamp);
    error NonPositiveValue();
    error ValueOutOfRange();
    error MarketNotOpen(uint32 marketStatus);
    error CorporateActionPending(uint32 activationDateTime);
    error CorporateActionCooldown(uint64 until);
    error PriceNotUpdatedAfterCorporateAction(uint64 lastUpdateTimestamp, uint32 mustBeAfter);
    error MultiplierTransitionUnconfirmed(int192 currentMultiplier, int192 newMultiplier);
    error ReplayOrOutOfOrder(uint32 previousTimestamp, uint32 newTimestamp);
    error NoCachedReport();

    constructor(address priceAsset_, address verifierProxy_, bytes32 feedId_) {
        if (priceAsset_ == address(0)) revert ZeroAsset();
        if (verifierProxy_ == address(0)) revert ZeroAddress();
        if (feedId_ == bytes32(0)) revert ZeroFeedId();
        if (verifierProxy_.code.length == 0) revert VerifierHasNoCode(verifierProxy_);
        priceAsset = priceAsset_;
        verifierProxy = verifierProxy_;
        feedId = feedId_;
    }

    /// @notice Verify and cache the next valid report for the pinned stream.
    /// @dev Permissionless so an authorized operator or another permitted
    ///      report consumer can submit it without privileged source access. The
    ///      verifier authenticates the report; no caller-supplied price is used.
    function update(bytes calldata fullReport) external {
        if (fullReport.length < 96) revert InvalidPayload();

        (, bytes memory reportData) = abi.decode(fullReport, (bytes32[3], bytes));
        if (reportData.length < 2) revert InvalidPayload();
        uint16 schema = (uint16(uint8(reportData[0])) << 8) | uint16(uint8(reportData[1]));
        if (schema != TOKENIZED_ASSET_SCHEMA) revert UnsupportedSchema(schema);

        bytes memory verified = IChainlinkVerifierProxy(verifierProxy).verify(fullReport, bytes(""));
        ReportV10 memory report = abi.decode(verified, (ReportV10));
        if (report.feedId != feedId) revert WrongFeed(feedId, report.feedId);
        if (
            report.validFromTimestamp > report.observationsTimestamp
                || report.expiresAt <= report.observationsTimestamp
        ) {
            revert InvalidReportWindow(
                report.validFromTimestamp, report.observationsTimestamp, report.expiresAt
            );
        }

        uint256 nowTimestamp = block.timestamp;
        if (report.validFromTimestamp > nowTimestamp) {
            revert ReportNotYetValid(report.validFromTimestamp, nowTimestamp);
        }
        if (report.expiresAt <= nowTimestamp) revert ReportExpired(report.expiresAt, nowTimestamp);
        if (report.observationsTimestamp > nowTimestamp) {
            revert FutureObservation(report.observationsTimestamp, nowTimestamp);
        }

        uint256 lastUpdateAt = uint256(report.lastUpdateTimestamp) / NANOS_PER_SECOND;
        if (lastUpdateAt == 0 || lastUpdateAt > nowTimestamp) {
            revert InvalidLastUpdate(report.lastUpdateTimestamp, nowTimestamp);
        }
        if (report.observationsTimestamp <= _latest.observationsTimestamp) {
            revert ReplayOrOutOfOrder(_latest.observationsTimestamp, report.observationsTimestamp);
        }

        // xStocks recommends pausing around multiplier activations. A report
        // with a scheduled activation is refused by reads below; once the
        // multiplier changes (or at initialisation), keep reads closed for a
        // further 15 minutes. Starting the post-change window when the change
        // is first observed is conservative if the report arrives late.
        bool firstReport = _latest.observationsTimestamp == 0;
        bool multiplierChanged = !firstReport && report.currentMultiplier != _latest.currentMultiplier;
        if (firstReport || multiplierChanged) {
            uint256 pauseUntil = nowTimestamp + CORPORATE_ACTION_COOLDOWN;
            if (pauseUntil > type(uint64).max) revert ValueOutOfRange();
            pricePauseUntil = uint64(pauseUntil);
            emit PricePauseSet(pricePauseUntil, report.currentMultiplier);

            if (multiplierChanged) {
                // Chainlink's tokenized-asset guidance says not to resume after
                // activation until the underlying price itself has updated.
                // Prefer the announced activation time retained in the prior
                // report; if we first observe the transition after its notice
                // was missed, require a source update after this detection.
                uint32 activationAt = _latest.activationDateTime;
                priceUpdateMustBeAfter = activationAt != 0 && activationAt <= nowTimestamp
                    ? activationAt
                    : uint32(nowTimestamp);
            }
        }

        _latest = CachedReport({
            validFromTimestamp: report.validFromTimestamp,
            observationsTimestamp: report.observationsTimestamp,
            expiresAt: report.expiresAt,
            lastUpdateTimestamp: report.lastUpdateTimestamp,
            price: report.price,
            marketStatus: report.marketStatus,
            currentMultiplier: report.currentMultiplier,
            newMultiplier: report.newMultiplier,
            activationDateTime: report.activationDateTime
        });

        emit ReportUpdated(
            feedId,
            report.observationsTimestamp,
            report.lastUpdateTimestamp,
            report.marketStatus,
            report.price,
            report.currentMultiplier
        );
    }

    /// @notice AggregatorV3-compatible decimals for the issuer-listed SPYx/NVDAx v10 streams.
    function decimals() external pure returns (uint8) {
        return 18;
    }

    /// @notice Return the current USD value of one wrapped share as an 18-decimal answer.
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        CachedReport memory report = _readableReport();
        uint256 priceWad = uint256(uint192(report.price));
        uint256 multiplierWad = uint256(uint192(report.currentMultiplier));
        uint256 theoreticalPriceWad = (priceWad * multiplierWad) / MULTIPLIER_SCALE;
        if (theoreticalPriceWad == 0 || theoreticalPriceWad > uint256(type(int256).max)) {
            revert ValueOutOfRange();
        }
        uint256 updated = uint256(report.lastUpdateTimestamp) / NANOS_PER_SECOND;
        return (
            uint80(report.observationsTimestamp),
            int256(theoreticalPriceWad),
            updated,
            updated,
            uint80(report.observationsTimestamp)
        );
    }

    /// @notice Expose the full cached report for observability and indexers.
    function latestReport() external view returns (CachedReport memory) {
        return _latest;
    }

    function _readableReport() private view returns (CachedReport memory report) {
        report = _latest;
        if (report.observationsTimestamp == 0) revert NoCachedReport();
        uint256 nowTimestamp = block.timestamp;
        if (nowTimestamp < pricePauseUntil) {
            revert CorporateActionCooldown(pricePauseUntil);
        }
        if (report.validFromTimestamp > nowTimestamp) {
            revert ReportNotYetValid(report.validFromTimestamp, nowTimestamp);
        }
        if (report.expiresAt <= nowTimestamp) revert ReportExpired(report.expiresAt, nowTimestamp);
        uint256 updated = uint256(report.lastUpdateTimestamp) / NANOS_PER_SECOND;
        if (updated == 0 || updated > nowTimestamp) {
            revert InvalidLastUpdate(report.lastUpdateTimestamp, nowTimestamp);
        }
        if (priceUpdateMustBeAfter != 0 && updated <= priceUpdateMustBeAfter) {
            revert PriceNotUpdatedAfterCorporateAction(report.lastUpdateTimestamp, priceUpdateMustBeAfter);
        }
        if (report.marketStatus != MARKET_OPEN) revert MarketNotOpen(report.marketStatus);
        if (report.price <= 0 || report.currentMultiplier <= 0) revert NonPositiveValue();
        if (uint256(uint192(report.price)) > MAX_INPUT_WAD
            || uint256(uint192(report.currentMultiplier)) > MAX_INPUT_WAD) {
            revert ValueOutOfRange();
        }
        // v10 announces the next corporate action before it activates. Refuse
        // every report carrying that announcement, not only reports fetched
        // after the timestamp; otherwise a launch could anchor during the
        // transition window. The next clean report must have no scheduled
        // activation and a settled multiplier.
        if (report.activationDateTime != 0) {
            revert CorporateActionPending(report.activationDateTime);
        }
        if (report.activationDateTime == 0 && report.newMultiplier != 0
            && report.newMultiplier != report.currentMultiplier) {
            revert MultiplierTransitionUnconfirmed(report.currentMultiplier, report.newMultiplier);
        }
        return report;
    }
}
