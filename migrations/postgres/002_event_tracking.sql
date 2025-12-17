-- PostgreSQL migration: Event tracking tables

CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    github_delivery_id TEXT UNIQUE NOT NULL,
    event_type TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    payload_size INTEGER NOT NULL,
    payload_data TEXT,
    headers_data TEXT,
    received_at TIMESTAMP DEFAULT NOW(),
    processed_at TIMESTAMP,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter'))
);

CREATE TABLE IF NOT EXISTS delivery_attempts (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL,
    subscriber_id INTEGER NOT NULL,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    status_code INTEGER,
    error_message TEXT,
    attempted_at TIMESTAMP DEFAULT NOW(),
    duration_ms INTEGER,
    next_retry_at TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE,
    FOREIGN KEY (subscriber_id) REFERENCES subscribers (id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_events_status ON events (status);
CREATE INDEX IF NOT EXISTS idx_events_received_at ON events (received_at);
CREATE INDEX IF NOT EXISTS idx_events_github_delivery_id ON events (github_delivery_id);
CREATE INDEX IF NOT EXISTS idx_delivery_attempts_event_subscriber ON delivery_attempts (event_id, subscriber_id);
CREATE INDEX IF NOT EXISTS idx_delivery_attempts_next_retry ON delivery_attempts (next_retry_at) WHERE next_retry_at IS NOT NULL;
