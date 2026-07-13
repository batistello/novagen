const Database = require('better-sqlite3');
const db = new Database('./data/world.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS world_diary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS world_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS agent_meetings (
    pair_key TEXT PRIMARY KEY,
    met_at INTEGER NOT NULL
  );
`);

const existing = db.prepare(`SELECT value FROM world_meta WHERE key = 'world_start_at'`).get();
if (!existing) {
  db.prepare(`INSERT INTO world_meta (key, value) VALUES ('world_start_at', ?)`).run(String(Date.now()));
  console.log('world_start_at definido agora');
} else {
  console.log('world_start_at ja existe:', existing.value);
}

console.log('migracao fase 5 completa');
