const Database = require('better-sqlite3');
const db = new Database('./data/world.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS agent_memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    related_agent_id TEXT,
    created_at INTEGER NOT NULL
  );
`);

console.log('tabela agent_memories criada');
