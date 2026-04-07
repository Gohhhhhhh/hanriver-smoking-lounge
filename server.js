const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// ─── Constants ────────────────────────────────────────────────────────────────
// World = 2048 image × 1.75 scale = 3584
const MAP_W = 2048 * 1.75;  // 3584
const MAP_H = 2048 * 1.75;
const SPAWN_X = MAP_W * 0.2;
const SPAWN_Y = MAP_H * 0.5;
const SPAWN_SPREAD = 400;

const VALID_DIRECTIONS = new Set(['left', 'right', 'up', 'down']);

// ─── State ────────────────────────────────────────────────────────────────────
const players = {};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// ─── Socket.io ───────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] ${socket.id} 접속`);

  // ── JOIN ──────────────────────────────────────────────────────────────────
  socket.on('join', ({ name }) => {
    const safeName = String(name || '익명').replace(/[<>&"]/g, '').slice(0, 16).trim() || '익명';

    players[socket.id] = {
      id: socket.id,
      name: safeName,
      x: SPAWN_X + (Math.random() - 0.5) * SPAWN_SPREAD,
      y: SPAWN_Y + (Math.random() - 0.5) * SPAWN_SPREAD,
      direction: 'down',
      isWalking: false,
      isSmoking: true,
    };

    // Send full current state to the new player
    socket.emit('init', { players, selfId: socket.id });

    // Announce to everyone else
    socket.broadcast.emit('playerJoined', players[socket.id]);

    console.log(`  → "${safeName}" 입장 @ (${Math.round(players[socket.id].x)}, ${Math.round(players[socket.id].y)})`);
  });

  // ── MOVE ──────────────────────────────────────────────────────────────────
  socket.on('move', ({ x, y, direction, isWalking }) => {
    const p = players[socket.id];
    if (!p) return;

    p.x = clamp(Number(x) || p.x, 0, MAP_W);
    p.y = clamp(Number(y) || p.y, 0, MAP_H);
    p.direction = VALID_DIRECTIONS.has(direction) ? direction : p.direction;
    p.isWalking = Boolean(isWalking);

    socket.broadcast.emit('playerMoved', {
      id: socket.id,
      x: p.x,
      y: p.y,
      direction: p.direction,
      isWalking: p.isWalking,
    });
  });

  // ── CHAT ──────────────────────────────────────────────────────────────────
  socket.on('chat', ({ message }) => {
    const p = players[socket.id];
    if (!p) return;

    const safeMsg = String(message || '').replace(/[<>&"]/g, '').slice(0, 100).trim();
    if (!safeMsg) return;

    io.emit('chatMessage', { id: socket.id, name: p.name, message: safeMsg });
  });

  // ── SMOKING UPDATE ────────────────────────────────────────────────────────
  socket.on('smokingUpdate', ({ isSmoking }) => {
    const p = players[socket.id];
    if (!p) return;

    p.isSmoking = Boolean(isSmoking);
    socket.broadcast.emit('playerSmokingUpdate', { id: socket.id, isSmoking: p.isSmoking });
  });

  // ── DISCONNECT ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const p = players[socket.id];
    console.log(`[-] ${p ? `"${p.name}"` : socket.id} 퇴장`);
    delete players[socket.id];
    io.emit('playerLeft', socket.id);
  });
});

// ─── Start ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🌸 한강 벚꽃 흡연소 서버 시작\n   → http://localhost:${PORT}\n`);
});
