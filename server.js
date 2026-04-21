const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 8080);
const TICK_RATE = 30;
const ROOM_CAPACITY = 12;
const MATCH_SECONDS = 180;
const BOT_TARGET = 6;

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
  '################'
];

const DATA_DIR = path.join(__dirname, 'data');
const WALLETS_FILE = path.join(DATA_DIR, 'wallets.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(WALLETS_FILE)) fs.writeFileSync(WALLETS_FILE, '{}');

let wallets = JSON.parse(fs.readFileSync(WALLETS_FILE, 'utf8'));

function saveWallets() {
  fs.writeFileSync(WALLETS_FILE, JSON.stringify(wallets, null, 2));
}

function randomToken() {
  return crypto.randomBytes(16).toString('hex');
}

function isWall(x, y) {
  const mx = Math.floor(x);
  const my = Math.floor(y);
  return MAP[my]?.[mx] === '#';
}

function lineOfSight(fromX, fromY, toX, toY) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(2, Math.floor(dist * 12));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (isWall(fromX + dx * t, fromY + dy * t)) return false;
  }
  return true;
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function spawnPoint() {
  for (let i = 0; i < 50; i++) {
    const x = 1.5 + Math.random() * 12;
    const y = 1.5 + Math.random() * 10;
    if (!isWall(x, y)) return { x, y };
  }
  return { x: 1.6, y: 1.6 };
}

const rooms = new Map();
const clients = new Map();
let roomCounter = 1;

function createRoom() {
  const room = {
    id: `room-${roomCounter++}`,
    players: new Map(),
    bots: [],
    matchTime: MATCH_SECONDS,
    lastBroadcast: 0
  };

  for (let i = 0; i < BOT_TARGET; i++) {
    const pos = spawnPoint();
    room.bots.push({
      id: `bot-${i + 1}`,
      x: pos.x,
      y: pos.y,
      hp: 100,
      dir: Math.random() * Math.PI * 2,
      moveTimer: 0,
      alive: true
    });
  }
  rooms.set(room.id, room);
  return room;
}

function assignRoom(player) {
  let room = [...rooms.values()].find((r) => r.players.size < ROOM_CAPACITY);
  if (!room) room = createRoom();
  room.players.set(player.id, player);
  player.roomId = room.id;
  return room;
}

function resetRoom(room) {
  room.matchTime = MATCH_SECONDS;
  room.players.forEach((p) => {
    const pos = spawnPoint();
    p.x = pos.x;
    p.y = pos.y;
    p.hp = 100;
    p.kills = 0;
    p.points = 0;
    p.ammo = 24;
    p.reloadLeft = 0;
    p.shotCooldown = 0;
  });
  room.bots.forEach((b) => {
    const pos = spawnPoint();
    b.x = pos.x;
    b.y = pos.y;
    b.hp = 100;
    b.alive = true;
  });
}

function moveWithCollision(entity, dx, dy) {
  const nx = entity.x + dx;
  const ny = entity.y + dy;
  if (!isWall(nx, entity.y)) entity.x = nx;
  if (!isWall(entity.x, ny)) entity.y = ny;
}

function handleShoot(player, room) {
  if (player.shotCooldown > 0 || player.reloadLeft > 0 || player.ammo <= 0 || player.hp <= 0) return;
  player.ammo -= 1;
  player.shotCooldown = 0.18;

  let best = null;
  let bestDist = Infinity;

  room.players.forEach((target) => {
    if (target.id === player.id || target.hp <= 0) return;
    const dx = target.x - player.x;
    const dy = target.y - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 8) return;
    const ang = Math.atan2(dy, dx);
    if (Math.abs(angleDiff(ang, player.angle)) < 0.1 && dist < bestDist && lineOfSight(player.x, player.y, target.x, target.y)) {
      best = target;
      bestDist = dist;
    }
  });

  room.bots.forEach((bot) => {
    if (!bot.alive) return;
    const dx = bot.x - player.x;
    const dy = bot.y - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 8) return;
    const ang = Math.atan2(dy, dx);
    if (Math.abs(angleDiff(ang, player.angle)) < 0.1 && dist < bestDist && lineOfSight(player.x, player.y, bot.x, bot.y)) {
      best = bot;
      bestDist = dist;
    }
  });

  if (!best) return;

  best.hp -= 35;
  player.points += 10;
  if (best.hp <= 0) {
    player.kills += 1;
    player.points += 90;
    if (best.id?.startsWith('bot-')) {
      setTimeout(() => {
        const pos = spawnPoint();
        best.x = pos.x;
        best.y = pos.y;
        best.hp = 100;
        best.alive = true;
      }, 3000);
      best.alive = false;
    } else {
      const pos = spawnPoint();
      best.x = pos.x;
      best.y = pos.y;
      best.hp = 100;
      best.ammo = 24;
    }
  }
}

function updateRoom(room, dt) {
  room.matchTime -= dt;

  room.players.forEach((p) => {
    if (p.hp <= 0) return;

    p.shotCooldown = Math.max(0, p.shotCooldown - dt);
    p.reloadLeft = Math.max(0, p.reloadLeft - dt);
    if (p.reloadLeft === 0 && p.reloadRequested) {
      p.ammo = 24;
      p.reloadRequested = false;
    }

    if (p.input.reload && p.reloadLeft === 0 && p.ammo < 24) {
      p.reloadLeft = 1.3;
      p.reloadRequested = true;
    }

    if (p.input.shoot) {
      handleShoot(p, room);
      p.input.shoot = false;
    }

    const speed = 2.6 * (p.input.run ? 1.45 : 1);
    let dx = 0;
    let dy = 0;
    if (p.input.forward) {
      dx += Math.cos(p.angle) * speed * dt;
      dy += Math.sin(p.angle) * speed * dt;
    }
    if (p.input.back) {
      dx -= Math.cos(p.angle) * speed * dt;
      dy -= Math.sin(p.angle) * speed * dt;
    }
    if (p.input.left) {
      dx += Math.cos(p.angle - Math.PI / 2) * speed * dt;
      dy += Math.sin(p.angle - Math.PI / 2) * speed * dt;
    }
    if (p.input.right) {
      dx += Math.cos(p.angle + Math.PI / 2) * speed * dt;
      dy += Math.sin(p.angle + Math.PI / 2) * speed * dt;
    }

    moveWithCollision(p, dx, dy);
  });

  room.bots.forEach((b) => {
    if (!b.alive) return;
    let nearest = null;
    let nd = Infinity;
    room.players.forEach((p) => {
      const d = Math.hypot(p.x - b.x, p.y - b.y);
      if (d < nd) {
        nd = d;
        nearest = p;
      }
    });

    if (!nearest) return;

    if (nd < 6 && lineOfSight(b.x, b.y, nearest.x, nearest.y)) {
      const dir = Math.atan2(nearest.y - b.y, nearest.x - b.x);
      moveWithCollision(b, Math.cos(dir) * dt * 1.35, Math.sin(dir) * dt * 1.35);
      if (nd < 1.2) nearest.hp = Math.max(0, nearest.hp - 18 * dt);
    } else {
      b.moveTimer -= dt;
      if (b.moveTimer <= 0) {
        b.moveTimer = 1 + Math.random() * 1.5;
        b.dir += (Math.random() - 0.5) * 1.4;
      }
      moveWithCollision(b, Math.cos(b.dir) * dt * 0.9, Math.sin(b.dir) * dt * 0.9);
    }
  });

  if (room.matchTime <= 0) {
    room.players.forEach((p) => {
      const wallet = wallets[p.token] || { points: 0, cbt: 0 };
      wallet.points += Math.floor(p.points);
      wallets[p.token] = wallet;
    });
    saveWallets();
    resetRoom(room);
  }
}

function snapshot(room) {
  return {
    roomId: room.id,
    matchTime: Math.max(0, room.matchTime),
    map: MAP,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      angle: p.angle,
      hp: p.hp,
      kills: p.kills,
      points: p.points,
      ammo: p.ammo,
      reloading: p.reloadLeft > 0
    })),
    bots: room.bots.map((b) => ({ id: b.id, x: b.x, y: b.y, hp: b.hp, alive: b.alive }))
  };
}

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

app.post('/api/guest', (req, res) => {
  const token = randomToken();
  wallets[token] = wallets[token] || { points: 0, cbt: 0 };
  saveWallets();
  res.json({ token, nickname: `Guest-${token.slice(0, 4)}` });
});

app.get('/api/wallet/:token', (req, res) => {
  const wallet = wallets[req.params.token] || { points: 0, cbt: 0 };
  res.json(wallet);
});

app.post('/api/exchange', (req, res) => {
  const { token, amount } = req.body || {};
  if (!token || !amount || amount < 1000) {
    return res.status(400).json({ error: 'min exchange 1000 points' });
  }
  const wallet = wallets[token] || { points: 0, cbt: 0 };
  if (wallet.points < amount) return res.status(400).json({ error: 'not enough points' });

  const tokens = Math.floor(amount / 1000);
  const consumed = tokens * 1000;
  wallet.points -= consumed;
  wallet.cbt += tokens;
  wallets[token] = wallet;
  saveWallets();
  res.json({ ok: true, wallet, exchanged: tokens });
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    rooms: rooms.size,
    onlinePlayers: clients.size,
    uptime: process.uptime()
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const params = new URL(req.url, 'http://localhost').searchParams;
  const token = params.get('token');
  const name = (params.get('name') || '').slice(0, 16) || `Guest-${(token || '').slice(0, 4)}`;
  if (!token) {
    ws.close();
    return;
  }

  const pos = spawnPoint();
  const player = {
    id: randomToken().slice(0, 8),
    token,
    name,
    x: pos.x,
    y: pos.y,
    angle: 0,
    hp: 100,
    kills: 0,
    points: 0,
    ammo: 24,
    shotCooldown: 0,
    reloadLeft: 0,
    reloadRequested: false,
    input: {
      forward: false,
      back: false,
      left: false,
      right: false,
      run: false,
      reload: false,
      shoot: false
    }
  };

  const room = assignRoom(player);
  clients.set(ws, player);

  ws.send(JSON.stringify({ type: 'init', playerId: player.id, roomId: room.id }));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'input') {
      player.input.forward = !!msg.forward;
      player.input.back = !!msg.back;
      player.input.left = !!msg.left;
      player.input.right = !!msg.right;
      player.input.run = !!msg.run;
      player.input.reload = !!msg.reload;
      if (msg.shoot) player.input.shoot = true;
      if (typeof msg.angle === 'number') player.angle = msg.angle;
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    const r = rooms.get(player.roomId);
    if (!r) return;
    r.players.delete(player.id);
    if (r.players.size === 0) rooms.delete(r.id);
  });
});

setInterval(() => {
  const dt = 1 / TICK_RATE;
  rooms.forEach((room) => {
    updateRoom(room, dt);
    const now = Date.now();
    if (now - room.lastBroadcast < 66) return;
    room.lastBroadcast = now;

    const data = JSON.stringify({ type: 'snapshot', data: snapshot(room) });
    for (const [ws, player] of clients.entries()) {
      if (player.roomId !== room.id || ws.readyState !== 1) continue;
      ws.send(data);
    }
  });
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  console.log(`Counter-Blockchain server running on http://localhost:${PORT}`);
});
