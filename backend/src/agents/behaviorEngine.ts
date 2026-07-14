import { db } from '../db';
import { getIntention, setWanderTarget, isIntentionExpiredOrInterrupted, StoredIntention, setBuildDirection, incrementBuildCount } from './intentionStore';
import { isNearGrass, tryConsumeFood, GRASS_LOCATION } from './hungerSystem';
import { notifyWitnesses } from './memoryTiers';
import {
  findNearbyResource, tryGatherResource, consumeForBuild, tryDrinkWater, tryFish, tryCraft, RECIPES,
  tryEquip, tryUnequip, tryDrop, tryGiveItem, canAttack, computeAttackDamage, registerAttack, getEquipment, tryDrinkFromBag
} from './resourceSystem';
import { broadcastEvent, broadcastFullState } from '../ws/server';

const AGENT_NAMES: Record<string, string> = { blue: 'Azul', red: 'Vermelho', green: 'Verde' };
const WORLD_HALF = 150;
const PROXIMITY_CHECK_UNITS = 30;

function loadState(agentId: string) {
  return db.prepare(`SELECT * FROM agent_state WHERE agent_id = ?`).get(agentId) as {
    agent_id: string; energy: number; x: number; y: number; emotion: string; status: string;
  };
}

const OBJECT_COLLISION_RADIUS = 10;

function getNearbyObjects(x: number, y: number, radius: number) {
  return db.prepare(
    `SELECT x, y FROM world_objects WHERE removed_at IS NULL AND x BETWEEN ? AND ? AND y BETWEEN ? AND ?`
  ).all(x - radius, x + radius, y - radius, y + radius) as { x: number; y: number }[];
}

function collidesWithObject(x: number, y: number): boolean {
  const nearby = getNearbyObjects(x, y, OBJECT_COLLISION_RADIUS * 2);
  return nearby.some(obj => {
    const d = Math.sqrt((obj.x - x) ** 2 + (obj.y - y) ** 2);
    return d < OBJECT_COLLISION_RADIUS;
  });
}

function rotatePoint(cx: number, cy: number, x: number, y: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = x - cx;
  const dy = y - cy;
  return {
    x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

function moveTowards(agentId: string, targetX: number, targetY: number, step: number) {
  const state = loadState(agentId);
  const dx = targetX - state.x;
  const dy = targetY - state.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return { x: state.x, y: state.y, arrived: true };

  const moveDist = Math.min(step, dist);
  let newX = state.x + (dx / dist) * moveDist;
  let newY = state.y + (dy / dist) * moveDist;

  if (collidesWithObject(newX, newY)) {
    let deflected = false;
    for (const angle of [35, -35, 70, -70]) {
      const rotated = rotatePoint(state.x, state.y, newX, newY, angle);
      if (!collidesWithObject(rotated.x, rotated.y)) {
        newX = rotated.x;
        newY = rotated.y;
        deflected = true;
        break;
      }
    }
    if (!deflected) {
      newX = state.x;
      newY = state.y;
    }
  }

  const clampedX = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, newX));
  const clampedY = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, newY));

  db.prepare(`UPDATE agent_state SET x = ?, y = ? WHERE agent_id = ?`).run(clampedX, clampedY, agentId);
  return { x: clampedX, y: clampedY, arrived: dist <= step };
}

function pickWanderTarget(agentId: string, intention: StoredIntention) {
  const angle = Math.random() * Math.PI * 2;
  const radius = 20 + Math.random() * 40;
  const state = loadState(agentId);
  const wx = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, state.x + Math.cos(angle) * radius));
  const wy = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, state.y + Math.sin(angle) * radius));
  setWanderTarget(agentId, wx, wy);
  return { x: wx, y: wy };
}

function createWorldObject(agentId: string, material: string, x: number, y: number, purpose: string | null) {
  const typeByMaterial: Record<string, string> = { wood: 'wood_piece', stone: 'stone_piece' };
  const colorByMaterial: Record<string, string> = { wood: '#8b5a2b', stone: '#7f8c8d' };
  const type = typeByMaterial[material] ?? 'bloco';
  const color = colorByMaterial[material] ?? '#888888';

  db.prepare(
    `INSERT INTO world_objects (created_by, type, x, y, color, label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(agentId, type, x, y, color, purpose, Date.now());
}

function distanceBetween(agentId: string, otherId: string): number {
  const a = loadState(agentId);
  const b = loadState(otherId);
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function getAllAgentIds(): string[] {
  return (db.prepare(`SELECT a.id FROM agents a JOIN agent_state s ON s.agent_id = a.id WHERE s.status != 'dead'`).all() as { id: string }[]).map(r => r.id);
}

function getOtherAgentIds(agentId: string): string[] {
  return getAllAgentIds().filter(id => id !== agentId);
}

function getClosestAgentId(agentId: string, candidates: string[]): string | null {
  if (candidates.length === 0) return null;
  let closest = candidates[0];
  let closestDist = distanceBetween(agentId, closest);
  for (const id of candidates.slice(1)) {
    const d = distanceBetween(agentId, id);
    if (d < closestDist) {
      closest = id;
      closestDist = d;
    }
  }
  return closest;
}

function resolveTargetId(agentId: string, targetAgentId: string | null): string | null {
  const others = getOtherAgentIds(agentId);
  if (targetAgentId && others.includes(targetAgentId)) return targetAgentId;
  return getClosestAgentId(agentId, others);
}

export function checkProximityInterrupt(agentId: string): boolean {
  const intention = getIntention(agentId);
  if (!intention || intention.interrupt_on_proximity == null) return false;
  const others = getOtherAgentIds(agentId);
  return others.some(otherId => distanceBetween(agentId, otherId) <= intention.interrupt_on_proximity!);
}

export function behaviorTick(agentId: string): { acted: boolean; goalType: string | null } {
  const intention = getIntention(agentId);
  if (!intention || isIntentionExpiredOrInterrupted(intention)) {
    return { acted: false, goalType: intention?.goal_type ?? null };
  }

  const otherId = resolveTargetId(agentId, intention.target_agent_id ?? null);
  let actionType = 'wait';
  let moved = false;

  switch (intention.goal_type) {
    case 'explore': {
      if (intention.wander_x == null || intention.wander_y == null) {
        pickWanderTarget(agentId, intention);
      } else {
        const result = moveTowards(agentId, intention.wander_x, intention.wander_y, 6);
        if (result.arrived) pickWanderTarget(agentId, intention);
        moved = true;
      }
      actionType = 'walk';
      break;
    }
    case 'approach': {
      if (otherId) {
        const self = loadState(agentId);
        const other = loadState(otherId);
        const distToOther = Math.sqrt((self.x - other.x) ** 2 + (self.y - other.y) ** 2);
        const MIN_APPROACH_DISTANCE = 15;
        if (distToOther > MIN_APPROACH_DISTANCE) {
          moveTowards(agentId, other.x, other.y, Math.min(5, distToOther - MIN_APPROACH_DISTANCE));
          moved = true;
        }
      }
      actionType = 'walk';
      break;
    }
    case 'move_away': {
      const self = loadState(agentId);
      if (otherId) {
        const other = loadState(otherId);
        const dx = self.x - other.x;
        const dy = self.y - other.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const fleeX = self.x + (dx / dist) * 30;
        const fleeY = self.y + (dy / dist) * 30;
        moveTowards(agentId, fleeX, fleeY, 5);
        moved = true;
      }
      actionType = 'walk';
      break;
    }
    case 'build': {
      const self = loadState(agentId);
      let dirX = intention.build_dir_x;
      let dirY = intention.build_dir_y;
      if (dirX == null || dirY == null) {
        const angle = Math.random() * Math.PI * 2;
        dirX = Math.cos(angle);
        dirY = Math.sin(angle);
        setBuildDirection(agentId, dirX, dirY);

        if (intention.build_purpose) {
          const AGENT_NAMES_DIARY: Record<string, string> = { blue: 'Azul', red: 'Vermelho', green: 'Verde' };
          const { recordDiaryEntry } = require('./worldDiary');
          recordDiaryEntry(`${AGENT_NAMES_DIARY[agentId] ?? agentId} comecou a construir: ${intention.build_purpose}`, 'CONSTRUCAO');
        }
      }
      const step = incrementBuildCount(agentId);
      const placeX = self.x + dirX * step * 6;
      const placeY = self.y + dirY * step * 6;

      const materialResult = consumeForBuild(agentId);
      if (materialResult.success && materialResult.used) {
        createWorldObject(agentId, materialResult.used, placeX, placeY, intention.build_purpose);
        actionType = 'create_object';
        broadcastFullState();
        notifyWitnesses(
          agentId, self.x, self.y,
          `Usei ${materialResult.used} que eu tinha guardado para construir algo${intention.build_purpose ? ': ' + intention.build_purpose : ''}.`,
          (name) => `Vi ${name} construir algo${intention.build_purpose ? ': ' + intention.build_purpose : ''}.`
        );
      } else {
        actionType = 'observe';
        notifyWitnesses(
          agentId, self.x, self.y,
          'Tentei construir algo, mas nao tinha nenhum material guardado.',
          (name) => `Vi ${name} tentar construir algo sem ter material.`
        );
      }
      break;
    }
    case 'collect': {
      const self = loadState(agentId);
      if (isNearGrass(self.x, self.y)) {
        const success = tryConsumeFood(agentId);
        actionType = success ? 'collect_success' : 'collect_failed';
        if (!success) {
          notifyWitnesses(
            agentId, self.x, self.y,
            'Tentei consumir algo daquela area verde, mas nao havia nada disponivel.',
            (name) => `Vi ${name} tentar consumir algo daquela area verde sem sucesso.`
          );
        }
      } else {
        moveTowards(agentId, GRASS_LOCATION.x, GRASS_LOCATION.y, 6);
        moved = true;
        actionType = 'walk';
      }
      break;
    }
    case 'gather': {
      const self = loadState(agentId);
      const nearby = findNearbyResource(self.x, self.y);
      if (nearby && nearby.dist <= 15) {
        const result = tryGatherResource(agentId, self.x, self.y);
        actionType = result.success ? 'gather_success' : 'gather_failed';
        if (result.success) {
          notifyWitnesses(
            agentId, self.x, self.y,
            `Obtive ${result.resourceType} de algo que encontrei aqui.`,
            (name) => `Vi ${name} obter algo de um recurso proximo.`
          );
        } else {
          notifyWitnesses(
            agentId, self.x, self.y,
            'Tentei obter algo daquele recurso, mas nao consegui.',
            (name) => `Vi ${name} tentar obter algo de um recurso sem sucesso.`
          );
        }
      } else if (nearby) {
        moveTowards(agentId, nearby.x, nearby.y, 6);
        moved = true;
        actionType = 'walk';
      } else {
        actionType = 'observe';
      }
      break;
    }
    case 'drink': {
      const self = loadState(agentId);
      const nearby = findNearbyResource(self.x, self.y);
      if (nearby && nearby.type === 'water_source' && nearby.dist <= 15) {
        const result = tryDrinkWater(agentId, self.x, self.y);
        actionType = result.success ? 'drink_success' : 'drink_failed';
        if (result.success) {
          notifyWitnesses(
            agentId, self.x, self.y,
            'Bebi daquela fonte de agua e senti algo mudar em mim.',
            (name) => `Vi ${name} beber daquela fonte de agua.`
          );
        } else {
          notifyWitnesses(
            agentId, self.x, self.y,
            result.reason === 'limit_reached' ? 'Tentei beber agua de novo, mas parece que ja bebi o suficiente por agora.' : 'Tentei beber agua, mas nao havia fonte por perto.',
            (name) => `Vi ${name} tentar beber agua sem sucesso.`
          );
        }
      } else {
        const bagResult = tryDrinkFromBag(agentId);
        if (bagResult.success) {
          actionType = 'drink_success';
          notifyWitnesses(
            agentId, self.x, self.y,
            'Bebi da agua que eu tinha guardado comigo.',
            (name) => `Vi ${name} beber de algo que carregava.`
          );
        } else if (nearby && nearby.type === 'water_source') {
          moveTowards(agentId, nearby.x, nearby.y, 6);
          moved = true;
          actionType = 'walk';
        } else {
          actionType = 'observe';
        }
      }
      break;
    }
    case 'fish': {
      const self = loadState(agentId);
      const nearby = findNearbyResource(self.x, self.y);
      if (nearby && nearby.type === 'water_source' && nearby.dist <= 15) {
        const result = tryFish(agentId, self.x, self.y);
        actionType = result.success ? 'fish_success' : 'fish_failed';
        if (result.success) {
          notifyWitnesses(
            agentId, self.x, self.y,
            `Consegui pescar algo naquela agua (era ${result.stage}). A sensacao de vazio diminuiu.`,
            (name) => `Vi ${name} pescar algo naquela agua.`
          );
        } else {
          const reasonText = result.reason === 'no_harpoon'
            ? 'Tentei pescar, mas nao tinha nada apropriado comigo para isso.'
            : result.reason === 'no_fish'
            ? 'Tentei pescar, mas nao havia nada para pescar naquele momento.'
            : 'Tentei pescar, mas nao estava perto o suficiente da agua.';
          notifyWitnesses(
            agentId, self.x, self.y,
            reasonText,
            (name) => `Vi ${name} tentar pescar sem sucesso.`
          );
        }
      } else if (nearby && nearby.type === 'water_source') {
        moveTowards(agentId, nearby.x, nearby.y, 6);
        moved = true;
        actionType = 'walk';
      } else {
        actionType = 'observe';
      }
      break;
    }
    case 'craft': {
      const self = loadState(agentId);
      const itemKey = intention.craft_item;
      if (!itemKey || !RECIPES[itemKey]) {
        actionType = 'observe';
        break;
      }
      const result = tryCraft(agentId, itemKey);
      actionType = result.success ? 'craft_success' : 'craft_failed';
      if (result.success) {
        if (result.kind === 'structure') {
          const typeByItem: Record<string, string> = { cerca: 'fence', muro_pedra: 'stone_wall', telhado_pedra: 'stone_roof' };
          const colorByItem: Record<string, string> = { cerca: '#8b5a2b', muro_pedra: '#7f8c8d', telhado_pedra: '#6b6b6b' };
          db.prepare(
            `INSERT INTO world_objects (created_by, type, x, y, color, label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).run(agentId, typeByItem[itemKey] ?? 'structure', self.x, self.y, colorByItem[itemKey] ?? '#888', itemKey, Date.now());
          broadcastFullState();
        }
        notifyWitnesses(
          agentId, self.x, self.y,
          `Consegui montar algo novo (${itemKey}) a partir do que eu tinha guardado.`,
          (name) => `Vi ${name} montar algo novo a partir do que tinha guardado.`
        );
      } else {
        notifyWitnesses(
          agentId, self.x, self.y,
          `Tentei montar algo (${itemKey}), mas nao tinha os materiais certos guardados.`,
          (name) => `Vi ${name} tentar montar algo sem ter os materiais certos.`
        );
      }
      break;
    }
    case 'attack': {
      const self = loadState(agentId);
      if (!otherId) {
        actionType = 'observe';
        break;
      }
      const distToOther = distanceBetween(agentId, otherId);
      if (distToOther > 15) {
        const other = loadState(otherId);
        moveTowards(agentId, other.x, other.y, 6);
        moved = true;
        actionType = 'walk';
        break;
      }
      if (!canAttack(agentId)) {
        actionType = 'attack_on_cooldown';
        break;
      }
      const damage = computeAttackDamage(agentId, otherId);
      registerAttack(agentId);
      const otherState = loadState(otherId);
      const newHp = Math.max(0, (otherState as any).hp - damage);
      const newStatus = newHp <= 0 ? 'dead' : otherState.status;
      db.prepare(`UPDATE agent_state SET hp = ?, status = ? WHERE agent_id = ?`).run(newHp, newStatus, otherId);
      actionType = 'attack_success';

      notifyWitnesses(
        agentId, self.x, self.y,
        `Ataquei ${AGENT_NAMES[otherId] ?? otherId} e causei dano.`,
        (name) => `Vi ${name} atacar alguem.`
      );
      notifyWitnesses(
        otherId, otherState.x, otherState.y,
        `Fui atacado por ${AGENT_NAMES[agentId] ?? agentId} e sofri dano.`,
        (name) => `Vi ${name} ser atacado.`
      );

      if (newStatus === 'dead') {
        const alreadyMarked = db.prepare(
          `SELECT id FROM world_objects WHERE type = 'corpse' AND created_by = ? LIMIT 1`
        ).get(otherId);
        if (!alreadyMarked) {
          const AGENT_COLORS_LOCAL: Record<string, string> = { blue: '#3498db', red: '#e74c3c', green: '#2ecc71' };
          db.prepare(
            `INSERT INTO world_objects (created_by, type, x, y, color, label, created_at) VALUES (?, 'corpse', ?, ?, ?, ?, ?)`
          ).run(otherId, otherState.x, otherState.y, AGENT_COLORS_LOCAL[otherId] ?? '#888', `restos de ${AGENT_NAMES[otherId] ?? otherId}`, Date.now());

          const { recordDiaryEntry } = require('./worldDiary');
          recordDiaryEntry(`${AGENT_NAMES[otherId] ?? otherId} foi morto por ${AGENT_NAMES[agentId] ?? agentId}.`, 'CONFLITO');
        }
      }

      broadcastFullState();
      break;
    }
    case 'equip': {
      const self = loadState(agentId);
      if (!intention.item_key) {
        actionType = 'observe';
        break;
      }
      const result = tryEquip(agentId, intention.item_key);
      actionType = result.success ? 'equip_success' : 'equip_failed';
      break;
    }
    case 'unequip': {
      const slot = (intention.equip_slot as 'hand' | 'clothes') || 'hand';
      tryUnequip(agentId, slot);
      actionType = 'unequip_success';
      break;
    }
    case 'drop': {
      if (!intention.item_key) {
        actionType = 'observe';
        break;
      }
      const result = tryDrop(agentId, intention.item_key);
      actionType = result.success ? 'drop_success' : 'drop_failed';
      break;
    }
    case 'give': {
      const self = loadState(agentId);
      if (!otherId || !intention.item_key) {
        actionType = 'observe';
        break;
      }
      const other = loadState(otherId);
      const dist = distanceBetween(agentId, otherId);
      if (dist > 20) {
        moveTowards(agentId, other.x, other.y, 6);
        moved = true;
        actionType = 'walk';
        break;
      }
      const result = tryGiveItem(agentId, otherId, intention.item_key, self.x, self.y, other.x, other.y);
      actionType = result.success ? 'give_success' : 'give_failed';
      if (result.success) {
        notifyWitnesses(
          agentId, self.x, self.y,
          `Dei ${intention.item_key} para ${AGENT_NAMES[otherId] ?? otherId}.`,
          (name) => `Vi ${name} dar algo para outra entidade.`
        );
      }
      break;
    }
    case 'observe': {
      actionType = 'observe';
      break;
    }
    case 'rest': {
      actionType = 'wait';
      break;
    }
  }

  const state = loadState(agentId);
  if (moved) {
    broadcastEvent({
      type: 'agent_tick',
      agentId,
      speech: null,
      thought: null,
      emotion: state.emotion,
      action: { type: 'walk', x: state.x, y: state.y },
    });
  }

  return { acted: true, goalType: intention.goal_type };
}
