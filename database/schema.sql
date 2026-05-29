CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- allowed_transitions table
CREATE TABLE IF NOT EXISTS allowed_transitions (
    from_status TEXT NOT NULL,
    to_status TEXT NOT NULL,
    PRIMARY KEY (from_status, to_status)
);

-- populate allowed_transitions (based on specs)
INSERT INTO allowed_transitions (from_status, to_status) VALUES
('new', 'found'),
('found', 'tailoring'),
('found', 'error'),
('tailoring', 'qa_review'),
('tailoring', 'error'),
('qa_review', 'approved'),
('qa_review', 'qa_failed'),
('qa_review', 'low_match'),
('qa_review', 'error'),
('qa_failed', 'tailoring'),
('qa_failed', 'low_match'),
('qa_failed', 'error')
ON CONFLICT (from_status, to_status) DO NOTHING;

-- base_resume table
CREATE TABLE IF NOT EXISTS base_resume (
    id SERIAL PRIMARY KEY,
    git_commit TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Init base resume (idempotent — only inserts if the table is empty)
INSERT INTO base_resume (git_commit)
SELECT 'main'
WHERE NOT EXISTS (SELECT 1 FROM base_resume);

-- jobs table
CREATE TABLE IF NOT EXISTS jobs (
    job_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_url TEXT,
    company_name TEXT,
    role_title TEXT,
    jd_text TEXT,
    seniority_level TEXT,
    location TEXT,
    required_skills JSONB,
    nice_to_haves JSONB,
    base_resume_ref TEXT,
    status TEXT DEFAULT 'new',
    iteration_count INTEGER DEFAULT 0,
    qa_score NUMERIC(4, 3),
    active_resume_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Partial unique index: only deduplicate non-empty URLs (JD-text jobs have empty/null URL)
CREATE UNIQUE INDEX IF NOT EXISTS jobs_url_unique ON jobs (job_url)
    WHERE job_url IS NOT NULL AND job_url != '';

-- job_skills table
CREATE TABLE IF NOT EXISTS job_skills (
    job_id UUID REFERENCES jobs(job_id) ON DELETE CASCADE,
    skill TEXT NOT NULL,
    required BOOLEAN NOT NULL,
    PRIMARY KEY (job_id, skill)
);

-- resume_versions table
-- git_branch and git_commit are nullable: resumes are now stored in DB directly.
CREATE TABLE IF NOT EXISTS resume_versions (
    version_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES jobs(job_id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    git_branch TEXT,
    git_commit TEXT,
    latex_source TEXT NOT NULL,
    tailoring_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add foreign key constraint for active_resume_id on jobs table
-- Idempotent FK add: PG doesn't support IF NOT EXISTS on ADD CONSTRAINT, so guard via catalog lookup.
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_active_resume'
    ) THEN
        ALTER TABLE jobs ADD CONSTRAINT fk_active_resume
            FOREIGN KEY (active_resume_id) REFERENCES resume_versions(version_id) ON DELETE SET NULL;
    END IF;
END $$;

-- qa_reviews table
CREATE TABLE IF NOT EXISTS qa_reviews (
    review_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    version_id UUID REFERENCES resume_versions(version_id) ON DELETE CASCADE,
    score NUMERIC(4, 3) NOT NULL,
    passed BOOLEAN NOT NULL,
    score_threshold NUMERIC(4, 3) NOT NULL,
    keyword_match NUMERIC(4, 3) NOT NULL,
    experience_match NUMERIC(4, 3) NOT NULL,
    seniority_match NUMERIC(4, 3) NOT NULL,
    structure_valid BOOLEAN NOT NULL,
    gaps JSONB,
    raw_feedback TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- pipeline_events table
CREATE TABLE IF NOT EXISTS pipeline_events (
    event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES jobs(job_id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    agent_name TEXT,
    from_status TEXT,
    to_status TEXT,
    model_used TEXT,
    detail TEXT,
    metadata JSONB,
    payload JSONB,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Triggers

-- NOTIFY trigger for pipeline_events live delivery
-- Mirror of database/003_pipeline_events_notify.sql
CREATE OR REPLACE FUNCTION notify_pipeline_event()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify(
        'pipeline_events',
        json_build_object(
            'job_id', NEW.job_id,
            'event_id', NEW.event_id
        )::text
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_pipeline_event ON pipeline_events;
CREATE TRIGGER trg_notify_pipeline_event
AFTER INSERT ON pipeline_events
FOR EACH ROW
EXECUTE FUNCTION notify_pipeline_event();

CREATE OR REPLACE FUNCTION update_iteration_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE jobs
    SET iteration_count = (
        SELECT COUNT(*)
        FROM resume_versions
        WHERE job_id = NEW.job_id
    )
    WHERE job_id = NEW.job_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_iteration_count ON resume_versions;
CREATE TRIGGER trg_sync_iteration_count
AFTER INSERT ON resume_versions
FOR EACH ROW
EXECUTE FUNCTION update_iteration_count();

CREATE OR REPLACE FUNCTION update_qa_score()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE jobs
    SET qa_score = NEW.score
    FROM resume_versions rv
    WHERE rv.version_id = NEW.version_id
    AND jobs.job_id = rv.job_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_qa_score ON qa_reviews;
CREATE TRIGGER trg_sync_qa_score
AFTER INSERT ON qa_reviews
FOR EACH ROW
EXECUTE FUNCTION update_qa_score();

-- user_profile table
-- Single-row, pluggable. No agent tables reference it by FK.
-- See database/001_user_profile.sql for full commentary.
CREATE TABLE IF NOT EXISTS user_profile (
    id                      INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    display_name            TEXT,
    openrouter_api_key_enc  TEXT,
    llm_provider            TEXT DEFAULT 'openrouter' CHECK (
                                llm_provider IS NULL OR
                                llm_provider IN ('openrouter', 'codex-oauth')
                            ),
    qa_threshold            NUMERIC(4, 3),
    max_iterations          INTEGER,
    preferred_model         TEXT,
    target_seniority        TEXT CHECK (
                                target_seniority IS NULL OR
                                target_seniority IN ('junior','mid','senior','lead','staff','principal')
                            ),
    highlight_skills        JSONB,
    preferred_industries    JSONB,
    tailor_style_notes      TEXT,
    notify_email            TEXT,
    notify_webhook_url      TEXT,
    resume_text             TEXT,
    full_name               TEXT,
    email                   TEXT,
    phone                   TEXT,
    location                TEXT,
    linkedin_url            TEXT,
    website_url             TEXT,
    summary                 TEXT,
    years_experience        INTEGER,
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION user_profile_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_profile_updated_at ON user_profile;
CREATE TRIGGER trg_user_profile_updated_at
BEFORE UPDATE ON user_profile
FOR EACH ROW
EXECUTE FUNCTION user_profile_set_updated_at();
