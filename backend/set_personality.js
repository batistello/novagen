const Database = require('better-sqlite3');
const db = new Database('./data/world.db');

const agentId = process.argv[2];
if (!['blue', 'red', 'green'].includes(agentId)) {
  console.log('Uso: node set_personality.js blue|red|green (depois cole o texto e digite END numa linha sozinha)');
  process.exit(1);
}

let text = '';
process.stdin.on('data', chunk => { text += chunk; });
process.stdin.on('end', () => {
  const cleaned = text.trim();
  db.prepare('UPDATE agent_state SET persona_description = ? WHERE agent_id = ?').run(cleaned, agentId);
  console.log(`Personalidade de ${agentId} atualizada:`);
  console.log(cleaned);
});
