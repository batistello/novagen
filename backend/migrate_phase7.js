const Database = require('better-sqlite3');
const db = new Database('./data/world.db');

const run = (sql, label) => { try { db.exec(sql); console.log(label, 'ok'); } catch(e) { console.log(label, ':', e.message); } };

run(`ALTER TABLE agent_state ADD COLUMN fiber INTEGER NOT NULL DEFAULT 0`, 'fiber');
run(`ALTER TABLE agent_state ADD COLUMN hp REAL NOT NULL DEFAULT 100`, 'hp');
run(`ALTER TABLE agent_state ADD COLUMN last_hp_regen_at INTEGER`, 'last_hp_regen_at');

run(`CREATE TABLE IF NOT EXISTS agent_items (
  agent_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, item_key)
)`, 'agent_items');

run(`CREATE TABLE IF NOT EXISTS tree_resources (
  world_object_id INTEGER PRIMARY KEY,
  stage TEXT NOT NULL DEFAULT 'adulta',
  stage_started_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  consumed_at INTEGER
)`, 'tree_resources');

run(`CREATE TABLE IF NOT EXISTS rock_resources (
  world_object_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'available',
  consumed_at INTEGER
)`, 'rock_resources');

run(`CREATE TABLE IF NOT EXISTS fish_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  water_object_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  stage TEXT NOT NULL DEFAULT 'pequeno',
  stage_started_at INTEGER NOT NULL,
  consumed_at INTEGER
)`, 'fish_slots');

const now = Date.now();

const trees = db.prepare(`SELECT id FROM world_objects WHERE type = 'tree' AND removed_at IS NULL`).all();
trees.forEach(t => {
  db.prepare(`INSERT OR IGNORE INTO tree_resources (world_object_id, stage, stage_started_at, status) VALUES (?, 'adulta', ?, 'available')`).run(t.id, now);
});
console.log('arvores inicializadas:', trees.length);

const rocks = db.prepare(`SELECT id FROM world_objects WHERE type = 'rock' AND removed_at IS NULL`).all();
rocks.forEach(r => {
  db.prepare(`INSERT OR IGNORE INTO rock_resources (world_object_id, status) VALUES (?, 'available')`).run(r.id);
});
console.log('pedras inicializadas:', rocks.length);

const waters = db.prepare(`SELECT id FROM world_objects WHERE type = 'water_source' AND removed_at IS NULL`).all();
waters.forEach(w => {
  const existing = db.prepare(`SELECT id FROM fish_slots WHERE water_object_id = ?`).get(w.id);
  if (!existing) {
    db.prepare(`INSERT INTO fish_slots (water_object_id, status, stage, stage_started_at) VALUES (?, 'available', 'pequeno', ?)`).run(w.id, now);
  }
});
console.log('slots de peixe inicializados:', waters.length);

db.prepare(`UPDATE agent_state SET last_hp_regen_at = ? WHERE last_hp_regen_at IS NULL`).run(now);

console.log('Migracao fase 7 completa.');
