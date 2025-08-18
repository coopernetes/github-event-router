-- Event storage for audit and retry
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    github_delivery_id TEXT UNIQUE NOT NULL,
    event_type TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    payload_size INTEGER NOT NULL,
    received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter'))
);

-- Delivery attempts tracking
CREATE TABLE IF NOT EXISTS delivery_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    subscriber_id INTEGER NOT NULL,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    status_code INTEGER,
    error_message TEXT,
    attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    duration_ms INTEGER,
    next_retry_at DATETIME,
    FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE,
    FOREIGN KEY (subscriber_id) REFERENCES subscribers (id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_events_status ON events (status);
CREATE INDEX IF NOT EXISTS idx_events_received_at ON events (received_at);
CREATE INDEX IF NOT EXISTS idx_events_github_delivery_id ON events (github_delivery_id);
CREATE INDEX IF NOT EXISTS idx_delivery_attempts_event_subscriber ON delivery_attempts (event_id, subscriber_id);
CREATE INDEX IF NOT EXISTS idx_delivery_attempts_next_retry ON delivery_attempts (next_retry_at) WHERE next_retry_at IS NOT NULL;
