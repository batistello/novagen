import { db, initSchema } from './index';

const now = Date.now();

const AGENTS = [
  { id: 'blue', name: 'Azul', color: '#3498db' },
  { id: 'red',  name: 'Vermelho', color: '#e74c3c' },
];

const TRAITS: Record<string, Record<string, number>> = {
  blue: {
    curiosidade: 92,
    coragem: 60,
    criatividade: 81,
    confianca_no_outro: 40,
    empatia: 55,
    persistencia: 70,
    necessidade_de_companhia: 65,
    apego_ao_territorio: 20,
  },
  red: {
    curiosidade: 45,
    coragem: 35,
    criatividade: 30,
    confianca_no_outro: 20,
    empatia: 40,
    persistencia: 90,
    necessidade_de_companhia: 30,
    apego_ao_territorio: 75,
  },
};

function seed() {
  initSchema();

  const insertAgent = db.prepare(
    `INSERT OR IGNORE INTO agents (id, name, color, created_at) VALUES (?, ?, ?, ?)`
  );
  const insertTrait = db.prepare(
    `INSERT OR IGNORE INTO agent_traits (agent_id, trait, value, updated_at) VALUES (?, ?, ?, ?)`
  );
  const insertState = db.prepare(
    `INSERT OR IGNORE INTO agent_state (agent_id, energy, x, y, emotion, status, last_tick_at)
     VALUES (?, 100, ?, ?, 'neutral', 'awake', ?)`
  );

  AGENTS.forEach((agent, i) => {
    insertAgent.run(agent.id, agent.name, agent.color, now);

    const traits = TRAITS[agent.id];
    Object.entries(traits).forEach(([trait, value]) => {
      insertTrait.run(agent.id, trait, value, now);
    });

    const startX = i === 0 ? -50 : 50;
    insertState.run(agent.id, startX, 0, now);
  });

  console.log('[seed] agentes Azul e Vermelho criados com DNA inicial.');
}

seed();
