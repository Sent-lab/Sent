#!/usr/bin/env python3
"""
Opt an address into HyperEVM's large block lane.

WHY THIS EXISTS
---------------
HyperEVM produces two block lanes. The default one is 1 second and caps at
3,000,000 gas; the large one is 1 minute and caps at 30,000,000. Which lane an
address's transactions go to is a flag on its HyperCore account, not something a
transaction can request.

Two things this repository needs do not fit in the default lane:

    LaunchpadFactory deployment    7,360,896 gas   (measured, script/GasProbe)
    a market graduation            5,388,986 gas   (measured, V-20, on a fork)

Without the flag, those transactions are not rejected — they are never included.
No revert, no error, just a hash that stays pending. That is the single worst
symptom to meet halfway through a mainnet deployment, which is why this is a
prerequisite step rather than a troubleshooting note.

WHAT IT DOES
------------
Sends exactly one HyperCore action:

    {"type": "evmUserModify", "usingBigBlocks": true}

through the official `hyperliquid-python-sdk`. Nothing else. It does not deploy,
transfer, trade, or approve.

YOUR KEY NEVER LEAVES YOUR MACHINE
----------------------------------
The key is read from the environment, used locally to sign one action, and never
printed, logged or transmitted anywhere except to Hyperliquid's own API as a
signature. Read this file before running it — that is the point of it being a
short script in your own repository rather than a website you paste a key into.

PREREQUISITE
------------
The address must already be a HyperCore user. Hyperliquid's docs put it plainly:
"this requires an existing Core user to send. Like any EOA, the deployer address
can be converted to a Core user by receiving a Core asset such as USDC."

An address that has only ever held HYPE on the EVM side is NOT a Core user yet.
This script checks and tells you before it tries.

USAGE
-----
    pip install hyperliquid-python-sdk

    # check only — no signing, no key needed
    python infra/deployment/big-blocks.py --check 0xYourAddress

    # opt in. --for is the address you EXPECT the key to belong to; the
    # script refuses if it does not, so a mispasted key stops here.
    export HL_PRIVATE_KEY=0x...
    python infra/deployment/big-blocks.py --enable --for 0xYourDeployer

The key may be given with or without the `0x` prefix. MetaMask exports it
without one, which is not a sign anything is wrong.

    # opt back out, once the large transactions are done
    python infra/deployment/big-blocks.py --disable

Opting back out afterwards is worth doing. Large-lane blocks are produced once a
minute, so every ordinary transaction from that address waits up to a minute for
no reason once the deployment is over.
"""

import argparse
import json
import os
import sys
import urllib.request

API = "https://api.hyperliquid.xyz"


def info(payload: dict) -> dict:
    """Query Hyperliquid's public info endpoint. No key, no signing."""
    request = urllib.request.Request(
        f"{API}/info",
        data=json.dumps(payload).encode(),
        headers={"content-type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def is_core_user(address: str) -> bool:
    """
    Has this address ever held anything on HyperCore?

    Checked because the alternative is a signed action rejected by the API with
    a message about the user not existing, which reads like a broken script
    rather than a missing prerequisite.
    """
    try:
        spot = info({"type": "spotClearinghouseState", "user": address})
        perp = info({"type": "clearinghouseState", "user": address})
    except Exception as error:  # noqa: BLE001 - the reason matters more than the type
        print(f"could not reach the Hyperliquid API: {error}", file=sys.stderr)
        return False

    has_spot = bool(spot.get("balances"))
    has_perp = float(perp.get("marginSummary", {}).get("accountValue", "0") or 0) > 0

    return has_spot or has_perp


def check(address: str) -> int:
    print(f"address        {address}")

    if is_core_user(address):
        print("core user      YES")
        print()
        print("Ready to opt in. Run with --enable.")
        return 0

    print("core user      NO  <-- this is the blocker")
    print()
    print("This address has never held a HyperCore asset, so it cannot send a")
    print("Core action yet. Send it a small amount of a Core asset first - USDC")
    print("on HyperCore, not on the EVM side. Any amount converts it.")
    print()
    print("HYPE held on the EVM side does not count. They are different ledgers.")
    return 1


def set_flag(enable: bool, expected: str) -> int:
    key = os.environ.get("HL_PRIVATE_KEY", "").strip()

    if not key:
        print("HL_PRIVATE_KEY is not set.", file=sys.stderr)
        print("", file=sys.stderr)
        print("Set it in your shell, not in a file, and unset it afterwards:", file=sys.stderr)
        print("    export HL_PRIVATE_KEY=0x...", file=sys.stderr)
        return 2

    try:
        import eth_account
        from hyperliquid.exchange import Exchange
        from hyperliquid.utils import constants
    except ImportError:
        print("The Hyperliquid SDK is not installed.", file=sys.stderr)
        print("    pip install hyperliquid-python-sdk", file=sys.stderr)
        return 2

    """
    Accepts the key with or without `0x`. MetaMask exports it without, and a
    script that rejected that would send the reader looking for a fault in
    their wallet rather than in the instructions.
    """
    bare = key[2:] if key.lower().startswith("0x") else key

    if len(bare) != 64 or any(c not in "0123456789abcdefABCDEF" for c in bare):
        print("HL_PRIVATE_KEY does not look like a private key.", file=sys.stderr)
        print("Expected 64 hex characters, with or without a 0x prefix.", file=sys.stderr)
        print(f"Got {len(bare)} characters. The value itself is not shown.", file=sys.stderr)
        return 2

    account = eth_account.Account.from_key("0x" + bare)
    address = account.address

    # Flushed, because the next thing written may go to stderr. Unflushed
    # stdout arrives after it, and an error message that reads out of order is
    # read by someone who is already worried.
    print(f"address        {address}", flush=True)

    """
    The key is checked against the address it is supposed to be.

    Without this, pasting the governance key instead of the deployer key
    succeeds silently and puts the WRONG account on the slow lane — a mistake
    that is invisible until a transaction from the right account fails to mine,
    which is exactly the symptom this whole script exists to prevent.
    """
    if address.lower() != expected.lower():
        print(file=sys.stderr)
        print("This key does not belong to the address you named.", file=sys.stderr)
        print(f"  --for      {expected}", file=sys.stderr)
        print(f"  the key is {address}", file=sys.stderr)
        print(file=sys.stderr)
        print("Nothing was sent. Check which account you copied from.", file=sys.stderr)
        return 2

    if not is_core_user(address):
        print()
        return check(address)

    exchange = Exchange(account, constants.MAINNET_API_URL)

    print(f"action         evmUserModify usingBigBlocks={enable}")
    result = exchange.use_big_blocks(enable)
    print(f"result         {json.dumps(result)}")

    ok = isinstance(result, dict) and result.get("status") == "ok"

    print()
    if ok and enable:
        print("Opted IN to the large block lane.")
        print("Transactions from this address now target 30M-gas blocks, produced")
        print("about once a minute. Deploy now, then run --disable when finished.")
    elif ok:
        print("Opted OUT. Transactions go back to the 1-second, 3M-gas lane.")
    else:
        print("The action did not report success. Read the result above before retrying.")

    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--check", metavar="ADDRESS", help="report readiness, sign nothing")
    group.add_argument("--enable", action="store_true", help="opt into the large lane")
    group.add_argument("--disable", action="store_true", help="opt back out")
    parser.add_argument(
        "--for",
        dest="expected",
        metavar="ADDRESS",
        help="the address the key must belong to; refuses on a mismatch",
    )

    args = parser.parse_args()

    if args.check:
        return check(args.check)

    if not args.expected:
        print("--for is required with --enable/--disable.", file=sys.stderr)
        print("Name the address you expect the key to belong to, so a", file=sys.stderr)
        print("mispasted key is refused instead of switching the wrong account.", file=sys.stderr)
        return 2

    return set_flag(args.enable, args.expected)


if __name__ == "__main__":
    raise SystemExit(main())
