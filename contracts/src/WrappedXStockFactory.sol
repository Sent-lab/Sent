// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {WrappedXStock} from "./WrappedXStock.sol";

interface IERC20Named {
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
}

/**
 * @title WrappedXStockFactory
 * @notice One canonical wrapper per xStock, at an address anyone can derive.
 *
 * WHY A FACTORY AND NOT JUST DEPLOYING THEM
 * -----------------------------------------
 * Two wrappers around the same xStock are two tokens for one asset. They do not
 * trade against each other, so every pool, every market and every holder picks a
 * side, and the liquidity that was already thin gets halved. Nothing prevents a
 * second one from existing except there being an obvious first one.
 *
 * So this deploys with CREATE2 keyed on the underlying, refuses to deploy twice,
 * and exposes the address before it exists. "Which wrapper is the real one" has
 * an answer that does not depend on who you ask.
 *
 * NOBODY CHOOSES THE NAME
 * -----------------------
 * The name and symbol are read from the underlying and prefixed. A factory that
 * took them as arguments would let the first caller decide what a market's quote
 * asset is called, and a wrapper called "Wrapped Tesla xStock" around something
 * else is the cheapest possible attack on a user who reads before signing.
 *
 * NO KEYS, LIKE EVERYTHING ELSE ON THIS PATH
 * ------------------------------------------
 * No owner, no allowlist, no pause, no upgrade, no fee. `create` is
 * permissionless because a permissioned one is a party who can refuse to let an
 * asset exist — and the registry (§420) is already where the decision about
 * which assets are ACCEPTABLE lives. This decides nothing; it only makes the
 * wrapper for an asset unique and findable.
 */
contract WrappedXStockFactory {
    /// @notice underlying => its canonical wrapper. Zero until created.
    mapping(address underlying => address wrapper) public wrapperOf;

    address[] private _wrappers;

    error AlreadyCreated(address underlying, address wrapper);
    error ZeroAddress();

    event WrapperCreated(address indexed underlying, address indexed wrapper, string symbol);

    /**
     * @notice Deploy the canonical wrapper for `underlying`.
     *
     * @dev Reverts if one exists. The alternative — returning the existing
     *      address — reads as success and would let a caller believe it had just
     *      created something it did not, which matters when the next step is
     *      "and now list it".
     *
     *      The underlying is validated inside `WrappedXStock`'s constructor,
     *      which refuses anything that does not expose `sharesOf` and a non-zero
     *      `multiplier`. A plain ERC-20 does not need wrapping and cannot be
     *      wrapped here.
     */
    function create(address underlying) external returns (address wrapper) {
        if (underlying == address(0)) revert ZeroAddress();

        address existing = wrapperOf[underlying];
        if (existing != address(0)) revert AlreadyCreated(underlying, existing);

        string memory symbol_ = string.concat("w", IERC20Named(underlying).symbol());

        wrapper = address(
            new WrappedXStock{salt: bytes32(uint256(uint160(underlying)))}(
                underlying,
                string.concat("Wrapped ", IERC20Named(underlying).name()),
                symbol_
            )
        );

        wrapperOf[underlying] = wrapper;
        _wrappers.push(wrapper);

        emit WrapperCreated(underlying, wrapper, symbol_);
    }

    /**
     * @notice Where the wrapper for `underlying` will be, before it exists.
     *
     * @dev Deliberately derived rather than read from the mapping. A caller can
     *      verify an address off-chain, prepare a transaction against it, and
     *      check afterwards that the deployed code matches — none of which is
     *      possible if the address is only knowable after the fact.
     *
     *      The name and symbol feed the init code, so they are re-derived here
     *      exactly as `create` derives them. If that ever drifts, this returns
     *      an address `create` will not use, which is why one test asserts the
     *      two agree rather than trusting that they do.
     */
    function predict(address underlying) external view returns (address) {
        bytes memory initCode = abi.encodePacked(
            type(WrappedXStock).creationCode,
            abi.encode(
                underlying,
                string.concat("Wrapped ", IERC20Named(underlying).name()),
                string.concat("w", IERC20Named(underlying).symbol())
            )
        );

        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            bytes1(0xff),
                            address(this),
                            bytes32(uint256(uint160(underlying))),
                            keccak256(initCode)
                        )
                    )
                )
            )
        );
    }

    function wrapperCount() external view returns (uint256) {
        return _wrappers.length;
    }

    function wrapperAt(uint256 index) external view returns (address) {
        return _wrappers[index];
    }
}
