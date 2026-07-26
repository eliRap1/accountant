-- Migration 0017: Add sha256_hex column to audit_packages.
--
-- Stores the SHA-256 hex of the plaintext ZIP bytes (before encryption)
-- at the DB layer instead of inside the MANIFEST.json entry in the ZIP.
-- This eliminates the two-pass self-referential hash problem: the hash
-- is computed against the final ZIP, then persisted in this column.
-- Inspectors verify integrity as: sha256(decryptedZip) === sha256_hex.
--
-- The column is nullable to be backward-compatible with any rows inserted
-- before this migration (legacy rows simply have no recorded hash).

ALTER TABLE audit_packages ADD COLUMN sha256_hex text;
