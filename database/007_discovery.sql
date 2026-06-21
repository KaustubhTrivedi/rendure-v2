-- Migration 007: job discovery tables
--
-- search_preferences: single-row config for what the user is looking for.
--   Agents read this at discovery time; nothing in the core pipeline references it.
--
-- discovered_jobs: staging area for jobs found by the discovery agent.
--   Jobs start here as 'pending_review', the user approves/rejects them,
--   and approved ones are enqueued into the main jobs pipeline.

CREATE TABLE IF NOT EXISTS search_preferences (
    id                  INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    target_roles        JSONB   NOT NULL DEFAULT '[]',    -- ["Software Engineer", "Backend Engineer"]
    locations           JSONB   NOT NULL DEFAULT '[]',    -- ["Remote", "San Francisco"]
    excluded_companies  JSONB   NOT NULL DEFAULT '[]',
    min_seniority       TEXT    CHECK (
                            min_seniority IS NULL OR
                            min_seniority IN ('junior','mid','senior','lead','staff','principal')
                        ),
    keywords            JSONB   NOT NULL DEFAULT '[]',    -- extra keywords that boost relevance

    -- Per-platform config: company slugs / search queries / URLs
    greenhouse_companies  JSONB NOT NULL DEFAULT '[]',   -- ["stripe", "shopify"]
    lever_companies       JSONB NOT NULL DEFAULT '[]',   -- ["notion", "vercel"]
    ashby_companies       JSONB NOT NULL DEFAULT '[]',   -- ["linear", "supabase"]
    indeed_queries        JSONB NOT NULL DEFAULT '[]',   -- [{"q": "backend engineer", "l": "remote"}]
    workday_urls          JSONB NOT NULL DEFAULT '[]',   -- full Workday search result URLs
    career_page_urls      JSONB NOT NULL DEFAULT '[]',   -- company career pages to crawl directly

    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Idempotent seed: ensure a row exists so agents can always SELECT id = 1
INSERT INTO search_preferences (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION search_preferences_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_search_preferences_updated_at ON search_preferences;
CREATE TRIGGER trg_search_preferences_updated_at
BEFORE UPDATE ON search_preferences
FOR EACH ROW EXECUTE FUNCTION search_preferences_set_updated_at();


CREATE TABLE IF NOT EXISTS discovered_jobs (
    id              UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_url         TEXT    NOT NULL,
    title           TEXT    NOT NULL,
    company         TEXT    NOT NULL,
    location        TEXT,
    platform        TEXT    NOT NULL,   -- 'greenhouse','lever','ashby','indeed','workday','career_page'
    raw_snippet     TEXT,               -- brief description or first N chars of JD
    relevance_score NUMERIC(4,3),       -- 0.000–1.000; NULL = not yet scored
    status          TEXT    NOT NULL DEFAULT 'pending_review'
                            CHECK (status IN ('pending_review','queued','rejected','duplicate')),
    job_id          UUID    REFERENCES jobs(job_id) ON DELETE SET NULL,  -- set when queued
    discovered_at   TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at     TIMESTAMPTZ
);

-- Deduplication: one row per URL
CREATE UNIQUE INDEX IF NOT EXISTS discovered_jobs_url_unique ON discovered_jobs (job_url);
