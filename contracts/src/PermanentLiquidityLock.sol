// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {INonfungiblePositionManager} from "./interfaces/IUniswapV3.sol";

/// @title PermanentLiquidityLock
/// @notice The answer to V-09, and the reason it needed one (§17, §413, §414).
///
/// THE QUESTION V-09 ASKS
/// ----------------------
/// > can a V3 position have principal permanently non-withdrawable while fee
/// > collection rights remain exercisable for the creator?
///
/// Not with the position manager alone. Uniswap V3 — and HyperSwap, its fork —
/// offers exactly two states for an NFT holder, and neither is the one two
/// LOCKED rules require:
///
///   HOLD the NFT and you can call `decreaseLiquidity` whenever you like. The
///   principal is not locked; it is merely un-withdrawn, which is a promise
///   rather than a property.
///
///   BURN the NFT and `collect` dies with it. §11 and §413 give the creator
///   post-graduation fee rights forever, and burning ends them.
///
/// There is no third state, so the ledger's own escalation applies:
///
/// > If no venue primitive provides this, the lock must be a purpose-built
/// > non-withdrawable holder contract — an architecture decision with security
/// > consequences, to be escalated, not improvised.
///
/// This is that contract, and its security consequence is stated plainly: the
/// lock IS the guarantee. If it can be made to move the NFT or to reduce
/// liquidity, §17's permanent liquidity is a claim rather than a fact.
///
/// WHAT THIS CONTRACT CANNOT DO, BY CONSTRUCTION
/// ---------------------------------------------
/// There is no owner, no governance, no guardian, no pause, no upgrade path, no
/// initialiser, no `execute`, no `delegatecall`, no ERC-721 transfer, no
/// approval, and no call to `decreaseLiquidity` or `burn`. Not "gated" — absent.
/// A gate is a key somebody holds; an absence is not.
///
/// §413 says the fee-right asset "must not become an admin-transferable asset
/// that can be sold/stolen away from creator/platform/Stockback accounting", and
/// forbids "a generic `execute()` / arbitrary ERC721 transfer path". The whole
/// external surface here is one function.
///
/// WHY NOT INSIDE THE FEE VAULT, WHICH §413 SUGGESTS
/// -------------------------------------------------
/// §413 recommends FeeVault custody. This is a dedicated contract instead, for
/// one reason: FeeVault has governance — a treasury setter and a governance
/// transfer — and putting the NFT there would make §17's permanence depend on
/// a key. Custody with no keys at all is strictly stronger than custody behind
/// good ones, and the requirement §413 is protecting ("non-arbitrary custody, no
/// transfer path") is met more completely here than it could be there.
///
/// FEES GO TO THE MARKET, NOT TO A CALLER'S CHOICE
/// -----------------------------------------------
/// `collect` takes no recipient. It pays the market the position was minted for,
/// recorded when the NFT arrived and never writable afterwards.
///
/// A recipient argument would make this a "send the fees anywhere" function
/// wearing a harmless name, and it would be permissionless — the caller would
/// choose where a stranger's fees went. The market is where §399's split lives,
/// so the destination is not a parameter and cannot become one.
///
/// COLLECTION IS PERMISSIONLESS, AND MUST BE
/// -----------------------------------------
/// Anyone may call `collect`. It moves money only to a fixed address that has
/// already been decided, so there is nothing to gain by calling it — and §414
/// requires that accrued rights are never lost because collection is
/// unavailable. A permissioned collector is a party who can stop paying the
/// creator by doing nothing.
contract PermanentLiquidityLock {
    struct Locked {
        /// @dev Where this position's fees go. Written once, on receipt.
        address market;
        bool exists;
    }

    /// @notice The position manager this lock accepts NFTs from. Immutable.
    /// @dev Any other ERC-721 is rejected in `onERC721Received`. Accepting them
    ///      would leave assets in a contract with no way to move anything.
    INonfungiblePositionManager public immutable POSITION_MANAGER;

    /// @notice The router permitted to lock positions. Immutable.
    address public immutable ROUTER;

    mapping(uint256 tokenId => Locked) public lockedPositions;

    event PositionLocked(uint256 indexed tokenId, address indexed market);
    event FeesCollected(
        uint256 indexed tokenId, address indexed market, uint256 amount0, uint256 amount1
    );

    error ZeroAddress();
    error NotThePositionManager(address caller);
    error NotTheRouter(address operator);
    error AlreadyLocked(uint256 tokenId);
    error UnknownPosition(uint256 tokenId);
    error MarketMissing();

    constructor(address positionManager, address router) {
        if (positionManager == address(0) || router == address(0)) revert ZeroAddress();
        POSITION_MANAGER = INonfungiblePositionManager(positionManager);
        ROUTER = router;
    }

    /// @notice Accept a position, permanently.
    ///
    /// @dev ERC-721's receive hook is the only way in. The market this position
    ///      belongs to travels in `data` because it cannot be derived: a
    ///      position knows its two tokens, and two tokens do not identify which
    ///      market minted against them.
    ///
    ///      `operator` — not `from` — must be the router. `from` is the previous
    ///      owner, which for a freshly minted position is the position manager
    ///      itself; `operator` is who initiated the transfer. Checking the wrong
    ///      one would accept a position pushed here by anybody.
    function onERC721Received(address operator, address, uint256 tokenId, bytes calldata data)
        external
        returns (bytes4)
    {
        if (msg.sender != address(POSITION_MANAGER)) revert NotThePositionManager(msg.sender);
        if (operator != ROUTER) revert NotTheRouter(operator);
        if (lockedPositions[tokenId].exists) revert AlreadyLocked(tokenId);

        address market = abi.decode(data, (address));
        if (market == address(0)) revert MarketMissing();

        lockedPositions[tokenId] = Locked({market: market, exists: true});
        emit PositionLocked(tokenId, market);

        return this.onERC721Received.selector;
    }

    /// @notice Collect accrued fees to the position's market. Anyone may call.
    ///
    /// @dev `amount0Max`/`amount1Max` are `type(uint128).max`, which is V3's own
    ///      way of saying "everything owed". They are not a partial-collection
    ///      parameter here: a caller able to choose how much to collect could
    ///      leave a dust remainder behind on every call, and the accounting
    ///      downstream would be describing an amount somebody else picked.
    ///
    ///      Returns both amounts rather than reverting on zero. A collect with
    ///      nothing owed is the normal state of a quiet market, and reverting
    ///      would make an idle position indistinguishable from a broken one —
    ///      which is exactly the confusion §414 warns about when the external
    ///      venue pauses.
    function collect(uint256 tokenId) external returns (uint256 amount0, uint256 amount1) {
        Locked memory position = lockedPositions[tokenId];
        if (!position.exists) revert UnknownPosition(tokenId);

        (amount0, amount1) = POSITION_MANAGER.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: tokenId,
                recipient: position.market,
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        emit FeesCollected(tokenId, position.market, amount0, amount1);
    }

    /// @notice The market a locked position pays. For UIs and verification.
    function marketOf(uint256 tokenId) external view returns (address) {
        return lockedPositions[tokenId].market;
    }
}
