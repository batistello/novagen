const Database = require('better-sqlite3');
const db = new Database('./data/world.db');

const names = { blue: 'Azul', red: 'Vermelho' };

const events = db.prepare(`
  SELECT agent_id, type, content, created_at
  FROM events
  WHERE type IN ('speech', 'thought')
  ORDER BY created_at ASC
`).all();

events.forEach(ev => {
  const time = new Date(ev.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const who = names[ev.agent_id] || ev.agent_id;
  const tag = ev.type === 'speech' ? 'FALA' : 'PENSAMENTO';
  console.log(`[${time}] ${who} (${tag}): ${ev.content}`);
});

console.log(`\nTotal de eventos: ${events.length}`);
