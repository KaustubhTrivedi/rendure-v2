ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS model_job_scout        TEXT,
  ADD COLUMN IF NOT EXISTS model_resume_tailor    TEXT,
  ADD COLUMN IF NOT EXISTS model_quality_analyst  TEXT,
  ADD COLUMN IF NOT EXISTS model_confirmation     TEXT,
  ADD COLUMN IF NOT EXISTS model_orchestrator     TEXT;
