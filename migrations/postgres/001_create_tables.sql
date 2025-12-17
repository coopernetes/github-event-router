-- PostgreSQL migration: Create base tables for subscribers and transports

CREATE TABLE IF NOT EXISTS subscribers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    events TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transports (
    id SERIAL PRIMARY KEY,
    subscriber_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    config TEXT NOT NULL,
    FOREIGN KEY (subscriber_id) REFERENCES subscribers (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_transports_subscriber_id ON transports (subscriber_id);
