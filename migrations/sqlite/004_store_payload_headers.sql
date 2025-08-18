-- Add payload and headers storage for proper retries
ALTER TABLE events ADD COLUMN payload_data TEXT; -- JSON string
ALTER TABLE events ADD COLUMN headers_data TEXT; -- JSON string

-- Create index for faster payload lookups during retries
CREATE INDEX IF NOT EXISTS idx_events_payload_lookup ON events (id, github_delivery_id);
