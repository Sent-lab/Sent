// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/**
 * @title RebaseDetector
 * @notice Refuses quote assets whose balances move without a transfer.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT PARANOIA
 * -------------------------------------------
 * `LaunchMarket` treats collateral as a LIABILITY derived from curve maths, never
 * as a balance. `curveCollateral` says what the curve owes; the contract's actual
 * holding is expected to cover it. That separation is what makes the accounting
 * auditable, and it rests on one assumption nobody wrote down:
 *
 *     a balance only changes when someone transfers.
 *
 * xStocks break that assumption. Their own documentation is explicit — corporate
 * actions such as "dividends, stock splits, and reverse splits are reflected
 * through an onchain rebasing mechanism", so that "token balances always reflect
 * a 1:1 exposure of the underlying equity."
 *
 * Measured on HyperEVM, not taken from the docs: `SP500 xStock` (SPYx) at
 * 0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48 exposes `multiplier()` and
 * `sharesOf(address)`, and its multiplier already reads 1.0057145603 — it has
 * rebased at least once already. Its implementation is Backed Finance's
 * "Backed Token Implementation", so this is the real issuer's design and not one
 * venue's wrapper.
 *
 * THIS IS THE WHOLE ASSET CLASS, NOT ONE BAD TOKEN
 * ------------------------------------------------
 * All ten of the largest xStocks are deployed on this chain running byte-identical
 * code, and six have already moved off a 1.0 multiplier:
 *
 *     STRCx 1.0808929977   SPYx  1.0057145603   QQQx   1.0027250297
 *     GOOGLx 1.0023772501  NVDAx 1.0009180758   MUx    1.0004015986
 *
 * So this library is not a safety net catching one unsuitable asset. **It refuses
 * the entire intended quote-asset class, and it is why the allowlist is empty.**
 * That is correct for the accounting as it stands, and it should be uncomfortable
 * rather than reassuring.
 *
 * Changing chain does not help. Backed's developer documentation states that on
 * every EVM chain their tokens "implement the ERC-20 standard with rebasing
 * logic"; only Solana and TON keep raw balances constant, and neither runs this
 * codebase.
 *
 * THE FIX THIS IS HOLDING THE DOOR FOR
 * ------------------------------------
 * These tokens expose `sharesOf(address)`, and shares are the rebase-invariant
 * unit: `balanceOf = sharesOf × multiplier`. A market that booked collateral in
 * SHARES would be neutral to the multiplier in both directions — claims scale
 * together, dividends accrue to whoever holds the claim, and a reverse split
 * cannot make it insolvent.
 *
 * That is an accounting change rather than a workaround, and it is the shape any
 * real answer takes. Until it exists, refusing is the honest behaviour: the
 * alternative is a market that looks fine for months and then cannot pay.
 *
 * WHAT WOULD HAPPEN WITHOUT THIS CHECK
 * ------------------------------------
 * Every multiplier measured so far has drifted UPWARD, because dividends accrue
 * into it, and a rising multiplier leaves the market holding more than its books
 * owe. Surplus, not insolvency. The danger is the other direction.
 *
 * A reverse split lowers the multiplier. Every holder's balance shrinks, and so
 * does the market's — while `curveCollateral` does not move, because no transfer
 * occurred and no event fired. The market becomes **insolvent against its own
 * books**: sellers are owed more than it holds, and `sell` reverts for everyone
 * from that block onward.
 *
 * Nobody is at fault when it happens. There is no attack, no bug in the market,
 * and no moment where anything looks wrong beforehand. That is what makes it
 * worth a structural check rather than a warning.
 *
 * WHY THIS IS NOT A GATE GOVERNANCE TICKS
 * ---------------------------------------
 * §420's `multiplierBehaviour` gate already exists and is a boolean governance
 * attests to. This library does not replace it — it sits underneath it, because
 * an attestation is only as good as the person making it, and the failure here is
 * silent, delayed by however long it takes a company to declare a split, and
 * unrecoverable once markets are live against the asset.
 *
 * So the registry calls this and REVERTS regardless of what the gates say. A
 * ticked box cannot enable an asset this rejects.
 *
 * WHAT IT DOES NOT CLAIM
 * ----------------------
 * This detects the known shape. It cannot prove the negative: a token that
 * rebases through some interface nobody has seen will pass. The gate above it is
 * still where that judgement lives, and this is a floor beneath the gate rather
 * than a replacement for it. Saying otherwise would be the more dangerous error,
 * because it would make the human check feel redundant.
 */
library RebaseDetector {
    /// @dev `multiplier()` — Backed's rebase factor, 1e18-scaled.
    bytes4 internal constant MULTIPLIER = 0x1b3ed722;

    /// @dev `sharesOf(address)` — the underlying unit a rebasing balance derives
    ///      from. Present on Backed's implementation.
    bytes4 internal constant SHARES_OF = 0xf5eb42dc;

    /// @dev `getCurrentMultiplier()` — Backed's time-interpolated variant.
    bytes4 internal constant CURRENT_MULTIPLIER = 0x2b63c300;

    /// @dev Lido-style, included because it is the other widespread rebasing
    ///      shape and costs one staticcall to rule out.
    bytes4 internal constant GET_POOLED_BY_SHARES = 0x7a28fb88; // getPooledEthByShares(uint256)

    /// @notice True when `token` exposes a known rebasing interface.
    function isRebasing(address token) internal view returns (bool) {
        return _answers(token, abi.encodeWithSelector(MULTIPLIER))
            || _answers(token, abi.encodeWithSelector(CURRENT_MULTIPLIER))
            || _answers(token, abi.encodeWithSelector(SHARES_OF, address(this)))
            || _answers(token, abi.encodeWithSelector(GET_POOLED_BY_SHARES, uint256(1e18)));
    }

    /**
     * @notice True when `token` reports a rebase factor that is not exactly one.
     *
     * @dev Separate from `isRebasing` because they answer different questions.
     *      A token that HAS a multiplier is disqualified whatever it currently
     *      reads — a multiplier sitting at 1.0 today is a rebase that has not
     *      happened yet, which is the most dangerous version of this problem
     *      rather than the safest.
     *
     *      This exists so the refusal can say which it is. "Rebasing, and it has
     *      already moved" and "rebasing, currently at parity" are the same
     *      decision and a very different conversation with whoever proposed the
     *      asset.
     */
    function multiplierHasMoved(address token) internal view returns (bool moved, uint256 value) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSelector(MULTIPLIER));
        if (!ok || data.length < 32) return (false, 0);

        value = abi.decode(data, (uint256));
        moved = value != 1e18;
    }

    /**
     * @dev Did the call succeed and return something?
     *
     *      A plain ERC-20 has no such function, so the call hits the fallback.
     *      Most revert; some return empty. Both are "not present". A token whose
     *      fallback returns 32 bytes of anything would be a false positive — and
     *      that is the right direction to fail, because the outcome is a refusal
     *      to list an asset rather than a market that quietly cannot pay.
     */
    function _answers(address token, bytes memory payload) private view returns (bool) {
        (bool ok, bytes memory data) = token.staticcall(payload);
        return ok && data.length >= 32;
    }
}
