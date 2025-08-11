CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    events TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscriber_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    config BLOB NOT NULL,
    FOREIGN KEY (subscriber_id) REFERENCES subscribers (id)
);
