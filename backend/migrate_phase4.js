const Database = require('better-sqlite3');
const db = new Database('./data/world.db');

['wood', 'stone', 'water'].forEach(col => {
  try {
    db.exec(`ALTER TABLE agent_state ADD COLUMN ${col} INTEGER NOT NULL DEFAULT 0`);
    console.log(`coluna ${col} adicionada`);
  } catch (e) { console.log(`${col}:`, e.message); }
});

const now = Date.now();
const existing = db.prepare(`SELECT id FROM world_objects WHERE type IN ('tree', 'rock', 'water_source') LIMIT 1`).get();
if (!existing) {
  const resources = [
    ['tree', -40, -30], ['tree', -50, -50],
    ['rock', 45, -25], ['rock', 55, -45],
    ['water_source', 30, 40],
  ];
  const insert = db.prepare(`INSERT INTO world_objects (created_by, type, x, y, color, label, created_at) VALUES (NULL, ?, ?, ?, NULL, NULL, ?)`);
  resources.forEach(([type, x, y]) => insert.run(type, x, y, now));
  console.log('recursos criados');
}

console.log(db.prepare(`SELECT id, type, x, y FROM world_objects WHERE type IN ('tree','rock','water_source')`).all());
