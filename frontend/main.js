const WORLD_SIZE = 600;
const isSecure = location.protocol === 'https:';
const WS_URL = isSecure
  ? 'wss://' + location.host + '/ws'
  : 'ws://' + location.hostname + ':4001';

const app = new PIXI.Application({ width: WORLD_SIZE, height: WORLD_SIZE, backgroundColor: 0xffffff });
document.getElementById('app').appendChild(app.view);

const worldLayer = new PIXI.Container();
const agentLayer = new PIXI.Container();
const bubbleLayer = new PIXI.Container();
app.stage.addChild(worldLayer);
app.stage.addChild(agentLayer);
app.stage.addChild(bubbleLayer);

const border = new PIXI.Graphics();
border.lineStyle(2, 0x000000).drawRect(0, 0, WORLD_SIZE, WORLD_SIZE);
app.stage.addChildAt(border, 0);

const CENTER = WORLD_SIZE / 2;
const WORLD_SCALE = 3.2;
const MIN_AGENT_DISTANCE = 40;

const agentSprites = {};
const speechBubbles = {};
const worldObjectSprites = {};

function worldToScreen(x, y) {
  return { sx: CENTER + x * WORLD_SCALE, sy: CENTER + y * WORLD_SCALE };
}

function createAgentSprite(agentId, color) {
  if (agentSprites[agentId]) return agentSprites[agentId];
  const circle = new PIXI.Graphics();
  circle.beginFill(color).lineStyle(2, 0xffffff).drawCircle(0, 0, 12).endFill();
  agentLayer.addChild(circle);
  agentSprites[agentId] = circle;
  return circle;
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

function renderWorldObjects(objects) {
  worldLayer.removeChildren();

  objects.forEach(obj => {
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
        const tree = new PIXI.Graphics();
        tree.beginFill(0x1e5631, 0.9).lineStyle(1, 0x0f2e1a);
        tree.moveTo(0, -12).lineTo(8, 6).lineTo(-8, 6).closePath();
        tree.endFill();
        tree.x = sx;
        tree.y = sy;
        worldLayer.addChild(tree);
        return;
      }
      if (obj.type === 'rock') {
        const rock = new PIXI.Graphics();
        rock.beginFill(0x7f8c8d, 0.9).lineStyle(1, 0x4d5656);
        rock.moveTo(-8, 4).lineTo(-4, -6).lineTo(4, -7).lineTo(9, 3).lineTo(2, 7).closePath();
        rock.endFill();
        rock.x = sx;
        rock.y = sy;
        worldLayer.addChild(rock);
        return;
      }
      if (obj.type === 'water_source') {
        const water = new PIXI.Graphics();
        water.beginFill(0x3498db, 0.7).lineStyle(1, 0x1f618d);
        water.drawCircle(0, 0, 9);
        water.endFill();
        water.x = sx;
        water.y = sy;
        worldLayer.addChild(water);
        return;
      }
      if (obj.type === 'grass_patch') {
        const grass = new PIXI.Graphics();
        grass.beginFill(0x27ae60, 0.85).lineStyle(1, 0x1e8449);
        const s = 9;
        grass.moveTo(0, -s).lineTo(s, 0).lineTo(0, s).lineTo(-s, 0).closePath();
        grass.endFill();
        grass.x = sx;
        grass.y = sy;
        worldLayer.addChild(grass);
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
      fontFamily: 'Arial', fontSize: 13, fill: 0x888888, fontStyle: 'italic',
    });
    const isNearTop = sprite.y < 30;
    label.anchor.set(0.5, isNearTop ? 0 : 1);
    label.x = 0;
    label.y = isNearTop ? 20 : -16;
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
  bg.beginFill(0xffffff, 0.95).lineStyle(1, 0x000000)
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
  updateDiaryPanel(msg.diary);
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
    const isDead = s.status === 'dead';
    const color = colorMap[s.agent_id] || '#888';
    const label = isDead ? '(morto)' : `${hunger}% saciado`;
    return `<span style="color:${color};">${name}</span>: ${label}`;
  }).join(' &nbsp;|&nbsp; ');
}

function updateDiaryPanel(diary) {
  const el = document.getElementById('diary-panel');
  if (!el || !diary) return;
  if (diary.length === 0) {
    el.innerHTML = '<em style="color:#666;">Nenhum evento registrado ainda.</em>';
    return;
  }
  el.innerHTML = diary.map(entry => `<div style="margin-bottom:6px;"><strong>Dia ${entry.day}</strong> — ${entry.content}</div>`).join('');
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

connect();
