-- Migration 009: Career Vault schema foundation
--
-- Additive-only Vault tables for source artifacts, approved career evidence,
-- STAR stories, and provenance. This migration intentionally does not touch
-- pipeline tables such as jobs, resume_versions, qa_reviews, or pipeline_events.

CREATE TABLE IF NOT EXISTS vault_profile (
    id                  INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    headline            TEXT,
    summary             TEXT,
    preferred_titles    JSONB NOT NULL DEFAULT '[]',
    location            TEXT,
    work_authorization  TEXT,
    remote_preference   TEXT CHECK (
                            remote_preference IS NULL OR
                            remote_preference IN ('remote','hybrid','onsite')
                        ),
    open_to_relocation  BOOLEAN DEFAULT FALSE,
    last_user_edit      TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO vault_profile (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS source_artifacts (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_type         TEXT NOT NULL CHECK (
                            source_type IN ('resume','linkedin','github','portfolio','manual','other')
                        ),
    source_reference    TEXT,
    extracted_at        TIMESTAMPTZ,
    approval_state      TEXT NOT NULL DEFAULT 'pending'
                            CHECK (approval_state IN ('pending','approved','edited','rejected','superseded')),
    manual_entry        BOOLEAN NOT NULL DEFAULT FALSE,
    manual_entry_reason TEXT,
    last_user_edit      TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vault_roles (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company             TEXT NOT NULL,
    title               TEXT NOT NULL,
    employment_type     TEXT CHECK (
                            employment_type IS NULL OR
                            employment_type IN ('full_time','part_time','contract','freelance','internship')
                        ),
    start_date          DATE,
    end_date            DATE,
    location            TEXT,
    level               TEXT,
    description         TEXT,
    approval_state      TEXT NOT NULL DEFAULT 'pending'
                            CHECK (approval_state IN ('pending','approved','edited','rejected','superseded')),
    manual_entry        BOOLEAN NOT NULL DEFAULT FALSE,
    manual_entry_reason TEXT,
    last_user_edit      TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vault_projects (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title               TEXT NOT NULL,
    role_id             UUID REFERENCES vault_roles(id) ON DELETE SET NULL,
    start_date          DATE,
    end_date            DATE,
    domain              TEXT,
    tech_stack          JSONB NOT NULL DEFAULT '[]',
    description         TEXT,
    outcomes            TEXT,
    approval_state      TEXT NOT NULL DEFAULT 'pending'
                            CHECK (approval_state IN ('pending','approved','edited','rejected','superseded')),
    manual_entry        BOOLEAN NOT NULL DEFAULT FALSE,
    manual_entry_reason TEXT,
    last_user_edit      TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vault_skills (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    canonical_name      TEXT NOT NULL,
    category            TEXT NOT NULL CHECK (
                            category IN ('language','framework','cloud','tooling','domain','soft_skill')
                        ),
    approval_state      TEXT NOT NULL DEFAULT 'pending'
                            CHECK (approval_state IN ('pending','approved','edited','rejected','superseded')),
    manual_entry        BOOLEAN NOT NULL DEFAULT FALSE,
    manual_entry_reason TEXT,
    last_user_edit      TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS vault_skills_canonical_name_unique
    ON vault_skills (canonical_name);

CREATE TABLE IF NOT EXISTS vault_achievements (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    statement           TEXT NOT NULL,
    role_id             UUID REFERENCES vault_roles(id) ON DELETE SET NULL,
    project_id          UUID REFERENCES vault_projects(id) ON DELETE SET NULL,
    metrics             JSONB,
    related_skills      JSONB NOT NULL DEFAULT '[]',
    approval_state      TEXT NOT NULL DEFAULT 'pending'
                            CHECK (approval_state IN ('pending','approved','edited','rejected','superseded')),
    manual_entry        BOOLEAN NOT NULL DEFAULT FALSE,
    manual_entry_reason TEXT,
    last_user_edit      TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vault_certifications (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                TEXT NOT NULL,
    issuer              TEXT,
    issued_date         DATE,
    expiry_date         DATE,
    approval_state      TEXT NOT NULL DEFAULT 'pending'
                            CHECK (approval_state IN ('pending','approved','edited','rejected','superseded')),
    manual_entry        BOOLEAN NOT NULL DEFAULT FALSE,
    manual_entry_reason TEXT,
    last_user_edit      TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vault_stories (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title               TEXT NOT NULL,
    situation           TEXT,
    task                TEXT,
    action              TEXT,
    result              TEXT,
    tags                JSONB NOT NULL DEFAULT '[]',
    approval_state      TEXT NOT NULL DEFAULT 'pending'
                            CHECK (approval_state IN ('pending','approved','edited','rejected','superseded')),
    manual_entry        BOOLEAN NOT NULL DEFAULT FALSE,
    manual_entry_reason TEXT,
    last_user_edit      TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vault_story_links (
    story_id            UUID NOT NULL REFERENCES vault_stories(id) ON DELETE CASCADE,
    linked_type         TEXT NOT NULL CHECK (linked_type IN ('role','project','achievement')),
    linked_id           UUID NOT NULL,
    PRIMARY KEY (story_id, linked_type, linked_id)
);

CREATE TABLE IF NOT EXISTS record_provenance (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    record_type         TEXT NOT NULL CHECK (
                            record_type IN ('role','project','achievement','skill','certification','story','source_artifact')
                        ),
    record_id           UUID NOT NULL,
    source_artifact_id  UUID NOT NULL REFERENCES source_artifacts(id) ON DELETE CASCADE,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (record_type, record_id, source_artifact_id)
);

CREATE INDEX IF NOT EXISTS idx_record_provenance_record
    ON record_provenance (record_type, record_id);

CREATE INDEX IF NOT EXISTS idx_record_provenance_source
    ON record_provenance (source_artifact_id);

CREATE OR REPLACE FUNCTION vault_set_last_user_edit()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_user_edit = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vault_profile_last_user_edit ON vault_profile;
CREATE TRIGGER trg_vault_profile_last_user_edit
BEFORE UPDATE ON vault_profile
FOR EACH ROW EXECUTE FUNCTION vault_set_last_user_edit();

DROP TRIGGER IF EXISTS trg_source_artifacts_last_user_edit ON source_artifacts;
CREATE TRIGGER trg_source_artifacts_last_user_edit
BEFORE UPDATE ON source_artifacts
FOR EACH ROW EXECUTE FUNCTION vault_set_last_user_edit();

DROP TRIGGER IF EXISTS trg_vault_roles_last_user_edit ON vault_roles;
CREATE TRIGGER trg_vault_roles_last_user_edit
BEFORE UPDATE ON vault_roles
FOR EACH ROW EXECUTE FUNCTION vault_set_last_user_edit();

DROP TRIGGER IF EXISTS trg_vault_projects_last_user_edit ON vault_projects;
CREATE TRIGGER trg_vault_projects_last_user_edit
BEFORE UPDATE ON vault_projects
FOR EACH ROW EXECUTE FUNCTION vault_set_last_user_edit();

DROP TRIGGER IF EXISTS trg_vault_skills_last_user_edit ON vault_skills;
CREATE TRIGGER trg_vault_skills_last_user_edit
BEFORE UPDATE ON vault_skills
FOR EACH ROW EXECUTE FUNCTION vault_set_last_user_edit();

DROP TRIGGER IF EXISTS trg_vault_achievements_last_user_edit ON vault_achievements;
CREATE TRIGGER trg_vault_achievements_last_user_edit
BEFORE UPDATE ON vault_achievements
FOR EACH ROW EXECUTE FUNCTION vault_set_last_user_edit();

DROP TRIGGER IF EXISTS trg_vault_certifications_last_user_edit ON vault_certifications;
CREATE TRIGGER trg_vault_certifications_last_user_edit
BEFORE UPDATE ON vault_certifications
FOR EACH ROW EXECUTE FUNCTION vault_set_last_user_edit();

DROP TRIGGER IF EXISTS trg_vault_stories_last_user_edit ON vault_stories;
CREATE TRIGGER trg_vault_stories_last_user_edit
BEFORE UPDATE ON vault_stories
FOR EACH ROW EXECUTE FUNCTION vault_set_last_user_edit();
