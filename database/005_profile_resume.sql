-- Migration 005: Add resume storage + profile fields to user_profile
--
-- Stores the user's base resume text directly in the profile row.
-- The Resume Tailor agent reads this instead of resume/resume.md on disk.
-- Also adds structured profile fields parsed from the resume.

ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS resume_text       TEXT,
  ADD COLUMN IF NOT EXISTS full_name         TEXT,
  ADD COLUMN IF NOT EXISTS email             TEXT,
  ADD COLUMN IF NOT EXISTS phone             TEXT,
  ADD COLUMN IF NOT EXISTS location          TEXT,
  ADD COLUMN IF NOT EXISTS linkedin_url      TEXT,
  ADD COLUMN IF NOT EXISTS website_url       TEXT,
  ADD COLUMN IF NOT EXISTS summary           TEXT,
  ADD COLUMN IF NOT EXISTS years_experience  INTEGER;
