const Database = require('better-sqlite3');
const db = new Database('./data/world.db');

try {
  db.exec('ALTER TABLE agent_state ADD COLUMN hunger REAL NOT NULL DEFAULT 100');
  console.log('coluna hunger adicionada');
} catch (e) { console.log('hunger:', e.message); }

db.exec(`
  CREATE TABLE IF NOT EXISTS food_slots (
    id INTEGER PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'available',
    consumed_at INTEGER
  );
`);

const count = db.prepare('SELECT COUNT(*) as c FROM food_slots').get().c;
if (count === 0) {
  const insert = db.prepare(`INSERT INTO food_slots (id, status, consumed_at) VALUES (?, 'available', NULL)`);
  for (let i = 1; i <= 4; i++) insert.run(i);
  console.log('4 slots de comida criados');
}

console.log(db.prepare('SELECT * FROM food_slots').all());
console.log(db.prepare('SELECT agent_id, hunger FROM agent_state').all());
