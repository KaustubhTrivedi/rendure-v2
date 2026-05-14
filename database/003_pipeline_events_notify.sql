-- Migration 003: pipeline_events NOTIFY trigger
--
-- Every INSERT on pipeline_events fires a PostgreSQL NOTIFY on the
-- 'pipeline_events' channel with a compact JSON payload containing only
-- job_id and event_id. The API uses this to wake SSE streams without
-- polling the database.
--
-- Because Python agents write pipeline_events directly (not through the
-- API), the notification source must live at the database layer so that
-- all writers — agent, API, or manual — trigger live delivery.

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
