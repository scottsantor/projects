CREATE TABLE IF NOT EXISTS linked_pairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jira_key TEXT NOT NULL,
  linear_id TEXT,
  linear_identifier TEXT NOT NULL,
  is_project INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_linked_pairs_unique
  ON linked_pairs(jira_key, linear_identifier);

CREATE INDEX IF NOT EXISTS idx_linked_pairs_jira_key
  ON linked_pairs(jira_key);
