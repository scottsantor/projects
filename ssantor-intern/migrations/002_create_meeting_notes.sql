CREATE TABLE IF NOT EXISTS meeting_notes (
    event_id TEXT PRIMARY KEY,
    notes TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
