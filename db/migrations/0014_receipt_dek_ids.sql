-- 0014_receipt_dek_ids.sql
--
-- Receipt vendor + OCR text were encrypted via `encryptStringWithDek`
-- but the returned `dekId` was never persisted — the decrypt path
-- resolved `getActiveDek(purpose)` instead. Result: any future DEK
-- rotation (purpose-stable but key-id rotated) silently broke
-- decryption for older rows. The UI's `catch {}` swallowed the
-- AES-GCM tag mismatch and rendered "—" / blank, so the breakage
-- never surfaced loudly.
--
-- Pin each ciphertext column to the DEK row used at encrypt time so
-- rotation no longer corrupts existing data.

ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS parsed_vendor_dek_id uuid
    REFERENCES data_encryption_keys(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS ocr_text_dek_id uuid
    REFERENCES data_encryption_keys(id) ON DELETE RESTRICT;
