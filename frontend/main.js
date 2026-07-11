const WORLD_SIZE = 600;
const WS_URL = 'ws://' + location.hostname + ':4001';

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

function updateAgentPosition(agentId, x, y) {
  const sprite = agentSprites[agentId];
  if (!sprite) return;

  const otherId = agentId === 'blue' ? 'red' : 'blue';
  const otherSprite = agentSprites[otherId];

  let { sx, sy } = worldToScreen(x, y);

  if (otherSprite) {
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
  }

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

      if (obj.label) {
        const label = new PIXI.Text(obj.label, { fontFamily: 'Arial', fontSize: 8, fill: 0x555555 });
        label.anchor.set(0.5, 0);
        label.x = sx;
        label.y = sy + size + 2;
        worldLayer.addChild(label);
      }
    } catch (err) {
      console.error('[renderWorldObjects] falha ao desenhar objeto', obj, err);
    }
  });
}

function showSpeechBubble(agentId, text) {
  if (speechBubbles[agentId]) {
    bubbleLayer.removeChild(speechBubbles[agentId]);
    delete speechBubbles[agentId];
  }
  const sprite = agentSprites[agentId];
  if (!sprite || !text) return;

  const container = new PIXI.Container();

  const label = new PIXI.Text(text, {
    fontFamily: 'Arial', fontSize: 11, fill: 0x000000,
    wordWrap: true, wordWrapWidth: 140, align: 'center',
  });
  label.anchor.set(0.5, 0.5);

  const padding = 8;
  const bg = new PIXI.Graphics();
  bg.beginFill(0xffffff, 0.95).lineStyle(1, 0x000000)
    .drawRoundedRect(-label.width / 2 - padding, -label.height / 2 - padding, label.width + padding * 2, label.height + padding * 2, 6)
    .endFill();

  container.addChild(bg);
  container.addChild(label);

  const bubbleHeight = label.height + padding * 2;
  const bubbleWidth = label.width + padding * 2;
  const horizontalOffset = agentId === 'blue' ? -bubbleWidth / 2 - 10 : bubbleWidth / 2 + 10;
  let targetX = sprite.x + horizontalOffset;
  targetX = Math.max(bubbleWidth / 2 + 5, Math.min(WORLD_SIZE - bubbleWidth / 2 - 5, targetX));
  container.x = targetX;
  container.y = Math.max(bubbleHeight / 2 + 5, sprite.y - 20 - bubbleHeight / 2);

  bubbleLayer.addChild(container);
  speechBubbles[agentId] = container;

  setTimeout(() => {
    if (speechBubbles[agentId] === container) {
      bubbleLayer.removeChild(container);
      delete speechBubbles[agentId];
    }
  }, 9000);
}

function applyFullState(msg) {
  msg.agents.forEach(agent => {
    createAgentSprite(agent.id, hexToNumber(agent.color));
  });
  msg.states.forEach(state => {
    updateAgentPosition(state.agent_id, state.x, state.y);
  });
  renderWorldObjects(msg.objects || []);

  if (msg.lastSpeeches) {
    Object.entries(msg.lastSpeeches).forEach(([agentId, data]) => {
      const ageMs = Date.now() - data.createdAt;
      if (ageMs < 20 * 60 * 1000) {
        showSpeechBubble(agentId, data.text);
      }
    });
  }
}

function connect() {
  const ws = new WebSocket(WS_URL);

  ws.onopen = () => console.log('[ws] conectado');
  ws.onclose = () => {
    console.log('[ws] desconectado, tentando reconectar em 3s...');
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

    if (msg.type === 'agent_tick') {
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
    }
  };
}

connect();
