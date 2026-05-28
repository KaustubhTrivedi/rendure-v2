-- 006_llm_provider.sql
-- Add LLM provider selection to user_profile.

ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS llm_provider TEXT
    DEFAULT 'openrouter'
    CHECK (llm_provider IS NULL OR llm_provider IN ('openrouter', 'codex-oauth'));
