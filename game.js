const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const ui = {
  hp: document.getElementById('hp'),
  ammo: document.getElementById('ammo'),
  kills: document.getElementById('kills'),
  points: document.getElementById('points'),
  timer: document.getElementById('timer'),
  messages: document.getElementById('messages'),
  walletPoints: document.getElementById('walletPoints'),
  walletInfo: document.getElementById('walletInfo'),
};

const MAP = [
  '################',
  '#....#.........#',
  '#.##.#.#####.#.#',
  '#....#.....#.#.#',
  '#.######.#.#.#.#',
  '#........#...#.#',
  '#.####.#####.#.#',
  '#.#....#.....#.#',
  '#.#.##.#.###.#.#',
  '#...##...#...#.#',
  '#.######.#.###.#',
  '#........#.....#',
  '################',
];

const CELL = 1;
const FOV = Math.PI / 3;
const NUM_RAYS = 240;
const MAX_DEPTH = 16;
const MATCH_SECONDS = 180;

let state;
let keys = new Set();
let mouseLocked = false;

function createState() {
  return {
    running: false,
    matchTime: MATCH_SECONDS,
    player: {
      x: 1.6,
      y: 1.6,
      angle: 0,
      speed: 2.5,
      hp: 100,
      kills: 0,
      ammo: 24,
      maxAmmo: 24,
      reloading: false,
    },
    walletPoints: Number(localStorage.getItem('cb_wallet') || 0),
    points: 0,
    bots: spawnBots(6),
    lastTs: 0,
    shotCooldown: 0,
    flashTime: 0,
  };
}

function spawnBots(count) {
  const bots = [];
  while (bots.length < count) {
    const x = 2 + Math.random() * 11;
    const y = 2 + Math.random() * 9;
    if (!isWall(x, y)) {
      bots.push({ x, y, hp: 50, alive: true, dir: Math.random() * Math.PI * 2, moveTimer: 1 + Math.random() * 2 });
    }
  }
  return bots;
}

function isWall(x, y) {
  const mx = Math.floor(x / CELL);
  const my = Math.floor(y / CELL);
  return MAP[my]?.[mx] === '#';
}

function setMessage(text) {
  ui.messages.textContent = text;
}

function updateUI() {
  ui.hp.textContent = Math.max(0, Math.floor(state.player.hp));
  ui.ammo.textContent = state.player.reloading ? '...' : state.player.ammo;
  ui.kills.textContent = state.player.kills;
  ui.points.textContent = state.points;
  ui.walletPoints.textContent = state.walletPoints;

  const m = Math.floor(state.matchTime / 60);
  const s = Math.floor(state.matchTime % 60);
  ui.timer.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function tryMove(entity, dx, dy) {
  const nx = entity.x + dx;
  const ny = entity.y + dy;

  if (!isWall(nx, entity.y)) entity.x = nx;
  if (!isWall(entity.x, ny)) entity.y = ny;
}

function lineOfSight(fromX, fromY, toX, toY) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(2, Math.floor(dist * 10));

  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = fromX + dx * t;
    const y = fromY + dy * t;
    if (isWall(x, y)) return false;
  }

  return true;
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function shoot() {
  if (!state.running || state.player.reloading || state.shotCooldown > 0) return;
  if (state.player.ammo <= 0) {
    setMessage('Нет патронов. Нажми R для перезарядки.');
    return;
  }

  state.player.ammo -= 1;
  state.shotCooldown = 0.18;
  state.flashTime = 0.06;

  let target = null;
  let bestDist = Infinity;

  for (const bot of state.bots) {
    if (!bot.alive) continue;
    const dx = bot.x - state.player.x;
    const dy = bot.y - state.player.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 8) continue;

    const ang = Math.atan2(dy, dx);
    const diff = Math.abs(angleDiff(ang, state.player.angle));

    if (diff < 0.12 && dist < bestDist && lineOfSight(state.player.x, state.player.y, bot.x, bot.y)) {
      bestDist = dist;
      target = bot;
    }
  }

  if (target) {
    target.hp -= 35;
    if (target.hp <= 0) {
      target.alive = false;
      state.player.kills += 1;
      state.points += 100;
      setMessage('Фраг! +100 очков');
      setTimeout(() => respawnBot(target), 2500);
    } else {
      state.points += 10;
      setMessage('Попадание! +10 очков');
    }
  }
}

function respawnBot(bot) {
  if (!state.running) return;

  let placed = false;
  while (!placed) {
    const x = 2 + Math.random() * 11;
    const y = 2 + Math.random() * 9;
    if (!isWall(x, y) && Math.hypot(x - state.player.x, y - state.player.y) > 3) {
      bot.x = x;
      bot.y = y;
      bot.hp = 50;
      bot.alive = true;
      bot.dir = Math.random() * Math.PI * 2;
      bot.moveTimer = 1 + Math.random() * 2;
      placed = true;
    }
  }
}

function reload() {
  if (state.player.reloading || state.player.ammo === state.player.maxAmmo) return;
  state.player.reloading = true;
  setMessage('Перезарядка...');
  setTimeout(() => {
    state.player.ammo = state.player.maxAmmo;
    state.player.reloading = false;
    setMessage('Готов к бою');
    updateUI();
  }, 1300);
}

function updateBots(dt) {
  for (const bot of state.bots) {
    if (!bot.alive) continue;

    const toPlayerX = state.player.x - bot.x;
    const toPlayerY = state.player.y - bot.y;
    const distToPlayer = Math.hypot(toPlayerX, toPlayerY);

    if (distToPlayer < 6 && lineOfSight(bot.x, bot.y, state.player.x, state.player.y)) {
      const dir = Math.atan2(toPlayerY, toPlayerX);
      tryMove(bot, Math.cos(dir) * dt * 1.3, Math.sin(dir) * dt * 1.3);

      if (distToPlayer < 1.3) {
        state.player.hp -= dt * 16;
        if (Math.random() < 0.04) setMessage('Тебя ранил бот!');
      }
    } else {
      bot.moveTimer -= dt;
      if (bot.moveTimer <= 0) {
        bot.dir += (Math.random() - 0.5) * 1.8;
        bot.moveTimer = 1 + Math.random() * 2;
      }
      tryMove(bot, Math.cos(bot.dir) * dt * 0.9, Math.sin(bot.dir) * dt * 0.9);
    }
  }
}

function update(dt) {
  if (!state.running) return;

  state.matchTime -= dt;
  state.shotCooldown = Math.max(0, state.shotCooldown - dt);
  state.flashTime = Math.max(0, state.flashTime - dt);

  if (keys.has('KeyR')) reload();

  const speedMul = keys.has('ShiftLeft') ? 1.5 : 1;
  const sp = state.player.speed * speedMul;
  let dx = 0;
  let dy = 0;

  if (keys.has('KeyW')) {
    dx += Math.cos(state.player.angle) * sp * dt;
    dy += Math.sin(state.player.angle) * sp * dt;
  }
  if (keys.has('KeyS')) {
    dx -= Math.cos(state.player.angle) * sp * dt;
    dy -= Math.sin(state.player.angle) * sp * dt;
  }
  if (keys.has('KeyA')) {
    dx += Math.cos(state.player.angle - Math.PI / 2) * sp * dt;
    dy += Math.sin(state.player.angle - Math.PI / 2) * sp * dt;
  }
  if (keys.has('KeyD')) {
    dx += Math.cos(state.player.angle + Math.PI / 2) * sp * dt;
    dy += Math.sin(state.player.angle + Math.PI / 2) * sp * dt;
  }

  tryMove(state.player, dx, dy);
  updateBots(dt);

  if (state.player.hp <= 0) {
    setMessage('Ты проиграл матч. Нажми Старт/Перезапуск.');
    endMatch();
  }

  if (state.matchTime <= 0) {
    setMessage('Матч завершён! Очки зачислены в кошелёк.');
    endMatch();
  }

  updateUI();
}

function endMatch() {
  state.running = false;
  state.walletPoints += state.points;
  localStorage.setItem('cb_wallet', String(state.walletPoints));
  updateUI();
}

function castRay(angle) {
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);

  for (let depth = 0; depth < MAX_DEPTH; depth += 0.02) {
    const x = state.player.x + cos * depth;
    const y = state.player.y + sin * depth;
    if (isWall(x, y)) return depth;
  }
  return MAX_DEPTH;
}

function render3D() {
  const w = canvas.width;
  const h = canvas.height;

  ctx.fillStyle = '#20242f';
  ctx.fillRect(0, 0, w, h / 2);
  ctx.fillStyle = '#111';
  ctx.fillRect(0, h / 2, w, h / 2);

  for (let ray = 0; ray < NUM_RAYS; ray++) {
    const rayScreenX = ray / NUM_RAYS;
    const rayAngle = state.player.angle - FOV / 2 + rayScreenX * FOV;
    const depth = castRay(rayAngle);
    const corrected = depth * Math.cos(rayAngle - state.player.angle);
    const wallHeight = Math.min(h, (h * 0.9) / (corrected + 0.0001));
    const shade = Math.max(30, 230 - corrected * 28);

    ctx.fillStyle = `rgb(${shade}, ${shade}, ${shade + 10})`;
    const colW = w / NUM_RAYS;
    ctx.fillRect(ray * colW, (h - wallHeight) / 2, colW + 1, wallHeight);
  }

  const visibleBots = state.bots
    .filter((b) => b.alive)
    .map((b) => {
      const dx = b.x - state.player.x;
      const dy = b.y - state.player.y;
      const dist = Math.hypot(dx, dy);
      const ang = angleDiff(Math.atan2(dy, dx), state.player.angle);
      return { b, dist, ang };
    })
    .filter((it) => Math.abs(it.ang) < FOV / 1.4)
    .sort((a, b) => b.dist - a.dist);

  for (const { b, dist, ang } of visibleBots) {
    if (!lineOfSight(state.player.x, state.player.y, b.x, b.y)) continue;

    const size = Math.min(240, 420 / (dist + 0.2));
    const x = (0.5 + ang / FOV) * w;
    const y = h / 2 + size * 0.15;

    ctx.fillStyle = '#ff4f4f';
    ctx.fillRect(x - size * 0.22, y - size, size * 0.44, size);

    ctx.fillStyle = '#fff';
    ctx.fillRect(x - size * 0.2, y - size - 10, size * 0.4, 6);
    ctx.fillStyle = '#3ddc84';
    ctx.fillRect(x - size * 0.2, y - size - 10, (size * 0.4 * Math.max(0, b.hp)) / 50, 6);
  }

  if (state.flashTime > 0) {
    ctx.fillStyle = `rgba(255, 230, 180, ${state.flashTime * 4})`;
    ctx.fillRect(0, 0, w, h);
  }
}

function loop(ts) {
  const dt = Math.min(0.05, (ts - state.lastTs) / 1000 || 0.016);
  state.lastTs = ts;

  update(dt);
  render3D();

  requestAnimationFrame(loop);
}

function startMatch() {
  state = createState();
  state.running = true;
  setMessage('Матч начался! Уничтожай ботов и зарабатывай очки.');
  updateUI();
}

canvas.addEventListener('click', () => {
  if (!mouseLocked) canvas.requestPointerLock();
  shoot();
});

document.addEventListener('pointerlockchange', () => {
  mouseLocked = document.pointerLockElement === canvas;
});

document.addEventListener('mousemove', (e) => {
  if (!mouseLocked || !state) return;
  state.player.angle += e.movementX * 0.0023;
});

document.addEventListener('keydown', (e) => {
  keys.add(e.code);
});

document.addEventListener('keyup', (e) => {
  keys.delete(e.code);
});

document.getElementById('startBtn').addEventListener('click', startMatch);
document.getElementById('exchangeBtn').addEventListener('click', () => {
  if (!state) return;
  if (state.walletPoints < 1000) {
    ui.walletInfo.textContent = 'Недостаточно очков для обмена. Нужно 1000.';
    return;
  }
  state.walletPoints -= 1000;
  localStorage.setItem('cb_wallet', String(state.walletPoints));
  ui.walletInfo.textContent = 'Успех! Списано 1000 очков => +1 CBT (тестовый режим).';
  updateUI();
});

state = createState();
updateUI();
setMessage('Нажми Старт / Перезапуск, затем клик по экрану для захвата мыши.');
requestAnimationFrame(loop);
