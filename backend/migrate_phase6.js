const Database = require('better-sqlite3');
const db = new Database('./data/world.db');

try { db.exec('ALTER TABLE food_slots ADD COLUMN stage TEXT NOT NULL DEFAULT "adult"'); console.log('stage ok'); } catch(e) { console.log('stage:', e.message); }
try { db.exec('ALTER TABLE food_slots ADD COLUMN stage_started_at INTEGER'); console.log('stage_started_at ok'); } catch(e) { console.log('stage_started_at:', e.message); }

const now = Date.now();
db.prepare(`UPDATE food_slots SET stage_started_at = ? WHERE stage_started_at IS NULL`).run(now);

console.log(db.prepare('SELECT * FROM food_slots').all());
