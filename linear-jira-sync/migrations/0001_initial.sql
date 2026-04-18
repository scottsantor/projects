CREATE TABLE IF NOT EXISTS ticket_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jira_key TEXT NOT NULL,
  jira_url TEXT NOT NULL,
  linear_id TEXT,
  linear_identifier TEXT,
  linear_url TEXT,
  linear_project_id TEXT,
  linear_project_url TEXT,
  jira_summary TEXT,
  status TEXT DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mappings_jira_key ON ticket_mappings(jira_key);
CREATE INDEX IF NOT EXISTS idx_mappings_linear_id ON ticket_mappings(linear_id);
CREATE INDEX IF NOT EXISTS idx_mappings_status ON ticket_mappings(status);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mapping_id INTEGER,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  details TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (mapping_id) REFERENCES ticket_mappings(id)
);

CREATE INDEX IF NOT EXISTS idx_activity_mapping ON activity_log(mapping_id);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at DESC);
