-- Migration 001: user_profile
--
-- Single-user profile table. Pluggable by design:
--   - No foreign keys from jobs or agent tables point here.
--   - Agents optionally read this at startup; nothing breaks if the row is absent.
--   - Single-row enforced by CHECK (id = 1). To go multi-user later: drop the
--     check constraint, add an auth identifier column, and update the read path.
--
-- Encryption:
--   openrouter_api_key_enc stores the API key encrypted with AES-256-GCM.
--   The nonce is prepended to the ciphertext and the whole thing is base64-encoded.
--   Encryption/decryption is handled in utils/crypto.py using PROFILE_ENCRYPTION_KEY.

CREATE TABLE user_profile (
    id                      INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),

    -- Identity
    display_name            TEXT,

    -- OpenRouter API key (AES-256-GCM encrypted, base64-encoded nonce+ciphertext)
    openrouter_api_key_enc  TEXT,

    -- Pipeline defaults (NULL = fall back to env var)
    qa_threshold            NUMERIC(4, 3),        -- overrides QA_PASS_THRESHOLD
    max_iterations          INTEGER,              -- overrides MAX_TAILORING_ITERATIONS
    preferred_model         TEXT,                 -- overrides OPENROUTER_MODEL

    -- Resume tailoring preferences
    target_seniority        TEXT CHECK (
                                target_seniority IS NULL OR
                                target_seniority IN ('junior','mid','senior','lead','staff','principal')
                            ),
    highlight_skills        JSONB,                -- ["Python", "Kubernetes", ...]
    preferred_industries    JSONB,                -- ["fintech", "healthtech", ...]
    tailor_style_notes      TEXT,                 -- free-text instructions to the Resume Tailor

    -- Notification endpoints (stored but not yet wired up)
    notify_email            TEXT,
    notify_webhook_url      TEXT,

    created_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Trigger to keep updated_at current
CREATE OR REPLACE FUNCTION user_profile_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_profile_updated_at
BEFORE UPDATE ON user_profile
FOR EACH ROW
EXECUTE FUNCTION user_profile_set_updated_at();
