const WORLD_SIZE = 600;
const WS_URL = 'ws://' + location.hostname + ':4001';

const app = new PIXI.Application({ width: WORLD_SIZE, height: WORLD_SIZE, backgroundColor: 0xffffff });
document.getElementById('app').appendChild(app.view);

const border = new PIXI.Graphics();
border.lineStyle(2, 0x000000).drawRect(0, 0, WORLD_SIZE, WORLD_SIZE);
app.stage.addChild(border);

const CENTER = WORLD_SIZE / 2;
const agentSprites = {};
const speechBubbles = {};

function worldToScreen(x, y) {
  return { sx: CENTER + x, sy: CENTER + y };
}

function createAgentSprite(agentId, color) {
  const circle = new PIXI.Graphics();
  circle.beginFill(color).drawCircle(0, 0, 12).endFill();
  app.stage.addChild(circle);
  agentSprites[agentId] = circle;
  return circle;
}

function updateAgentPosition(agentId, x, y) {
  const sprite = agentSprites[agentId];
  if (!sprite) return;
  const { sx, sy } = worldToScreen(x, y);
  sprite.x = sx;
  sprite.y = sy;
}

function showSpeechBubble(agentId, text) {
  if (speechBubbles[agentId]) {
    app.stage.removeChild(speechBubbles[agentId]);
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
  bg.beginFill(0xffffff).lineStyle(1, 0x000000)
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
  container.y = sprite.y - 20 - bubbleHeight / 2;

  app.stage.addChild(container);
  speechBubbles[agentId] = container;

  setTimeout(() => {
    if (speechBubbles[agentId] === container) {
      app.stage.removeChild(container);
      delete speechBubbles[agentId];
    }
  }, 8000);
}

function connect() {
  const ws = new WebSocket(WS_URL);

  ws.onopen = () => console.log('[ws] conectado');
  ws.onclose = () => {
    console.log('[ws] desconectado, tentando reconectar em 3s...');
    setTimeout(connect, 3000);
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === 'full_state') {
      msg.agents.forEach(agent => {
        const colorHex = parseInt(agent.color.replace('#', '0x'));
        createAgentSprite(agent.id, colorHex);
      });
      msg.states.forEach(state => {
        updateAgentPosition(state.agent_id, state.x, state.y);
      });
    }

    if (msg.type === 'agent_tick') {
      const a = msg.action;
      if (a.type === 'walk' || a.type === 'move_object') {
        updateAgentPosition(msg.agentId, a.x, a.y);
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
