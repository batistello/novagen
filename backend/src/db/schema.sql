CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_traits (
  agent_id TEXT NOT NULL,
  trait TEXT NOT NULL,
  value REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, trait),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);
CREATE TABLE IF NOT EXISTS agent_state (
  agent_id TEXT PRIMARY KEY,
  energy REAL NOT NULL DEFAULT 100,
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  emotion TEXT DEFAULT 'neutral',
  status TEXT DEFAULT 'awake',
  last_tick_at INTEGER NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS memory_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS world_objects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_by TEXT,
  type TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  color TEXT,
  label TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  removed_at INTEGER
);
