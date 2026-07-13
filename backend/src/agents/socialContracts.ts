import { db } from '../db';
import { recordDiaryEntry } from './worldDiary';

const AGENT_NAMES: Record<string, string> = { blue: 'Azul', red: 'Vermelho', green: 'Verde' };

export function proposeContract(fromId: string, toId: string, terms: string) {
  db.prepare(
    `INSERT INTO social_contracts (proposed_by, proposed_to, terms, status, created_at) VALUES (?, ?, ?, 'proposed', ?)`
  ).run(fromId, toId, terms, Date.now());
}

export function getPendingContractsFor(agentId: string): { id: number; proposed_by: string; terms: string }[] {
  return db.prepare(
    `SELECT id, proposed_by, terms FROM social_contracts WHERE proposed_to = ? AND status = 'proposed' ORDER BY created_at DESC LIMIT 3`
  ).all(agentId) as { id: number; proposed_by: string; terms: string }[];
}

export function getActiveContractsInvolving(agentId: string): { id: number; proposed_by: string; proposed_to: string; terms: string }[] {
  return db.prepare(
    `SELECT id, proposed_by, proposed_to, terms FROM social_contracts WHERE (proposed_by = ? OR proposed_to = ?) AND status = 'accepted' ORDER BY created_at DESC LIMIT 5`
  ).all(agentId, agentId) as { id: number; proposed_by: string; proposed_to: string; terms: string }[];
}

const FIRST_CONTRACT_KEY = 'first_contract_proposed';
const FIRST_COOPERATION_KEY = 'first_contract_accepted';

export function respondToContract(contractId: number, accept: boolean) {
  const contract = db.prepare(`SELECT proposed_by, proposed_to, terms FROM social_contracts WHERE id = ?`).get(contractId) as
    { proposed_by: string; proposed_to: string; terms: string } | undefined;
  if (!contract) return;

  const newStatus = accept ? 'accepted' : 'rejected';
  db.prepare(`UPDATE social_contracts SET status = ?, responded_at = ? WHERE id = ?`).run(newStatus, Date.now(), contractId);

  if (accept) {
    const alreadyLogged = db.prepare(`SELECT key FROM world_meta WHERE key = ?`).get(FIRST_COOPERATION_KEY);
    if (!alreadyLogged) {
      db.prepare(`INSERT INTO world_meta (key, value) VALUES (?, ?)`).run(FIRST_COOPERATION_KEY, String(Date.now()));
      recordDiaryEntry(
        `${AGENT_NAMES[contract.proposed_to] ?? contract.proposed_to} aceitou um acordo proposto por ${AGENT_NAMES[contract.proposed_by] ?? contract.proposed_by}: ${contract.terms}`,
        'COOPERACAO'
      );
    }
  }
}

export function logFirstProposalIfNeeded(fromId: string, terms: string) {
  const alreadyLogged = db.prepare(`SELECT key FROM world_meta WHERE key = ?`).get(FIRST_CONTRACT_KEY);
  if (!alreadyLogged) {
    db.prepare(`INSERT INTO world_meta (key, value) VALUES (?, ?)`).run(FIRST_CONTRACT_KEY, String(Date.now()));
    recordDiaryEntry(`${AGENT_NAMES[fromId] ?? fromId} propos um acordo pela primeira vez: ${terms}`, 'OUTRO');
  }
}
