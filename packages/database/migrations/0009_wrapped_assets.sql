-- SENT — migration 0009: a listed quote asset may wrap another (D-017)
--
-- Markets are quoted in a non-rebasing wrapper rather than in the xStock
-- itself, because a Uniswap V3 position cannot hold a rebasing token and
-- graduation locks one forever. The consequence for this projection is small
-- and important: the asset a market names is one step removed from the equity
-- a user actually recognises.
--
-- Without this column a UI can only say "quoted in wTSLAx", which asks the user
-- to take a symbol on trust. With it, the API can say "quoted in wTSLAx, which
-- wraps Tesla xStock at 0x8aD3…" — and the registry's own on-chain record is
-- where that claim comes from, not from a hardcoded table.

ALTER TABLE xstock_assets
    ADD COLUMN IF NOT EXISTS wrapped_underlying BYTEA;

COMMENT ON COLUMN xstock_assets.wrapped_underlying IS
    'The rebasing xStock this asset wraps, or NULL when it wraps nothing. '
    'Mirrors XStockRegistry.underlyingOf (D-017). Set only through the '
    'registerWrappedAsset path, which verifies provenance against the wrapper '
    'factory rather than trusting what the wrapper says about itself.';

-- Wrapped assets are the interesting subset for an operator: they are the ones
-- whose canonicalRepresentation attestation is about a DIFFERENT address than
-- the one listed. Small set, so a partial index keeps the lookup proportional.
CREATE INDEX IF NOT EXISTS xstock_assets_wrapped_idx
    ON xstock_assets (wrapped_underlying)
    WHERE wrapped_underlying IS NOT NULL;
