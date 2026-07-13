const Database = require('better-sqlite3');
const db = new Database('./data/world.db');

try {
  db.exec('ALTER TABLE agent_state ADD COLUMN last_meal_at INTEGER');
  console.log('coluna last_meal_at adicionada');
} catch (e) { console.log('last_meal_at:', e.message); }

try {
  db.exec('ALTER TABLE agent_state ADD COLUMN starving_since INTEGER');
  console.log('coluna starving_since adicionada');
} catch (e) { console.log('starving_since:', e.message); }

const now = Date.now();
db.prepare(`UPDATE agent_state SET last_meal_at = ? WHERE last_meal_at IS NULL`).run(now);

console.log(db.prepare('SELECT agent_id, hunger, last_meal_at, starving_since, status FROM agent_state').all());
