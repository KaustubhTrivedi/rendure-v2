-- Migration 010: Application Submissions — ATS detection columns, submissions table, new status transitions

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'jobs' AND column_name = 'ats_type'
    ) THEN
        ALTER TABLE jobs ADD COLUMN ats_type TEXT;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'jobs' AND column_name = 'ats_board_token'
    ) THEN
        ALTER TABLE jobs ADD COLUMN ats_board_token TEXT;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'jobs' AND column_name = 'ats_posting_id'
    ) THEN
        ALTER TABLE jobs ADD COLUMN ats_posting_id TEXT;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'user_profile' AND column_name = 'github_url'
    ) THEN
        ALTER TABLE user_profile ADD COLUMN github_url TEXT;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'user_profile' AND column_name = 'portfolio_url'
    ) THEN
        ALTER TABLE user_profile ADD COLUMN portfolio_url TEXT;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'user_profile' AND column_name = 'salary_expectation'
    ) THEN
        ALTER TABLE user_profile ADD COLUMN salary_expectation TEXT;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS application_submissions (
    submission_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id             UUID NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
    version_id         UUID NOT NULL REFERENCES resume_versions(version_id) ON DELETE CASCADE,
    ats_type           TEXT NOT NULL,
    ats_application_id TEXT,
    status             TEXT NOT NULL CHECK (status IN ('submitted','failed','skipped')),
    error_detail       TEXT,
    submitted_at       TIMESTAMPTZ DEFAULT NOW(),
    metadata           JSONB
);

INSERT INTO allowed_transitions (from_status, to_status) VALUES
('approved', 'submitting'),
('submitting', 'submitted'),
('submitting', 'submission_failed')
ON CONFLICT (from_status, to_status) DO NOTHING;
