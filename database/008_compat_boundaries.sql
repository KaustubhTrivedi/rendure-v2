CREATE TABLE IF NOT EXISTS application_statuses (
    status TEXT PRIMARY KEY
);

INSERT INTO application_statuses (status) VALUES
('saved'),
('applied'),
('interviewing'),
('offer'),
('rejected'),
('archived')
ON CONFLICT (status) DO NOTHING;

CREATE TABLE IF NOT EXISTS application_timeline_events (
    event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    application_id UUID NOT NULL,
    event_type TEXT NOT NULL,
    metadata JSONB,
    occurred_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_application_timeline_events_application_id
    ON application_timeline_events (application_id);
