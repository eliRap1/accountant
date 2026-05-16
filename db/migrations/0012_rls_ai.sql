-- Layer-D RLS — AI tax-advisor conversations + messages.
--
-- Pattern (matches 0003 / 0005 / 0008):
--   * ai_conversations rows are owned by the user that created them.
--     SELECT/INSERT/UPDATE/DELETE are all gated on
--     `user_id = app_current_user_id()`. There is no engagement read
--     path — an engaged accountant does NOT see the business owner's
--     private chats with the tax advisor (Privacy Law / chinuch yashar).
--   * ai_messages rows inherit their access from the parent conversation
--     via EXISTS — same shape as journal_lines → journal_entries in
--     0005_rls_layer2.sql.
--
-- DEK / encryption:
--   * content_ciphertext + content_dek_id live ON the row; decrypting
--     them requires the DEK plaintext which the app layer derives via
--     `unwrapDek(dek_id)` (service-role read of data_encryption_keys).
--     app_user has no privilege on data_encryption_keys (0003 REVOKE),
--     so even if RLS were misconfigured here a leak of the row bytes
--     stays mathematically inert.
--   * The DEK retirement path (account-deletion / right-of-erasure)
--     does NOT need a policy on ai_messages — it runs as service role
--     and zeroes the wrapped_dek/iv/auth_tag columns on
--     data_encryption_keys, which crypto-shreds every ai_messages row
--     belonging to that user without altering the message rows.
--
-- Rollback:
--   BEGIN;
--   DROP POLICY IF EXISTS ai_messages_select ON ai_messages;
--   DROP POLICY IF EXISTS ai_messages_insert ON ai_messages;
--   DROP POLICY IF EXISTS ai_messages_update ON ai_messages;
--   DROP POLICY IF EXISTS ai_messages_delete ON ai_messages;
--   DROP POLICY IF EXISTS ai_conversations_select ON ai_conversations;
--   DROP POLICY IF EXISTS ai_conversations_insert ON ai_conversations;
--   DROP POLICY IF EXISTS ai_conversations_update ON ai_conversations;
--   DROP POLICY IF EXISTS ai_conversations_delete ON ai_conversations;
--   REVOKE SELECT, INSERT, UPDATE, DELETE ON ai_messages FROM app_user;
--   REVOKE SELECT, INSERT, UPDATE, DELETE ON ai_conversations FROM app_user;
--   ALTER TABLE ai_messages DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE ai_conversations DISABLE ROW LEVEL SECURITY;
--   COMMIT;

-- ============================================================================
-- ai_conversations — owner-only.
-- ============================================================================
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY ai_conversations_select ON ai_conversations
  FOR SELECT
  USING (user_id = app_current_user_id());--> statement-breakpoint
CREATE POLICY ai_conversations_insert ON ai_conversations
  FOR INSERT
  WITH CHECK (user_id = app_current_user_id());--> statement-breakpoint
CREATE POLICY ai_conversations_update ON ai_conversations
  FOR UPDATE
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());--> statement-breakpoint
CREATE POLICY ai_conversations_delete ON ai_conversations
  FOR DELETE
  USING (user_id = app_current_user_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_conversations TO app_user;--> statement-breakpoint

-- ============================================================================
-- ai_messages — gated through parent ai_conversations.user_id.
-- ============================================================================
ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY ai_messages_select ON ai_messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM ai_conversations
      WHERE ai_conversations.id = ai_messages.conversation_id
        AND ai_conversations.user_id = app_current_user_id()
    )
  );--> statement-breakpoint
CREATE POLICY ai_messages_insert ON ai_messages
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ai_conversations
      WHERE ai_conversations.id = ai_messages.conversation_id
        AND ai_conversations.user_id = app_current_user_id()
    )
  );--> statement-breakpoint
CREATE POLICY ai_messages_update ON ai_messages
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM ai_conversations
      WHERE ai_conversations.id = ai_messages.conversation_id
        AND ai_conversations.user_id = app_current_user_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ai_conversations
      WHERE ai_conversations.id = ai_messages.conversation_id
        AND ai_conversations.user_id = app_current_user_id()
    )
  );--> statement-breakpoint
CREATE POLICY ai_messages_delete ON ai_messages
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM ai_conversations
      WHERE ai_conversations.id = ai_messages.conversation_id
        AND ai_conversations.user_id = app_current_user_id()
    )
  );--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_messages TO app_user;
