const WORLD_SIZE = 600;
const isSecure = location.protocol === 'https:';
const WS_URL = isSecure
  ? 'wss://' + location.host + '/ws'
  : 'ws://' + location.hostname + ':4001';

const app = new PIXI.Application({ width: WORLD_SIZE, height: WORLD_SIZE, backgroundColor: 0xffffff });
document.getElementById('app').appendChild(app.view);

const ASSET_PATHS = {
  ground: 'assets/ground.jpg',
  tree: 'assets/tree.png',
  grass: 'assets/grass.png',
  water: 'assets/water.png',
  agent_blue: 'assets/agent_blue.png',
  agent_red: 'assets/agent_red.png',
  agent_green: 'assets/agent_green.png',
  wolf: 'assets/wolf.png',
  rodent: 'assets/rodent.png',
};

const assetTextures = {};
let assetsReady = false;

async function loadAssets() {
  for (const [key, path] of Object.entries(ASSET_PATHS)) {
    try {
      assetTextures[key] = await PIXI.Assets.load(path);
    } catch (e) {
      console.error('[assets] falha ao carregar', path, e);
    }
  }
  assetsReady = true;

  if (assetTextures.ground) {
    const groundSprite = new PIXI.Sprite(assetTextures.ground);
    groundSprite.width = WORLD_SIZE;
    groundSprite.height = WORLD_SIZE;
    app.stage.addChildAt(groundSprite, 0);
  }
}
loadAssets().then(() => connect());

const worldLayer = new PIXI.Container();
const agentLayer = new PIXI.Container();
agentLayer.sortableChildren = true;
const wolfLayer = new PIXI.Container();
const rodentLayer = new PIXI.Container();
const bubbleLayer = new PIXI.Container();
app.stage.addChild(worldLayer);
app.stage.addChild(rodentLayer);
app.stage.addChild(wolfLayer);
app.stage.addChild(agentLayer);
app.stage.addChild(bubbleLayer);

const border = new PIXI.Graphics();
border.lineStyle(2, 0x000000).drawRect(0, 0, WORLD_SIZE, WORLD_SIZE);
app.stage.addChildAt(border, 0);

const CENTER = WORLD_SIZE / 2;
const WORLD_SCALE = 1.8;
const MIN_AGENT_DISTANCE = 40;

const agentSprites = {};
const speechBubbles = {};
const worldObjectSprites = {};

function worldToScreen(x, y) {
  return { sx: CENTER + x * WORLD_SCALE, sy: CENTER + y * WORLD_SCALE };
}

function createAgentSprite(agentId, color) {
  if (agentSprites[agentId]) return agentSprites[agentId];

  const assetKey = 'agent_' + agentId;
  let sprite;

  if (assetTextures[assetKey]) {
    sprite = new PIXI.Sprite(assetTextures[assetKey]);
    sprite.anchor.set(0.5);
    sprite.width = 73;
    sprite.height = 73;
  } else {
    sprite = new PIXI.Graphics();
    sprite.beginFill(color).lineStyle(2, 0xffffff).drawCircle(0, 0, 12).endFill();
  }

  agentLayer.addChild(sprite);
  agentSprites[agentId] = sprite;
  return sprite;
}

const lastRealUpdate = {};

function updateAgentPosition(agentId, x, y) {
  lastRealUpdate[agentId] = Date.now();
  const sprite = agentSprites[agentId];
  if (!sprite) return;

  let { sx, sy } = worldToScreen(x, y);

  Object.keys(agentSprites).forEach(otherId => {
    if (otherId === agentId) return;
    const otherSprite = agentSprites[otherId];
    if (!otherSprite) return;
    const dx = sx - otherSprite.x;
    const dy = sy - otherSprite.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < MIN_AGENT_DISTANCE && dist > 0) {
      const pushFactor = (MIN_AGENT_DISTANCE - dist) / dist;
      sx += dx * pushFactor;
      sy += dy * pushFactor;
    } else if (dist === 0) {
      sx += MIN_AGENT_DISTANCE;
    }
  });


  sx = Math.max(15, Math.min(WORLD_SIZE - 15, sx));
  sy = Math.max(15, Math.min(WORLD_SIZE - 15, sy));

  sprite.x = sx;
  sprite.y = sy;
  sprite.zIndex = sy;
}

const COLOR_NAMES = {
  red: 0xe74c3c, vermelho: 0xe74c3c, darkred: 0x8b0000,
  blue: 0x3498db, azul: 0x3498db,
  green: 0x2ecc71, verde: 0x2ecc71,
  yellow: 0xf1c40f, amarelo: 0xf1c40f,
  purple: 0x9b59b6, roxo: 0x9b59b6,
  orange: 0xe67e22, laranja: 0xe67e22,
  black: 0x222222, preto: 0x222222,
  white: 0xffffff, branco: 0xffffff,
  gray: 0x888888, grey: 0x888888, cinza: 0x888888,
  gold: 0xd4af37, dourado: 0xd4af37,
  pink: 0xff69b4, rosa: 0xff69b4,
  transparent: 0xcccccc, transparente: 0xcccccc,
};

function hexToNumber(color) {
  if (!color) return 0x888888;
  const trimmed = color.trim().toLowerCase();
  if (trimmed.startsWith('#')) {
    const parsed = parseInt(trimmed.replace('#', ''), 16);
    return isNaN(parsed) ? 0x888888 : parsed;
  }
  return COLOR_NAMES[trimmed] ?? 0x888888;
}

function shapeCategory(type) {
  const t = (type || '').toLowerCase();
  if (['circle', 'círculo', 'circulo', 'sphere', 'esfera', 'octagon', 'octógono'].some(k => t.includes(k))) return 'circle';
  if (['triangle', 'triângulo', 'triangulo'].some(k => t.includes(k))) return 'triangle';
  if (['star', 'estrela'].some(k => t.includes(k))) return 'star';
  if (['spiral', 'espiral', 'line', 'linha'].some(k => t.includes(k))) return 'line';
  if (['pilar', 'pillar', 'column', 'coluna'].some(k => t.includes(k))) return 'pillar';
  if (['square', 'quadrado', 'rectangle', 'retângulo', 'retangulo', 'block', 'bloco', 'wall', 'muro',
       'barrier', 'barreira', 'hexagon', 'hexágono', 'hexagono'].some(k => t.includes(k))) return 'square';
  return 'square';
}

const positionJitter = {};
function getJitteredPos(obj) {
  const key = `${obj.x.toFixed(1)}_${obj.y.toFixed(1)}`;
  if (!positionJitter[key]) positionJitter[key] = [];
  const list = positionJitter[key];
  let idx = list.indexOf(obj.id);
  if (idx === -1) {
    idx = list.length;
    list.push(obj.id);
  }
  if (idx === 0) return { x: obj.x, y: obj.y };
  const angle = (idx * 2.4) % (Math.PI * 2);
  const radius = 6 + Math.floor(idx / 6) * 6;
  return { x: obj.x + Math.cos(angle) * radius, y: obj.y + Math.sin(angle) * radius };
}

function drawStarShape(g, points, outerRadius) {
  const innerRadius = outerRadius * 0.45;
  const step = Math.PI / points;
  const path = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = i * step - Math.PI / 2;
    path.push(Math.cos(angle) * r, Math.sin(angle) * r);
  }
  g.drawPolygon(path);
}

const rodentSprites = {};

function renderRodents(rodents) {
  const currentIds = new Set(rodents.map(r => r.id));

  Object.keys(rodentSprites).forEach(id => {
    if (!currentIds.has(Number(id))) {
      rodentLayer.removeChild(rodentSprites[id]);
      delete rodentSprites[id];
    }
  });

  rodents.forEach(r => {
    const { sx, sy } = worldToScreen(r.x, r.y);
    let sprite = rodentSprites[r.id];

    if (!sprite) {
      if (assetTextures.rodent) {
        sprite = new PIXI.Sprite(assetTextures.rodent);
        sprite.anchor.set(0.5);
        sprite.width = 18;
        sprite.height = 18;
      } else {
        sprite = new PIXI.Graphics();
        sprite.beginFill(0x8b6f47).lineStyle(1, 0x4a3a26).drawCircle(0, 0, 5).endFill();
      }
      rodentLayer.addChild(sprite);
      rodentSprites[r.id] = sprite;
    }

    sprite.x = sx;
    sprite.y = sy;
    sprite.zIndex = sy;
  });
}

const wolfSprites = {};

function renderWolves(wolves) {
  const currentIds = new Set(wolves.map(w => w.id));

  Object.keys(wolfSprites).forEach(id => {
    if (!currentIds.has(Number(id))) {
      wolfLayer.removeChild(wolfSprites[id]);
      delete wolfSprites[id];
    }
  });

  wolves.forEach(w => {
    let { sx, sy } = worldToScreen(w.x, w.y);
    wolves.forEach(other => {
      if (other.id === w.id) return;
      const otherPos = worldToScreen(other.x, other.y);
      const dx = sx - otherPos.sx;
      const dy = sy - otherPos.sy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const MIN_WOLF_DISTANCE = 20;
      if (dist < MIN_WOLF_DISTANCE && dist > 0) {
        const pushFactor = (MIN_WOLF_DISTANCE - dist) / dist;
        sx += dx * pushFactor;
        sy += dy * pushFactor;
      } else if (dist === 0) {
        sx += MIN_WOLF_DISTANCE;
      }
    });
    let sprite = wolfSprites[w.id];

    if (!sprite) {
      if (assetTextures.wolf) {
        sprite = new PIXI.Sprite(assetTextures.wolf);
        sprite.anchor.set(0.5);
        sprite.width = 32;
        sprite.height = 32;
      } else {
        sprite = new PIXI.Graphics();
        sprite.beginFill(0x555555).lineStyle(2, 0x222222).drawCircle(0, 0, 10).endFill();
      }
      wolfLayer.addChild(sprite);
      wolfSprites[w.id] = sprite;
    }

    sprite.x = sx;
    sprite.y = sy;
    sprite.zIndex = sy;

    const hpRatio = w.hp / (w.max_hp || 20);
    sprite.alpha = 0.5 + hpRatio * 0.5;
  });
}

function renderWorldObjects(objects) {
  worldLayer.removeChildren();
  const sortedObjects = [...objects].sort((a, b) => a.y - b.y);

  sortedObjects.forEach(obj => {
    try {
      const jpos = getJitteredPos(obj);
      const { sx, sy } = worldToScreen(jpos.x, jpos.y);
      const color = hexToNumber(obj.color);

      if (obj.type === 'drawing') {
        let points = [];
        try {
          const meta = JSON.parse(obj.metadata || '{}');
          points = meta.points || [];
        } catch (e) {}
        if (points.length > 1) {
          const line = new PIXI.Graphics();
          line.lineStyle(3, color, 0.9);
          const first = worldToScreen(points[0].x, points[0].y);
          line.moveTo(first.sx, first.sy);
          for (let i = 1; i < points.length; i++) {
            const p = worldToScreen(points[i].x, points[i].y);
            line.lineTo(p.sx, p.sy);
          }
          worldLayer.addChild(line);
        }
        return;
      }

      if (obj.type === 'tree') {
        if (assetTextures.tree) {
          const tree = new PIXI.Sprite(assetTextures.tree);
          tree.anchor.set(0.5, 1);
          tree.width = 96;
          tree.height = 96;
          tree.x = sx;
          tree.y = sy;
          worldLayer.addChild(tree);
        }
        return;
      }
      if (obj.type === 'rock') {
        const rock = new PIXI.Text('🪨', { fontSize: 14 });
        rock.anchor.set(0.5);
        rock.x = sx;
        rock.y = sy;
        worldLayer.addChild(rock);
        return;
      }
      if (obj.type === 'water_source') {
        if (assetTextures.water) {
          const water = new PIXI.Sprite(assetTextures.water);
          water.anchor.set(0.5);
          water.width = 84;
          water.height = 84;
          water.x = sx;
          water.y = sy;
          worldLayer.addChild(water);
        }
        return;
      }
      if (obj.type === 'grass_patch') {
        if (assetTextures.grass) {
          const grass = new PIXI.Sprite(assetTextures.grass);
          grass.anchor.set(0.5);
          const stageScale = { seed: 0.4, sprout: 0.6, young: 0.8, adult: 1.0 };
          const scale = stageScale[obj.stage] || 0.5;
          grass.width = 28 * scale;
          grass.height = 28 * scale;
          grass.x = sx;
          grass.y = sy;
          worldLayer.addChild(grass);
        }
        return;
      }
      if (obj.type === 'text') {
        const text = new PIXI.Text(obj.label || '', {
          fontFamily: 'Arial', fontSize: 12, fill: 0x000000, fontStyle: 'italic',
        });
        text.anchor.set(0.5);
        text.x = sx;
        text.y = sy;
        worldLayer.addChild(text);
        return;
      }

      if (obj.type === 'wood_piece' || obj.type === 'stone_piece') {
        const isWood = obj.type === 'wood_piece';
        const piece = new PIXI.Graphics();
        piece.beginFill(isWood ? 0x8b5a2b : 0x7f8c8d, 0.9).lineStyle(1, isWood ? 0x5a3a1a : 0x4d5656);
        piece.drawRoundedRect(-10, -5, 20, 10, 2);
        piece.endFill();
        piece.x = sx;
        piece.y = sy;
        worldLayer.addChild(piece);
        return;
      }
      const category = shapeCategory(obj.type);
      const shape = new PIXI.Graphics();
      shape.beginFill(color, 0.85).lineStyle(1.5, 0x000000);
      const size = 10;

      switch (category) {
        case 'circle':
          shape.drawCircle(0, 0, size);
          break;
        case 'triangle':
          shape.drawPolygon([0, -size, size, size, -size, size]);
          break;
        case 'star':
          drawStarShape(shape, 5, size);
          break;
        case 'line':
          shape.moveTo(-size, 0).lineTo(size, 0);
          break;
        case 'pillar':
          shape.drawRect(-size * 0.4, -size, size * 0.8, size * 2);
          break;
        case 'square':
        default:
          shape.drawRect(-size, -size, size * 2, size * 2);
      }
      shape.endFill();
      shape.x = sx;
      shape.y = sy;
      worldLayer.addChild(shape);

      // labels ocultos por padrao para reduzir poluicao visual (Fase 1)
    } catch (err) {
      console.error('[renderWorldObjects] falha ao desenhar objeto', obj, err);
    }
  });
}

const sleepIndicators = {};
const deadAgents = new Set();

function markAgentDead(agentId) {
  const sprite = agentSprites[agentId];
  if (!sprite) return;
  if (deadAgents.has(agentId)) return;
  deadAgents.add(agentId);

  if (sleepIndicators[agentId]) {
    sprite.removeChild(sleepIndicators[agentId]);
    delete sleepIndicators[agentId];
  }

  sprite.tint = 0x555555;
  sprite.alpha = 0.6;

  const marker = new PIXI.Text('†', {
    fontFamily: 'Arial', fontSize: 16, fill: 0x222222,
  });
  marker.anchor.set(0.5, 1);
  marker.x = 0;
  marker.y = -14;
  sprite.addChild(marker);
}


function setSleepIndicator(agentId, resting) {
  const sprite = agentSprites[agentId];
  if (!sprite) return;

  if (resting) {
    if (sleepIndicators[agentId]) return;
    const label = new PIXI.Text('Zzz', {
      fontFamily: 'Arial', fontSize: 16, fill: 0xffffff, fontStyle: 'italic', fontWeight: 'bold', stroke: 0x000000, strokeThickness: 3,
    });
    const scaleY = sprite.scale.y || 1;
    const isNearTop = sprite.y < 30;
    label.anchor.set(0.5, isNearTop ? 0 : 1);
    label.x = 0;
    label.y = (isNearTop ? 25 : -25) / scaleY;
    label.scale.set(1 / scaleY, 1 / (sprite.scale.x || 1));
    label.alpha = 0.5;
    sprite.addChild(label);
    sleepIndicators[agentId] = label;
  } else {
    if (sleepIndicators[agentId]) {
      sprite.removeChild(sleepIndicators[agentId]);
      delete sleepIndicators[agentId];
    }
  }
}

function showSpeechBubble(agentId, text) {
  if (speechBubbles[agentId]) {
    bubbleLayer.removeChild(speechBubbles[agentId]);
    delete speechBubbles[agentId];
  }
  const sprite = agentSprites[agentId];
  if (!sprite || !text) return;

  const container = new PIXI.Container();

  const label = new PIXI.Text('', {
    fontFamily: 'Arial', fontSize: 11, fill: 0x000000,
    wordWrap: true, wordWrapWidth: 140, align: 'center',
  });
  label.anchor.set(0.5, 0.5);

  const measurer = new PIXI.Text(text, {
    fontFamily: 'Arial', fontSize: 11, fill: 0x000000,
    wordWrap: true, wordWrapWidth: 140, align: 'center',
  });
  const finalWidth = measurer.width;
  const finalHeight = measurer.height;
  measurer.destroy();

  const padding = 8;
  const bubbleWidth = finalWidth + padding * 2;
  const bubbleHeight = finalHeight + padding * 2;

  const bg = new PIXI.Graphics();
  bg.beginFill(0xffffff, 0.5).lineStyle(1, 0x000000)
    .drawRoundedRect(-bubbleWidth / 2, -bubbleHeight / 2, bubbleWidth, bubbleHeight, 6)
    .endFill();

  container.addChild(bg);
  container.addChild(label);

  const horizontalOffset = sprite.x < WORLD_SIZE / 2 ? -bubbleWidth / 2 - 10 : bubbleWidth / 2 + 10;
  let targetX = sprite.x + horizontalOffset;
  targetX = Math.max(bubbleWidth / 2 + 5, Math.min(WORLD_SIZE - bubbleWidth / 2 - 5, targetX));
  container.x = targetX;
  container.y = Math.max(bubbleHeight / 2 + 5, sprite.y - 20 - bubbleHeight / 2);

  bubbleLayer.addChild(container);
  speechBubbles[agentId] = container;

  let charIndex = 0;
  const charsPerTick = 2;
  const typeInterval = setInterval(() => {
    if (speechBubbles[agentId] !== container) {
      clearInterval(typeInterval);
      return;
    }
    charIndex += charsPerTick;
    label.text = text.slice(0, charIndex);
    if (charIndex >= text.length) {
      clearInterval(typeInterval);
    }
  }, 35);

  setTimeout(() => {
    if (speechBubbles[agentId] === container) {
      clearInterval(typeInterval);
      bubbleLayer.removeChild(container);
      delete speechBubbles[agentId];
    }
  }, Math.max(9000, text.length * 60));
}
let hasBackfilledLog = false;

function applyFullState(msg) {
  msg.agents.forEach(agent => {
    createAgentSprite(agent.id, hexToNumber(agent.color));
  });
  msg.states.forEach(state => {
    updateAgentPosition(state.agent_id, state.x, state.y);
    if (state.status === 'dead') {
      markAgentDead(state.agent_id);
    }
  });
  updateHungerStatus(msg.states, msg.agents);
  updateInventoryStatus(msg.states, msg.items, msg.agents);
  updateSleepCycleStatus(msg.sleepCycles, msg.agents);
  updateDiaryPanel(msg.diary);
  renderWolves(msg.wolves || []);
  renderRodents(msg.rodents || []);
  if (msg.resting) {
    Object.entries(msg.resting).forEach(([agentId, isResting]) => {
      setSleepIndicator(agentId, isResting);
    });
  }
  renderWorldObjects(msg.objects || []);

  if (msg.lastSpeeches) {
    Object.entries(msg.lastSpeeches).forEach(([agentId, data]) => {
      const ageMs = Date.now() - data.createdAt;
      if (ageMs < 20 * 60 * 1000) {
        showSpeechBubble(agentId, data.text);
      }
      if (!hasBackfilledLog) { addLogEntry(agentId, data.text, null); }
    });
  }
    hasBackfilledLog = true;
}

const AGENT_NAMES = { blue: 'Azul', red: 'Vermelho', green: 'Verde' };

function updateHungerStatus(states, agents) {
  const el = document.getElementById('hunger-status');
  if (!el || !states) return;
  const colorMap = {};
  (agents || []).forEach(a => { colorMap[a.id] = a.color; });
  el.innerHTML = states.map(s => {
    const name = AGENT_NAMES[s.agent_id] || s.agent_id;
    const hunger = typeof s.hunger === 'number' ? s.hunger.toFixed(0) : '?';
    const hp = typeof s.hp === 'number' ? s.hp.toFixed(0) : '100';
    const isDead = s.status === 'dead';
    const color = colorMap[s.agent_id] || '#888';
    const handLabel = s.equip_hand ? (ITEM_LABELS[s.equip_hand] || s.equip_hand) : 'mao vazia';
    const clothesLabel = s.equip_clothes ? (ITEM_LABELS[s.equip_clothes] || s.equip_clothes) : 'sem roupa';
    const equipText = isDead ? '' : ` | Mao: ${handLabel} | Corpo: ${clothesLabel}`;
    const label = isDead ? '(morto)' : `${hunger}% saciado, ${hp} HP${equipText}`;
    return `<div><span style="color:${color}; font-weight:bold;">${name}</span>: ${label}</div>`;
  }).join('');
}

const ITEM_LABELS = {
  wood: 'Madeira', stone: 'Pedra', water: 'Agua', fiber: 'Fibra',
  corda: 'Corda', vara_pesca: 'Vara de pesca', harpao: 'Harpao', faca: 'Faca',
  machado: 'Machado', lanca: 'Lanca', tocha: 'Tocha', cesto: 'Cesto',
};

function updateSleepCycleStatus(sleepCycles, agents) {
  const el = document.getElementById('sleep-cycle-status');
  if (!el || !sleepCycles) return;
  const colorMap = {};
  (agents || []).forEach(a => { colorMap[a.id] = a.color; });

  const title = '<div style="color:#777; font-weight:bold; margin-bottom:2px;">Ciclo de sono:</div>';
  const rows = sleepCycles.map(s => {
    const name = AGENT_NAMES[s.agent_id] || s.agent_id;
    const color = colorMap[s.agent_id] || '#888';
    const time = new Date(s.occurred_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const label = s.event_type === 'sleep' ? `dormiu as ${time}` : `acordou as ${time}`;
    return `<div><span style="color:${color}; font-weight:bold;">${name}</span>: ${label}</div>`;
  });

  el.innerHTML = rows.length > 0 ? title + rows.join('') : '';
}

function updateInventoryStatus(states, items, agents) {
  const el = document.getElementById('inventory-status');
  if (!el || !states) return;
  const colorMap = {};
  (agents || []).forEach(a => { colorMap[a.id] = a.color; });
  const itemsByAgent = {};
  (items || []).forEach(it => {
    if (!itemsByAgent[it.agent_id]) itemsByAgent[it.agent_id] = [];
    itemsByAgent[it.agent_id].push(`${ITEM_LABELS[it.item_key] || it.item_key}: ${it.quantity}`);
  });
  const title = '<div style="color:#777; font-weight:bold; margin-bottom:2px;">Mochila:</div>';
  const rows = states.filter(s => s.status !== 'dead').map(s => {
    const name = AGENT_NAMES[s.agent_id] || s.agent_id;
    const color = colorMap[s.agent_id] || '#888';
    const parts = [];
    if (s.wood > 0) parts.push(`Madeira: ${s.wood}`);
    if (s.stone > 0) parts.push(`Pedra: ${s.stone}`);
    if (s.water > 0) parts.push(`Agua: ${s.water}`);
    if (s.fiber > 0) parts.push(`Fibra: ${s.fiber}`);
    const craftedItems = itemsByAgent[s.agent_id] || [];
    const allParts = parts.concat(craftedItems);
    const inventoryText = allParts.length > 0 ? allParts.join(', ') : 'vazio';
    return `<div><span style="color:${color}; font-weight:bold;">${name}</span>: ${inventoryText}</div>`;
  });
  el.innerHTML = title + rows.join('');
}

const DIARY_TAG_COLORS = {
  PRIMEIRO_ENCONTRO: '#3498db',
  ALIMENTACAO: '#2ecc71',
  CONSTRUCAO: '#e67e22',
  MORTE: '#7f8c8d',
  COOPERACAO: '#1abc9c',
  CONFLITO: '#e74c3c',
  TROCA: '#9b59b6',
  OUTRO: '#555',
};

function updateDiaryPanel(diary) {
  const el = document.getElementById('diary-panel');
  if (!el || !diary) return;
  if (diary.length === 0) {
    el.innerHTML = '<em style="color:#666;">Nenhum evento registrado ainda.</em>';
    return;
  }
  el.innerHTML = diary.map(entry => {
    const color = DIARY_TAG_COLORS[entry.tag] || DIARY_TAG_COLORS.OUTRO;
    const tagLabel = entry.tag && entry.tag !== 'OUTRO' ? `<span style="color:${color}; font-size:9px; border:1px solid ${color}; border-radius:3px; padding:0 4px; margin-right:4px;">${entry.tag}</span>` : '';
    return `<div style="margin-bottom:6px;"><strong>Dia ${entry.day}</strong> ${tagLabel}— ${entry.content}</div>`;
  }).join('');
}


function addLogEntry(agentId, speech, thought) {
  const container = document.getElementById('log-entries');
  if (!container) return;

  const entry = document.createElement('div');
  entry.className = 'entry ' + agentId;

  const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const name = AGENT_NAMES[agentId] || agentId;

  let html = '<span class="who">' + name + '</span><span class="time">' + time + '</span>';
  if (speech) html += '<div class="speech">' + speech + '</div>';
  if (thought) html += '<div class="thought">' + thought + '</div>';
  entry.innerHTML = html;

  container.appendChild(entry);
  while (container.children.length > 60) {
    container.removeChild(container.firstChild);
  }

  const panel = document.getElementById('log-panel');
  if (panel) panel.scrollTop = panel.scrollHeight;
}

function setLogStatus(text, connected) {
  const status = document.getElementById('log-status');
  if (!status) return;
  status.textContent = text;
  status.className = connected ? 'status' : 'status disconnected';
}

const WANDER_IDLE_THRESHOLD_MS = 6000;
const WANDER_STEP_PX = 4;

function idleWanderTick() {
  Object.keys(agentSprites).forEach(agentId => {
    const sprite = agentSprites[agentId];
    if (!sprite) return;
    if (sleepIndicators[agentId] || deadAgents.has(agentId)) return;

    const lastUpdate = lastRealUpdate[agentId] || 0;
    const idleFor = Date.now() - lastUpdate;
    if (idleFor < WANDER_IDLE_THRESHOLD_MS) return;

    const angle = Math.random() * Math.PI * 2;
    let newX = sprite.x + Math.cos(angle) * WANDER_STEP_PX;
    let newY = sprite.y + Math.sin(angle) * WANDER_STEP_PX;

    const tooClose = Object.keys(agentSprites).some(otherId => {
      if (otherId === agentId) return false;
      const otherSprite = agentSprites[otherId];
      if (!otherSprite) return false;
      const dx = newX - otherSprite.x;
      const dy = newY - otherSprite.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      return dist < MIN_AGENT_DISTANCE;
    });
    if (tooClose) return;


    newX = Math.max(15, Math.min(WORLD_SIZE - 15, newX));
    newY = Math.max(15, Math.min(WORLD_SIZE - 15, newY));

    sprite.x = newX;
    sprite.y = newY;
  });
}

setInterval(idleWanderTick, 1200);

function connect() {

  const ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log('[ws] conectado');
    setLogStatus('conectado, ao vivo', true);
  };
  ws.onclose = () => {
    console.log('[ws] desconectado, tentando reconectar em 3s...');
    setLogStatus('desconectado, tentando reconectar...', false);
    setTimeout(connect, 3000);
  };
  ws.onerror = (err) => console.error('[ws] erro:', err);

  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      console.error('[ws] mensagem invalida:', e);
      return;
    }

    if (msg.type === 'full_state') {
      applyFullState(msg);
    }

    if (msg.type === 'agent_status') {
      if (msg.reason === 'dead') {
        markAgentDead(msg.agentId);
      } else {
        setSleepIndicator(msg.agentId, msg.resting);
      }
    }
    if (msg.type === 'wolf_positions') {
      renderWolves(msg.wolves || []);
    }
    if (msg.type === 'rodent_positions') {
      renderRodents(msg.rodents || []);
    }
    if (msg.type === 'agent_tick') {
      setSleepIndicator(msg.agentId, false);
      const a = msg.action;

      if (a.type === 'walk' || a.type === 'move_object') {
        if (typeof a.x === 'number' && typeof a.y === 'number') {
          updateAgentPosition(msg.agentId, a.x, a.y);
        }
      }

      if (a.type === 'approach' || a.type === 'move_away') {
        const otherId = a.targetAgentId;
        const mySprite = agentSprites[msg.agentId];
        const otherSprite = agentSprites[otherId];
        if (mySprite && otherSprite) {
          const dx = otherSprite.x - mySprite.x;
          const dy = otherSprite.y - mySprite.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const step = a.type === 'approach' ? 20 : -20;
          const newX = mySprite.x + (dx / dist) * step - CENTER;
          const newY = mySprite.y + (dy / dist) * step - CENTER;
          const clampedX = Math.max(-CENTER + 15, Math.min(CENTER - 15, newX));
          const clampedY = Math.max(-CENTER + 15, Math.min(CENTER - 15, newY));
          updateAgentPosition(msg.agentId, clampedX, clampedY);
        }
      }

      if (msg.speech) {
        showSpeechBubble(msg.agentId, msg.speech);
      }
      if (msg.speech || msg.thought) {
        addLogEntry(msg.agentId, msg.speech, msg.thought);
      }
    }
  };
}

const diaryToggleBtn = document.getElementById('diary-toggle');
if (diaryToggleBtn) {
  diaryToggleBtn.addEventListener('click', () => {
    const panel = document.getElementById('diary-panel');
    if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });
}

const panelMinimizeBtn = document.getElementById('panel-minimize-toggle');
if (panelMinimizeBtn) {
  panelMinimizeBtn.addEventListener('click', () => {
    const collapsible = document.getElementById('panel-collapsible');
    if (!collapsible) return;
    const isHidden = collapsible.style.display === 'none';
    collapsible.style.display = isHidden ? 'block' : 'none';
    panelMinimizeBtn.textContent = isHidden ? '▲' : '▼';
  });
}


