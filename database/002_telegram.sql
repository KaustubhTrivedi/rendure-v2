-- Migration 002: notify_telegram_chat_id
--
-- Adds the column the backend uses to deliver pipeline-result notifications
-- to the user's Telegram chat. Phase 1 (PATCH /profile) writes it; Phase 4
-- (Telegram bot integration) reads it to know where to send messages.
--
-- The column is nullable. NULL means "Telegram notifications disabled."

ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS notify_telegram_chat_id TEXT;
