import { db } from '../db';

const NAME_TO_ID: Record<string, string> = {
  azul: 'blue', vermelho: 'red', verde: 'green',
  blue: 'blue', red: 'red', green: 'green',
};

function normalizeAgentId(idOrName: string): string {
  return NAME_TO_ID[idOrName.toLowerCase()] ?? idOrName.toLowerCase();
}

export function updateBelief(agentId: string, aboutAgentId: string, beliefText: string) {
  const normalizedAbout = normalizeAgentId(aboutAgentId);
  const now = Date.now();
  db.prepare(`
    INSERT INTO agent_beliefs (agent_id, about_agent_id, belief_text, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(agent_id, about_agent_id) DO UPDATE SET belief_text = excluded.belief_text, updated_at = excluded.updated_at
  `).run(agentId, normalizedAbout, beliefText, now);
}

export function getBeliefs(agentId: string): { about_agent_id: string; belief_text: string }[] {
  return db.prepare(
    `SELECT about_agent_id, belief_text FROM agent_beliefs WHERE agent_id = ?`
  ).all(agentId) as { about_agent_id: string; belief_text: string }[];
}
