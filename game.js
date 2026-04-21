const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const ui = {
  serverState: document.getElementById('serverState'),
  roomId: document.getElementById('roomId'),
  hp: document.getElementById('hp'),
  ammo: document.getElementById('ammo'),
  kills: document.getElementById('kills'),
  points: document.getElementById('points'),
  online: document.getElementById('online'),
  timer: document.getElementById('timer'),
  messages: document.getElementById('messages'),
  walletPoints: document.getElementById('walletPoints'),
  walletToken: document.getElementById('walletToken'),
  walletInfo: document.getElementById('walletInfo'),
  nickname: document.getElementById('nickname'),
  connectBtn: document.getElementById('connectBtn'),
  exchangeBtn: document.getElementById('exchangeBtn')
};

const FOV = Math.PI / 3;
const NUM_RAYS = 220;
const MAX_DEPTH = 16;
const keys = new Set();

const state = {
  token: localStorage.getItem('cb_token') || '',
  playerId: null,
  socket: null,
  snapshot: null,
  angle: 0,
  mouseLocked: false,
  map: [],
  healthChecked: false
};

function setMessage(msg) {
  ui.messages.textContent = msg;
}

function isWall(x, y) {
  const map = state.map;
  if (!map.length) return false;
  return map[Math.floor(y)]?.[Math.floor(x)] === '#';
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function castRay(px, py, angle) {
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  for (let depth = 0; depth < MAX_DEPTH; depth += 0.02) {
    const x = px + cos * depth;
    const y = py + sin * depth;
    if (isWall(x, y)) return depth;
  }
  return MAX_DEPTH;
}

function drawScene() {
  const snap = state.snapshot;
  const me = snap?.players.find((p) => p.id === state.playerId);

  ctx.fillStyle = '#1d2531';
  ctx.fillRect(0, 0, canvas.width, canvas.height / 2);
  ctx.fillStyle = '#121212';
  ctx.fillRect(0, canvas.height / 2, canvas.width, canvas.height / 2);

  if (!me) {
    setMessage('Подключись к матчу');
    requestAnimationFrame(drawScene);
    return;
  }

  for (let i = 0; i < NUM_RAYS; i++) {
    const ratio = i / NUM_RAYS;
    const rayAngle = state.angle - FOV / 2 + ratio * FOV;
    const depth = castRay(me.x, me.y, rayAngle);
    const corrected = depth * Math.cos(rayAngle - state.angle);
    const h = Math.min(canvas.height, (canvas.height * 0.9) / (corrected + 0.0001));
    const shade = Math.max(20, 225 - corrected * 28);

    ctx.fillStyle = `rgb(${shade}, ${shade}, ${shade + 10})`;
    const w = canvas.width / NUM_RAYS;
    ctx.fillRect(i * w, (canvas.height - h) / 2, w + 1, h);
  }

  const enemies = [];
  for (const p of snap.players) {
    if (p.id === me.id || p.hp <= 0) continue;
    const dx = p.x - me.x;
    const dy = p.y - me.y;
    enemies.push({ x: p.x, y: p.y, hp: p.hp, dist: Math.hypot(dx, dy), ang: angleDiff(Math.atan2(dy, dx), state.angle), color: '#ff7676' });
  }
  for (const b of snap.bots) {
    if (!b.alive) continue;
    const dx = b.x - me.x;
    const dy = b.y - me.y;
    enemies.push({ x: b.x, y: b.y, hp: b.hp, dist: Math.hypot(dx, dy), ang: angleDiff(Math.atan2(dy, dx), state.angle), color: '#ff4b4b' });
  }

  enemies
    .filter((e) => Math.abs(e.ang) < FOV / 1.3)
    .sort((a, b) => b.dist - a.dist)
    .forEach((e) => {
      const size = Math.min(250, 430 / (e.dist + 0.2));
      const x = (0.5 + e.ang / FOV) * canvas.width;
      const y = canvas.height / 2 + size * 0.18;
      ctx.fillStyle = e.color;
      ctx.fillRect(x - size * 0.24, y - size, size * 0.48, size);
      ctx.fillStyle = '#fff';
      ctx.fillRect(x - size * 0.22, y - size - 10, size * 0.44, 6);
      ctx.fillStyle = '#44d984';
      ctx.fillRect(x - size * 0.22, y - size - 10, (size * 0.44 * Math.max(0, e.hp)) / 100, 6);
    });

  requestAnimationFrame(drawScene);
}

function updateHUD() {
  const snap = state.snapshot;
  const me = snap?.players.find((p) => p.id === state.playerId);
  if (!me) return;

  ui.hp.textContent = Math.floor(me.hp);
  ui.ammo.textContent = me.reloading ? '...' : me.ammo;
  ui.kills.textContent = me.kills;
  ui.points.textContent = me.points;
  ui.online.textContent = snap.players.length;

  const m = Math.floor((snap.matchTime || 0) / 60);
  const s = Math.floor((snap.matchTime || 0) % 60);
  ui.timer.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function sendInput({ shoot = false } = {}) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;

  state.socket.send(JSON.stringify({
    type: 'input',
    forward: keys.has('KeyW'),
    back: keys.has('KeyS'),
    left: keys.has('KeyA'),
    right: keys.has('KeyD'),
    run: keys.has('ShiftLeft'),
    reload: keys.has('KeyR'),
    shoot,
    angle: state.angle
  }));
}

async function ensureGuest() {
  if (state.token) return;
  const res = await fetch('/api/guest', { method: 'POST' });
  const data = await res.json();
  state.token = data.token;
  localStorage.setItem('cb_token', data.token);
  if (!ui.nickname.value) ui.nickname.value = data.nickname;
}

async function refreshWallet() {
  if (!state.token) return;
  const res = await fetch(`/api/wallet/${state.token}`);
  const wallet = await res.json();
  ui.walletPoints.textContent = wallet.points;
  ui.walletToken.textContent = wallet.cbt;
}

async function exchange() {
  if (!state.token) return;
  const res = await fetch('/api/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: state.token, amount: 1000 })
  });
  const data = await res.json();
  if (!res.ok) {
    ui.walletInfo.textContent = data.error || 'Ошибка обмена';
  } else {
    ui.walletInfo.textContent = `Успешно: +${data.exchanged} CBT`;
  }
  await refreshWallet();
}

function connect() {
  if (state.socket && state.socket.readyState === WebSocket.OPEN) return;

  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const nickname = encodeURIComponent(ui.nickname.value || 'Guest');
  state.socket = new WebSocket(`${protocol}://${location.host}/ws?token=${state.token}&name=${nickname}`);

  state.socket.onopen = () => {
    ui.serverState.textContent = 'online';
    setMessage('Подключено. Кликни по игре для захвата мыши.');
    sendInput();
  };

  state.socket.onclose = () => {
    ui.serverState.textContent = 'offline';
    setMessage('Соединение потеряно. Нажми подключиться снова.');
  };

  state.socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'init') {
      state.playerId = msg.playerId;
      ui.roomId.textContent = msg.roomId;
    }

    if (msg.type === 'snapshot') {
      state.snapshot = msg.data;
      state.map = msg.data.map;
      const me = msg.data.players.find((p) => p.id === state.playerId);
      if (me && !state.mouseLocked) state.angle = me.angle;
      updateHUD();
    }
  };
}

async function boot() {
  try {
    const health = await fetch('/api/health');
    if (health.ok) state.healthChecked = true;
  } catch {
    setMessage('Сервер недоступен. Запусти: npm install && npm start');
  }

  await ensureGuest();
  await refreshWallet();

  ui.connectBtn.addEventListener('click', connect);
  ui.exchangeBtn.addEventListener('click', exchange);

  document.addEventListener('keydown', (e) => {
    keys.add(e.code);
    sendInput();
  });

  document.addEventListener('keyup', (e) => {
    keys.delete(e.code);
    sendInput();
  });

  canvas.addEventListener('click', () => {
    if (!state.mouseLocked) canvas.requestPointerLock();
    sendInput({ shoot: true });
  });

  document.addEventListener('pointerlockchange', () => {
    state.mouseLocked = document.pointerLockElement === canvas;
  });

  document.addEventListener('mousemove', (e) => {
    if (!state.mouseLocked) return;
    state.angle += e.movementX * 0.0024;
    sendInput();
  });

  setMessage('Введи ник, нажми "Подключиться к матчу".');
  requestAnimationFrame(drawScene);
}

boot();
