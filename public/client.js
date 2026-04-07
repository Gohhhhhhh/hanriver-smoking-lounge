'use strict';

// ─── Canvas roundRect polyfill ────────────────────────────────────────────────
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    this.beginPath();
    this.moveTo(x + r, y);
    this.arcTo(x + w, y,     x + w, y + h, r);
    this.arcTo(x + w, y + h, x,     y + h, r);
    this.arcTo(x,     y + h, x,     y,     r);
    this.arcTo(x,     y,     x + w, y,     r);
    this.closePath();
    return this;
  };
}

// ─── Config ───────────────────────────────────────────────────────────────────
// Map image is 2048×2048. We scale it up by MAP_SCALE in world space.
const MAP_IMG   = 2048;
const MAP_SCALE = 1.75;            // 1.75× → world is 3584×3584
const MAP_W     = MAP_IMG * MAP_SCALE;   // 3584
const MAP_H     = MAP_IMG * MAP_SCALE;   // 3584

const CFG = {
  SPAWN_X:          MAP_W * 0.2,
  SPAWN_Y:          MAP_H * 0.5,
  PLAYER_SPEED:     7,
  CHAR_W:           176,           // world pixels for sprite width  (110 × 1.6)
  CHAR_H:           176,           // world pixels for sprite height (110 × 1.6)
  CAMERA_LERP:      0.10,
  CIG_INTERVAL:     10 * 60,    // 10분마다 담배 1개비
  PETAL_COUNT:      437,
  SPARKLE_COUNT:    400,
  MOVE_EMIT_MS:     50,
};

// ─── Assets ───────────────────────────────────────────────────────────────────
const assets = {
  map:       null, mapOk:       false,
  quokka:    null, quokkaOk:    false,
  walkSheet: null, walkSheetOk: false,
  tube:      null, tubeOk:      false,
};

const WALK_FRAMES = 8;  // walk_spritesheet.png 에 포함된 프레임 수

// ─── Collision map ────────────────────────────────────────────────────────────
// 오프스크린 캔버스에 collision_map.png 를 그려 픽셀 데이터를 미리 읽어둠
// 화면에는 절대 그려지지 않음 — 코드에서만 색상 조회용으로 사용
let collisionData = null;  // ImageData (width/height/data)

function loadCollisionMap(onDone) {
  const img = new Image();
  img.onload = () => {
    const oc   = document.createElement('canvas');
    oc.width   = img.width;
    oc.height  = img.height;
    const octx = oc.getContext('2d');
    octx.drawImage(img, 0, 0);
    collisionData = octx.getImageData(0, 0, oc.width, oc.height);
    onDone(true);
  };
  img.onerror = () => { onDone(false); };
  img.src = 'assets/collision_map.png';
}

// 월드 좌표 → 충돌맵 픽셀 색상 존 반환
// 반환값: 'yellow' | 'brown' | 'blue' | 'black' | 'green' | 'none'
function getCollisionZone(wx, wy) {
  if (!collisionData) return 'none';
  const ix = Math.floor(wx / MAP_SCALE);
  const iy = Math.floor(wy / MAP_SCALE);
  if (ix < 0 || iy < 0 || ix >= collisionData.width || iy >= collisionData.height) return 'none';
  const i = (iy * collisionData.width + ix) * 4;
  const r = collisionData.data[i], g = collisionData.data[i + 1], b = collisionData.data[i + 2];
  if (r > 200 && g > 180 && b < 100)                  return 'yellow';
  if (b > 150 && r < 120 && g < 160)                  return 'blue';
  if (g > 150 && r < 120 && b < 120)                  return 'green';
  if (r < 60  && g < 60  && b < 60)                   return 'black';
  if (r > 120 && g > 70  && g < 140 && b < 80)        return 'brown';
  return 'none';
}

function loadAssets(onProgress, onDone) {
  let done = 0;
  const total = 5;
  function tick() {
    done++;
    onProgress(done / total);
    if (done === total) onDone();
  }

  assets.map = new Image();
  assets.map.onload  = () => { assets.mapOk       = true;  tick(); };
  assets.map.onerror = () => { assets.mapOk       = false; tick(); };
  assets.map.src = 'assets/hanriver_map.png';

  assets.quokka = new Image();
  assets.quokka.onload  = () => { assets.quokkaOk    = true;  tick(); };
  assets.quokka.onerror = () => { assets.quokkaOk    = false; tick(); };
  assets.quokka.src = 'assets/quokka.png';

  assets.walkSheet = new Image();
  assets.walkSheet.onload  = () => { assets.walkSheetOk = true;  tick(); };
  assets.walkSheet.onerror = () => { assets.walkSheetOk = false; tick(); };
  assets.walkSheet.src = 'assets/walk_spritesheet.png';

  assets.tube = new Image();
  assets.tube.onload  = () => { assets.tubeOk = true;  tick(); };
  assets.tube.onerror = () => { assets.tubeOk = false; tick(); };
  assets.tube.src = 'assets/tube.png';

  loadCollisionMap(() => tick());
}

// ─── Canvas ───────────────────────────────────────────────────────────────────
const canvas     = document.getElementById('gameCanvas');
const ctx        = canvas.getContext('2d');
const miniCanvas = document.getElementById('miniMap');
const miniCtx    = miniCanvas.getContext('2d');
miniCanvas.width = miniCanvas.height = 160;

function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ─── Player color palette ─────────────────────────────────────────────────────
const PLAYER_COLORS = [
  '#FFB3C6','#FFD6A5','#FDFFB6','#CAFFBF',
  '#9BF6FF','#A0C4FF','#BDB2FF','#FFC6FF',
  '#B5EAD7','#C7CEEA','#FFE5B4','#F0C4E4',
];
function getPlayerColor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return PLAYER_COLORS[h % PLAYER_COLORS.length];
}

// ─── State ────────────────────────────────────────────────────────────────────
const socket     = io();
let   selfId     = null;
let   players    = {};
const keys       = {};
let   chatOpen   = false;
let   lastMoveAt = 0;
let   animTick   = 0;

const cam = {
  x: CFG.SPAWN_X - window.innerWidth  / 2,
  y: CFG.SPAWN_Y - window.innerHeight / 2,
};

// ─── Particles ────────────────────────────────────────────────────────────────
// ── Wind system ───────────────────────────────────────────────────────────────
// 바람은 우측 하단 방향으로 일관되게 붑니다 (한강 봄바람 설정)
const wind = {
  angle:       Math.PI * 0.08,  // 방향: 거의 오른쪽, 살짝 아래 (약 15°)
  baseSpeed:   0.55,
  gust:        0,               // 현재 돌풍 세기 0~1
  gustPhase:   0,
  wx:          0,               // 현재 프레임 x 바람 성분
  wy:          0,               // 현재 프레임 y 바람 성분
};

function updateWind() {
  wind.gustPhase += 0.004;
  // 느린 파형 둘을 겹쳐 자연스러운 돌풍 (0 ~ 1)
  wind.gust = Math.max(0,
    0.5 + Math.sin(wind.gustPhase) * 0.3
        + Math.sin(wind.gustPhase * 2.7) * 0.2
  );
  const spd = wind.baseSpeed * (0.5 + wind.gust * 1.0);
  wind.wx = Math.cos(wind.angle) * spd;
  wind.wy = Math.sin(wind.angle) * spd;
}

// ── Petals ────────────────────────────────────────────────────────────────────
const petals = [];

function makePetal(randomY = false) {
  const len = 5 + Math.random() * 10;  // 꽃잎 길이 (long axis)
  const sw = canvas.width  || window.innerWidth;
  const sh = canvas.height || window.innerHeight;
  // world 좌표: 항상 현재 카메라 뷰포트 안에 스폰 → 어디로 이동해도 밀도 유지
  return {
    x:    cam.x + Math.random() * sw,
    y:    randomY
            ? cam.y + Math.random() * sh
            : cam.y - (len * 2 + Math.random() * 300),
    vx:   wind.wx * (0.6 + Math.random() * 0.8),  // 초기속도 ≈ 바람 속도
    vy:   Math.random() * 0.3,                      // 거의 정지 상태에서 떨어짐
    angle:      Math.random() * Math.PI * 2,
    angleV:     0,
    // 꽃잎 치수: 통통하고 양 끝이 뾰족 (rx = 너비, ry = 길이)
    rx:   len * 0.52,
    ry:   len * 0.53,
    // 질량감: 작은 꽃잎은 바람에 더 많이 날림
    mass: 0.5 + (len / 15) * 0.5,
    // 색상: 흰색~연분홍~진분홍
    hue:  330 + Math.random() * 30,
    sat:  20  + Math.random() * 50,
    lit:  80  + Math.random() * 16,
    alpha: 0.5 + Math.random() * 0.45,
  };
}

function initPetals() {
  petals.length = 0;
  for (let i = 0; i < CFG.PETAL_COUNT; i++) petals.push(makePetal(true));
}

const sparkles = [];


function makeSparkle() {
  return {
    x:   Math.random() * MAP_W,
    y:   Math.random() * MAP_H,
    t:   Math.random(),
    dur: 20 + Math.random() * 40,
    r:   0.8 + Math.random() * 1.8,
    br:  0.7 + Math.random() * 0.3,
  };
}
function initSparkles() {
  sparkles.length = 0;
  for (let i = 0; i < CFG.SPARKLE_COUNT; i++) sparkles.push(makeSparkle());
}

// ── Butterflies ───────────────────────────────────────────────────────────────
// 픽셀아트 나비: 2프레임 (날개 펴기 / 올리기), 각 픽셀 = BUTTERFLY_SCALE world px
// 0=투명, 1=날개 메인색, 2=날개 어두운 디테일, 3=몸통
const BUTTERFLY_FRAMES = [
  // Frame 0: 날개 펴기
  [
    [0,0,1,1,0,1,1,0,0],
    [0,1,1,1,0,1,1,1,0],
    [1,1,2,0,0,0,2,1,1],
    [1,1,2,0,3,0,2,1,1],
    [0,1,1,0,3,0,1,1,0],
    [0,0,0,0,3,0,0,0,0],
  ],
  // Frame 1: 날개 올리기
  [
    [0,1,1,0,0,0,1,1,0],
    [1,1,1,0,0,0,1,1,1],
    [0,1,2,0,0,0,2,1,0],
    [0,0,2,0,3,0,2,0,0],
    [0,0,0,0,3,0,0,0,0],
    [0,0,0,0,3,0,0,0,0],
  ],
];
const BUTTERFLY_SCALE = 3;  // 픽셀 1개 = 3 world px

// 팔레트: [날개, 날개어두운, 몸통]
const BUTTERFLY_PALETTES = [
  ['#FFB347', '#C07020', '#3D1C00'],  // 주황
  ['#FF8FBF', '#C0437A', '#3D1C00'],  // 분홍
  ['#FFE066', '#C8A000', '#3D1C00'],  // 노랑
  ['#B8F0C8', '#4EA86A', '#1A3D22'],  // 연두
];

const butterflies = [];

function makeButterfly() {
  const sw = canvas.width  || window.innerWidth;
  const sh = canvas.height || window.innerHeight;
  return {
    x: cam.x + Math.random() * sw,
    y: cam.y + Math.random() * sh,
    vx: (Math.random() - 0.5) * 0.8,
    vy: (Math.random() - 0.5) * 0.4,
    frame: Math.random() < 0.5 ? 0 : 1,
    frameTimer: 0,
    frameRate: 10 + Math.floor(Math.random() * 8),
    phase: Math.random() * Math.PI * 2,
    palette: BUTTERFLY_PALETTES[Math.floor(Math.random() * BUTTERFLY_PALETTES.length)],
    alpha: 0.82 + Math.random() * 0.15,
    wanderX: 0,
    wanderY: 0,
    wanderTimer: 0,
    wanderInterval: 120 + Math.random() * 200,
  };
}

function resetButterflyWander(b) {
  const sw = canvas.width  || window.innerWidth;
  const sh = canvas.height || window.innerHeight;
  b.wanderX = cam.x + Math.random() * sw;
  b.wanderY = cam.y + Math.random() * sh;
  b.wanderTimer = 0;
  b.wanderInterval = 120 + Math.random() * 240;
}

function initButterflies() {
  butterflies.length = 0;
  for (let i = 0; i < 8; i++) {
    const b = makeButterfly();
    resetButterflyWander(b);
    butterflies.push(b);
  }
}

// ─── Socket ───────────────────────────────────────────────────────────────────
socket.on('init', ({ players: sp, selfId: id }) => {
  selfId  = id;
  players = {};
  for (const [k, v] of Object.entries(sp)) {
    players[k] = { ...v, chatMsg: '', chatTtl: 0, walkFrame: 0 };
  }
  // 이름 레이블 업데이트
  if (players[selfId]) {
    const nameEl = document.getElementById('chatInputName');
    if (nameEl) nameEl.textContent = players[selfId].name;
  }
  if (players[selfId]) {
    cam.x = players[selfId].x - canvas.width  / 2;
    cam.y = players[selfId].y - canvas.height / 2;
  }
  updatePlayerCount();
});

socket.on('playerJoined', (p) => {
  players[p.id] = { ...p, chatMsg: '', chatTtl: 0, walkFrame: 0 };
  updatePlayerCount();
});

socket.on('playerMoved', ({ id, x, y, direction, isWalking }) => {
  const p = players[id];
  if (!p) return;
  p.x = x; p.y = y; p.direction = direction; p.isWalking = isWalking;
});

socket.on('playerLeft', (id) => {
  delete players[id];
  updatePlayerCount();
});

socket.on('chatMessage', ({ id, name, message }) => {
  const p = players[id];
  if (p) { p.chatMsg = message; p.chatTtl = 270; }
  appendChatLog(id, name, message);
});

socket.on('playerSmokingUpdate', ({ id, isSmoking }) => {
  if (players[id]) players[id].isSmoking = isSmoking;
});

function updatePlayerCount() {
  document.getElementById('playerCountNum').textContent = Object.keys(players).length;
}

// ─── Input ────────────────────────────────────────────────────────────────────
function inputFocused() {
  return document.activeElement === document.getElementById('chatInput');
}

document.addEventListener('keydown', (e) => {
  if (!selfId) return;
  // 입력창 포커스 중이 아닐 때만 이동키 기록
  if (!inputFocused()) keys[e.key] = true;

  if (e.key === 'Enter' && !e.isComposing) {  // isComposing: 한글 IME 조합 중 Enter 이중 발사 방지
    e.preventDefault();
    if (!chatOpen) {
      openChat();          // 닫혀있으면 열기
    } else if (inputFocused()) {
      sendChat();          // 포커스 있으면 전송
    } else {
      document.getElementById('chatInput').focus();  // 포커스만
    }
  }
  if (e.key === 'Escape' && chatOpen) closeChat();
});
document.addEventListener('keyup', (e) => { keys[e.key] = false; });

function openChat() {
  chatOpen = true;
  Object.keys(keys).forEach(k => delete keys[k]);
  const wrap   = document.getElementById('chatInputWrap');
  const nameEl = document.getElementById('chatInputName');
  const self   = players[selfId];
  if (self) nameEl.textContent = self.name;
  wrap.style.display = 'block';
  const wrapH = wrap.offsetHeight;
  document.getElementById('chatBox').style.bottom = (16 + wrapH + 16) + 'px';
  document.getElementById('chatInput').focus();
}
function sendChat() {
  const el  = document.getElementById('chatInput');
  const msg = el.value.trim();
  if (msg) socket.emit('chat', { message: msg });
  el.value = '';
  // 전송 후 닫지 않음 — 입력창 유지, 포커스 유지
  el.focus();
}
function closeChat() {
  chatOpen = false;
  document.getElementById('chatInput').blur();
  document.getElementById('chatInputWrap').style.display = 'none';
  document.getElementById('chatBox').style.bottom = '16px';
}

// ─── Chat log ─────────────────────────────────────────────────────────────────
function appendChatLog(id, name, message) {
  const log   = document.getElementById('chatLog');
  const line  = document.createElement('div');
  const color = getPlayerColor(id);
  line.className = 'chat-line';
  line.innerHTML = `<span class="chat-name" style="background:${color};color:#111;">${esc(name)}</span>${esc(message)}`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
  while (log.children.length > 60) log.removeChild(log.firstChild);

  // 8.5초 후 페이드아웃 시작, 10초 후 제거
  setTimeout(() => {
    line.style.transition = 'opacity 1.5s ease';
    line.style.opacity = '0';
    setTimeout(() => { if (line.parentNode) line.parentNode.removeChild(line); }, 1500);
  }, 8500);
}
function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Smoking timer ────────────────────────────────────────────────────────────
// ─── Smoking: 10분마다 담배 1개비 카운트 ─────────────────────────────────────
const smoking = {
  count:   1,    // 총 피운 개수 (첫 담배는 이미 피우는 중)
  elapsed: 0,    // 다음 담배까지 경과 초
  _iv:     null,
};

function smokingTick() {
  smoking.elapsed++;
  if (smoking.elapsed >= CFG.CIG_INTERVAL) {
    smoking.count++;
    smoking.elapsed = 0;
  }
  renderSmokingUI();
}

function renderSmokingUI() {
  const fill     = document.getElementById('timerFill');
  const timerVal = document.getElementById('timerValue');
  const cigNum   = document.getElementById('cigNum');
  const cigIcons = document.getElementById('cigIcons');

  const pct = smoking.elapsed / CFG.CIG_INTERVAL;
  fill.style.width = `${pct * 100}%`;

  const remaining = CFG.CIG_INTERVAL - smoking.elapsed;
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  timerVal.textContent = `다음 담배까지 ${m}:${String(s).padStart(2,'0')}`;

  // 카운트 숫자
  cigNum.textContent = smoking.count;

  // 담배 아이콘을 개수만큼 줄 바꿔서 표시 (한 줄에 5개씩)
  const icons = Array.from({ length: smoking.count }, (_, i) => {
    return (i > 0 && i % 5 === 0) ? '<br>🚬' : '🚬';
  }).join('');
  cigIcons.innerHTML = icons || '🚬';
}

function startSmokingCycle() {
  socket.emit('smokingUpdate', { isSmoking: true });
  renderSmokingUI();
  smoking._iv = setInterval(smokingTick, 1000);
}

// ─── Update ───────────────────────────────────────────────────────────────────
function update() {
  const self = players[selfId];
  if (!self) return;

  let dx = 0, dy = 0;
  if (keys['ArrowLeft']  || keys['a'] || keys['A']) { dx -= 1; self.direction = 'left';  }
  if (keys['ArrowRight'] || keys['d'] || keys['D']) { dx += 1; self.direction = 'right'; }
  if (keys['ArrowUp']    || keys['w'] || keys['W']) { dy -= 1; self.direction = 'up';    }
  if (keys['ArrowDown']  || keys['s'] || keys['S']) { dy += 1; self.direction = 'down';  }

  const moving = dx !== 0 || dy !== 0;
  if (dx !== 0 && dy !== 0) { dx *= 0.7071; dy *= 0.7071; }

  // 존별 이동속도 / 부력
  const selfZone  = getCollisionZone(self.x, self.y);
  const moveSpeed = selfZone === 'blue' ? CFG.PLAYER_SPEED * 0.5 : CFG.PLAYER_SPEED;

  // 초록 존(건물): 우산 들고 위로 천천히 떠오름
  if (selfZone === 'green') {
    self.y = Math.max(40, self.y - 1.5);
    socket.emit('move', { x: self.x, y: self.y, direction: self.direction, isWalking: self.isWalking });
  }

  if (moving) {
    self.x = Math.max(40, Math.min(MAP_W - 40, self.x + dx * moveSpeed));
    self.y = Math.max(40, Math.min(MAP_H - 40, self.y + dy * moveSpeed));
    self.walkFrame = ((self.walkFrame || 0) + 0.35) % WALK_FRAMES;
    self.isWalking = true;

    const now = Date.now();
    if (now - lastMoveAt >= CFG.MOVE_EMIT_MS) {
      socket.emit('move', { x: self.x, y: self.y, direction: self.direction, isWalking: true });
      lastMoveAt = now;
    }
  } else {
    if (self.isWalking) {
      socket.emit('move', { x: self.x, y: self.y, direction: self.direction, isWalking: false });
    }
    self.walkFrame = 0;
    self.isWalking = false;
  }

  // Camera smooth follow
  const tx = self.x - canvas.width  / 2;
  const ty = self.y - canvas.height / 2;
  cam.x += (tx - cam.x) * CFG.CAMERA_LERP;
  cam.y += (ty - cam.y) * CFG.CAMERA_LERP;
  cam.x = Math.max(0, Math.min(MAP_W - canvas.width,  cam.x));
  cam.y = Math.max(0, Math.min(MAP_H - canvas.height, cam.y));

  // Wind & petal physics
  updateWind();

  const GRAVITY   = 0.018;   // 중력 가속도 (작은 꽃잎 → 느리게)
  const AIR_DRAG  = 0.97;    // 공기저항 계수 (1 이하 → 감속)
  const WIND_INFL = 0.025;   // 바람이 꽃잎 속도에 영향 주는 비율

  petals.forEach(p => {
    // 1) 중력 (아래로)
    p.vy += GRAVITY / p.mass;

    // 2) 바람 → 꽃잎 속도를 바람 속도 쪽으로 서서히 끌어당김
    p.vx += (wind.wx - p.vx) * WIND_INFL / p.mass;
    p.vy += (wind.wy - p.vy) * (WIND_INFL * 0.3) / p.mass;

    // 3) 공기저항 (속도 감쇄)
    p.vx *= AIR_DRAG;
    p.vy *= AIR_DRAG;

    // 4) 이동
    p.x += p.vx;
    p.y += p.vy;

    // 5) 회전: 수평 속도에 비례 (바람 받을 때 자연스럽게 뒤집힘)
    p.angleV = p.vx * 0.12;
    p.angle += p.angleV;

    if (p.y > cam.y + canvas.height + 40) {
      Object.assign(p, makePetal(false));
    } else if (p.x < cam.x - 200 || p.x > cam.x + canvas.width + 200) {
      // 수평으로 뷰포트에서 너무 멀리 벗어난 꽃잎 → 뷰포트 위로 재생성
      Object.assign(p, makePetal(false));
    }
  });
  sparkles.forEach(s => {
    s.t += 1 / s.dur;
    if (s.t >= 1) Object.assign(s, makeSparkle());
  });

  updateButterflies();

  Object.values(players).forEach(p => { if (p.chatTtl > 0) p.chatTtl--; });


}

// ─── Render ───────────────────────────────────────────────────────────────────
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  renderBackground();   // screen-space base color
  renderMap();          // map image (scaled, viewport-culled)

  ctx.save();
  ctx.translate(-Math.floor(cam.x), -Math.floor(cam.y));

  renderWaterShimmer(); // 강물 반짝임 (world space)
  renderGrassWind();    // 잔디·풀 바람 효과 (world space)
  renderSparkles();
  renderButterflies();  // 나비 (world space)
  renderPetals();
  renderPlayers();

  ctx.restore();

  renderMiniMap();
}

// ── Solid background beneath the map ──────────────────────────────────────────
function renderBackground() {
  ctx.fillStyle = '#3a6b2a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// ── 강물 반짝임 (world y 0~300) ───────────────────────────────────────────────
function renderWaterShimmer() {
  const RIVER_TOP = 0, RIVER_BOT = 300;  // world y
  // 카메라 뷰에 강물이 보이지 않으면 skip
  if (cam.y > RIVER_BOT || cam.y + canvas.height < RIVER_TOP) return;

  const t = animTick;
  const screenTop = Math.max(0, RIVER_TOP - cam.y);
  const screenBot = Math.min(canvas.height, RIVER_BOT - cam.y);
  const rh = screenBot - screenTop;
  if (rh <= 0) return;

  // 물결 라인 여러 개
  for (let row = 0; row < 8; row++) {
    const wy = RIVER_TOP + (RIVER_BOT - RIVER_TOP) * (row / 8) + Math.sin(t * 0.04 + row) * 4;
    const sy = wy;  // world 좌표 (카메라 변환 이미 적용됨)
    const wAlpha = 0.10 + Math.sin(t * 0.05 + row * 1.3) * 0.05;
    ctx.save();
    ctx.globalAlpha = wAlpha;
    ctx.strokeStyle = `rgba(200,240,255,1)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const startX = cam.x - 20;
    const endX   = cam.x + canvas.width + 20;
    ctx.moveTo(startX, sy);
    for (let x = startX; x < endX; x += 18) {
      const yOff = Math.sin((x + t * 1.8) * 0.045 + row) * 3.5;
      ctx.lineTo(x, sy + yOff);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 반짝이는 하이라이트 점
  for (let i = 0; i < 18; i++) {
    const phase = i * 137.5;  // 황금각 분포
    const wx = cam.x + ((phase * 53) % canvas.width);
    const wy = RIVER_TOP + ((phase * 31) % (RIVER_BOT - RIVER_TOP));
    const brightness = (Math.sin(t * 0.08 + phase) + 1) / 2;
    if (brightness < 0.5) continue;
    const r = 1.5 + brightness * 2.5;
    ctx.save();
    ctx.globalAlpha = (brightness - 0.5) * 0.7;
    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 6;
    ctx.shadowColor = '#aaeeff';
    ctx.beginPath();
    ctx.arc(wx, wy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ── 잔디·풀 바람에 흔들림 (world y 3000~3584) ────────────────────────────────
function renderGrassWind() {
  const GRASS_TOP = 3000, GRASS_BOT = MAP_H;
  if (cam.y > GRASS_BOT || cam.y + canvas.height < GRASS_TOP) return;

  const t = animTick;
  // 꽃가루/먼지 파티클: 풀밭 위에서 흩날리는 작은 점들
  for (let i = 0; i < 30; i++) {
    const phase = i * 97.3;
    const wx = cam.x + ((phase * 61) % canvas.width);
    const baseWy = GRASS_TOP + 20 + ((phase * 43) % (GRASS_BOT - GRASS_TOP - 40));
    const wy = baseWy + Math.sin(t * 0.04 + phase) * 8;
    const sway = Math.sin(t * 0.06 + phase * 0.7) * 12;
    const alpha = 0.25 + Math.sin(t * 0.05 + phase) * 0.15;
    if (wy < cam.y || wy > cam.y + canvas.height) continue;
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.fillStyle = '#e8f5a0';
    ctx.shadowBlur = 3;
    ctx.shadowColor = '#ccee44';
    ctx.beginPath();
    ctx.arc(wx + sway, wy, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ── Map: draw 2048×2048 image scaled MAP_SCALE× in world space ───────────────
function renderMap() {
  if (!assets.mapOk) {
    drawFallbackMap();
    return;
  }

  // World region that's visible
  const wx0 = cam.x,                wy0 = cam.y;
  const wx1 = cam.x + canvas.width, wy1 = cam.y + canvas.height;

  // Clamp to map world bounds
  const dx0 = Math.max(0, wx0),  dy0 = Math.max(0, wy0);
  const dx1 = Math.min(MAP_W, wx1), dy1 = Math.min(MAP_H, wy1);
  if (dx1 <= dx0 || dy1 <= dy0) return;

  // Source coords in the 2048×2048 image
  const sx = dx0 / MAP_SCALE,  sy = dy0 / MAP_SCALE;
  const sw = (dx1 - dx0) / MAP_SCALE, sh = (dy1 - dy0) / MAP_SCALE;

  // Destination on screen canvas
  const destX = dx0 - cam.x,  destY = dy0 - cam.y;
  const destW  = dx1 - dx0,   destH  = dy1 - dy0;

  ctx.imageSmoothingEnabled = false;   // keep pixel art crisp
  ctx.drawImage(assets.map, sx, sy, sw, sh, destX, destY, destW, destH);
}

// Fallback: scrolling painted scene when map image missing
function drawFallbackMap() {
  const cx = Math.floor(cam.x), cy = Math.floor(cam.y);
  const cw = canvas.width, ch = canvas.height;

  // Grass
  ctx.fillStyle = '#7AAB4A';
  ctx.fillRect(0, 0, cw, ch);

  // River band at world Y 4000–6000
  const riverTop = 4000, riverBot = 6000;
  const rs = riverTop - cy, re = riverBot - cy;
  if (re > 0 && rs < ch) {
    const bankH = 400;
    // Top sandy bank
    if (rs - bankH < ch && re > 0) {
      ctx.fillStyle = '#D4B896';
      ctx.fillRect(0, Math.max(0, rs - bankH), cw, Math.max(0, Math.min(rs, ch) - Math.max(0, rs - bankH)));
    }
    // River
    ctx.fillStyle = '#3A8FB5';
    ctx.fillRect(0, Math.max(0, rs), cw, Math.min(re, ch) - Math.max(0, rs));
    // Bottom sandy bank
    if (re > 0 && re < ch + bankH) {
      ctx.fillStyle = '#D4B896';
      ctx.fillRect(0, Math.max(0, re), cw, Math.min(ch, re + bankH) - Math.max(0, re));
    }
    // Water wave lines
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const wy = Math.max(0, rs) + ((Math.min(re, ch) - Math.max(0, rs)) / 5) * i;
      ctx.beginPath();
      for (let x = 0; x < cw; x += 40) {
        const y = wy + Math.sin((x + animTick * 2) * 0.06) * 4;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
}

// ── Sparkles ──────────────────────────────────────────────────────────────────
function renderSparkles() {
  const pad = 16;
  const visL = cam.x - pad, visR = cam.x + canvas.width  + pad;
  const visT = cam.y - pad, visB = cam.y + canvas.height + pad;

  sparkles.forEach(s => {
    if (s.x < visL || s.x > visR || s.y < visT || s.y > visB) return;
    const a = s.t < 0.5 ? s.t * 2 : 2 - s.t * 2;
    ctx.save();
    ctx.globalAlpha = a * s.br * 0.85;
    ctx.shadowBlur  = s.r * 5;
    ctx.shadowColor = '#FFE680';
    ctx.fillStyle   = '#FFFDE7';
    const r = s.r, sr = r * 0.35;
    ctx.beginPath();
    ctx.moveTo(s.x,            s.y - r * 2.2);
    ctx.lineTo(s.x + sr,       s.y - sr);
    ctx.lineTo(s.x + r * 2.2,  s.y);
    ctx.lineTo(s.x + sr,       s.y + sr);
    ctx.lineTo(s.x,            s.y + r * 2.2);
    ctx.lineTo(s.x - sr,       s.y + sr);
    ctx.lineTo(s.x - r * 2.2,  s.y);
    ctx.lineTo(s.x - sr,       s.y - sr);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });
}

// ── 나비 업데이트 & 렌더 ───────────────────────────────────────────────────────
function updateButterflies() {
  butterflies.forEach(b => {
    // 프레임 전환
    b.frameTimer++;
    if (b.frameTimer >= b.frameRate) {
      b.frame = 1 - b.frame;
      b.frameTimer = 0;
    }

    // 방랑 목표 갱신
    b.wanderTimer++;
    if (b.wanderTimer >= b.wanderInterval) resetButterflyWander(b);

    // 목표 방향으로 서서히 가속
    const dx = b.wanderX - b.x;
    const dy = b.wanderY - b.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 5) {
      b.vx += (dx / dist) * 0.025;
      b.vy += (dy / dist) * 0.012;
    }

    // 사인파 상하 흔들림 (나비 특유의 불규칙 비행)
    b.phase += 0.06;
    b.vy += Math.sin(b.phase) * 0.018;

    // 최대 속도 제한
    const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (speed > 1.4) { b.vx = (b.vx / speed) * 1.4; b.vy = (b.vy / speed) * 1.4; }

    // 감쇠
    b.vx *= 0.985;
    b.vy *= 0.985;

    b.x += b.vx;
    b.y += b.vy;

    // 뷰포트 밖으로 너무 멀어지면 재생성
    const sw = canvas.width || window.innerWidth;
    const sh = canvas.height || window.innerHeight;
    if (b.x < cam.x - 300 || b.x > cam.x + sw + 300 ||
        b.y < cam.y - 300 || b.y > cam.y + sh + 300) {
      Object.assign(b, makeButterfly());
      resetButterflyWander(b);
    }
  });
}

function renderButterflies() {
  const sc = BUTTERFLY_SCALE;
  butterflies.forEach(b => {
    const frame = BUTTERFLY_FRAMES[b.frame];
    const rows  = frame.length;
    const cols  = frame[0].length;
    const offX  = Math.floor(b.x) - Math.floor(cols * sc / 2);
    const offY  = Math.floor(b.y) - Math.floor(rows * sc / 2);

    ctx.save();
    ctx.globalAlpha = b.alpha;
    ctx.imageSmoothingEnabled = false;

    // 이동 방향에 따라 좌우 반전
    if (b.vx < -0.05) {
      ctx.translate(Math.floor(b.x) * 2 + cols * sc, 0);
      ctx.scale(-1, 1);
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const pv = frame[r][c];
        if (pv === 0) continue;
        ctx.fillStyle = pv === 1 ? b.palette[0] : pv === 2 ? b.palette[1] : b.palette[2];
        ctx.fillRect(offX + c * sc, offY + r * sc, sc, sc);
      }
    }
    ctx.restore();
  });
}

// ── 벚꽃 꽃잎 경로: 위 두 라운드 로브 + 아래 뾰족 (하트형 부채) ─────────────
function petalPath(ctx, rx, ry) {
  const notch = ry * 0.18;   // 위 중앙 오목 깊이
  ctx.beginPath();
  ctx.moveTo(0, ry);          // 아래 뾰족 끝 (꽃받침)

  // 밑 → 오른쪽 로브
  ctx.bezierCurveTo(
     rx * 1.05,  ry * 0.22,
     rx * 1.05, -ry * 0.28,
     rx * 0.60, -ry + notch
  );
  // 오른쪽 로브 끝 → 가운데 오목
  ctx.bezierCurveTo(
     rx * 0.32, -ry - notch * 0.25,
     rx * 0.10, -ry - notch * 0.45,
     0,         -ry + notch * 1.1
  );
  // 가운데 오목 → 왼쪽 로브 끝
  ctx.bezierCurveTo(
    -rx * 0.10, -ry - notch * 0.45,
    -rx * 0.32, -ry - notch * 0.25,
    -rx * 0.60, -ry + notch
  );
  // 왼쪽 로브 → 밑
  ctx.bezierCurveTo(
    -rx * 1.05, -ry * 0.28,
    -rx * 1.05,  ry * 0.22,
     0,          ry
  );
  ctx.closePath();
}

function renderPetals() {
  const pad = 30;
  const visL = cam.x - pad, visR = cam.x + canvas.width  + pad;
  const visT = cam.y - pad, visB = cam.y + canvas.height + pad;
  petals.forEach(p => {
    if (p.x < visL || p.x > visR || p.y < visT || p.y > visB) return;

    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);

    // ① 꽃잎 몸체
    ctx.fillStyle = `hsl(${p.hue}, ${p.sat}%, ${p.lit}%)`;
    petalPath(ctx, p.rx, p.ry);
    ctx.fill();

    // ② 결 줄기: 꽃받침(아래)에서 위로 5개 방사
    ctx.save();
    ctx.strokeStyle = `hsla(${p.hue + 5}, ${p.sat + 8}%, ${Math.max(50, p.lit - 18)}%, 0.38)`;
    ctx.lineWidth = 0.5;
    ctx.lineCap = 'round';
    for (let v = 0; v < 5; v++) {
      const spread = ((v / 4) - 0.5) * 1.1;   // -0.55 ~ +0.55 rad
      const tx = Math.sin(spread) * p.rx * 0.85;
      const ty = -p.ry * 0.55;
      ctx.beginPath();
      ctx.moveTo(0, p.ry * 0.65);
      ctx.quadraticCurveTo(Math.sin(spread) * p.rx * 0.5, 0, tx, ty);
      ctx.stroke();
    }
    ctx.restore();

    // ③ 가운데 살짝 밝은 중심맥
    ctx.fillStyle = `hsla(${p.hue - 5}, ${Math.max(0, p.sat - 18)}%, ${Math.min(p.lit + 14, 100)}%, 0.5)`;
    petalPath(ctx, p.rx * 0.18, p.ry * 0.72);
    ctx.fill();

    // ④ 하이라이트
    ctx.fillStyle = 'rgba(255,255,255,0.20)';
    ctx.beginPath();
    ctx.ellipse(-p.rx * 0.18, p.ry * 0.05, p.rx * 0.42, p.ry * 0.22, -0.35, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  });
}

// ─── Player rendering ─────────────────────────────────────────────────────────
function renderPlayers() {
  Object.values(players)
    .sort((a, b) => a.y - b.y)
    .forEach(p => drawPlayer(p, p.id === selfId));
}

function drawPlayer(player, isSelf) {
  const px = Math.floor(player.x);
  const py = Math.floor(player.y);
  const cw = CFG.CHAR_W, ch = CFG.CHAR_H;

  // 충돌맵 존 확인
  const zone       = getCollisionZone(player.x, player.y);
  const zoneAlpha  = zone === 'yellow' ? 0.3 : 1.0;
  const inWater    = zone === 'blue';
  const inBuilding = zone === 'green';

  // 물에서 둥둥 떠다니는 bob 오프셋 (플레이어마다 위상 다르게)
  const bobPhase  = (player.x * 0.03 + player.y * 0.02) % (Math.PI * 2);
  const bobOffset = inWater ? Math.sin(animTick * 0.048 + bobPhase) * 5 : 0;
  // 렌더링 y (실제 game y는 변경 안 함 — 시각적 효과만)
  const rpy = py + Math.round(bobOffset);

  ctx.save();
  ctx.globalAlpha = zoneAlpha;

  // 물결 파문 + 헤엄 파동
  if (inWater) {
    drawWaterRipple(px, rpy, bobPhase);
    drawSwimWake(px, rpy, player);
  }

  // 그림자: 물 안에서는 생략
  if (!inWater) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(px, rpy - 1, cw * 0.32, 6.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 튜브 뒤 반원 (캐릭터보다 먼저 그림)
  if (inWater) drawTubeBack(px, rpy);

  if (inWater) {
    // 상반신: 정지 스프라이트, 튜브 중심 + 15px 아래까지 클립
    const clipCutY = rpy - ch * 0.42 + 15;
    ctx.save();
    ctx.beginPath();
    ctx.rect(px - cw, rpy - ch, cw * 2, clipCutY - (rpy - ch));
    ctx.clip();
    const wasWalking  = player.isWalking;
    player.isWalking  = false;
    drawQuokkaSprite(px, rpy, player);
    player.isWalking  = wasWalking;
    ctx.restore();

    // 하반신: walk 스프라이트 하단부를 그대로 사용, 20% 투명
    ctx.save();
    ctx.globalAlpha *= 0.20;
    ctx.beginPath();
    ctx.rect(px - cw, clipCutY, cw * 2, ch);
    ctx.clip();
    drawSwimmingLegs(px, rpy, player);
    ctx.restore();
  } else {
    drawQuokkaSprite(px, rpy, player);
  }

  // 튜브 앞 반원 (캐릭터 위에 그림)
  if (inWater) drawTubeFront(px, rpy);

  // 우산 (건물 내부 — 캐릭터 위에 그림)
  if (inBuilding) drawUmbrella(px, rpy, player);


  // Name tag
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.font = `bold 11px 'Noto Sans KR', sans-serif`;
  ctx.textAlign = 'center';
  const nameY = rpy - ch - 8;
  const nameW = ctx.measureText(player.name).width + 14;
  const chipColor = getPlayerColor(player.id);
  ctx.fillStyle = chipColor;
  ctx.beginPath();
  ctx.roundRect(px - nameW / 2, nameY - 13, nameW, 17, 8);
  ctx.fill();
  ctx.fillStyle = '#111';
  ctx.fillText(player.name, px, nameY);
  ctx.restore();

  // Smoke animation on top of sprite
  if (player.isSmoking) drawSmoke(px, rpy, player.direction);

  // Chat bubble
  if (player.chatMsg && player.chatTtl > 0) {
    drawChatBubble(px, rpy - ch - 24, player.chatMsg, player.chatTtl);
  }

  ctx.restore();
}

// ── Quokka sprite ─────────────────────────────────────────────────────────────
// 좌표계: 발 = (0,0), 머리 꼭대기 = (0, -ch)
function drawQuokkaSprite(x, y, player) {
  const cw = CFG.CHAR_W, ch = CFG.CHAR_H;
  const flip = player.direction === 'left';

  ctx.save();
  ctx.translate(x, y);
  if (flip) ctx.scale(-1, 1);
  ctx.imageSmoothingEnabled = false;

  if (player.isWalking && assets.walkSheetOk) {
    // 걷는 중: walk_spritesheet.png 에서 해당 프레임 잘라서 그리기
    const frameIdx = Math.floor(player.walkFrame || 0) % WALK_FRAMES;
    const frameW   = assets.walkSheet.width / WALK_FRAMES;  // 176
    const frameH   = assets.walkSheet.height;               // 176
    ctx.drawImage(
      assets.walkSheet,
      frameIdx * frameW, 0, frameW, frameH,  // source
      -cw / 2, -ch, cw, ch                  // dest
    );
  } else if (assets.quokkaOk) {
    // 정지 중: 기본 스프라이트
    ctx.drawImage(assets.quokka, -cw / 2, -ch, cw, ch);
  } else {
    ctx.fillStyle = '#8B6914';
    ctx.beginPath();
    ctx.roundRect(-cw / 2, -ch, cw, ch, 12);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '20px serif';
    ctx.textAlign = 'center';
    ctx.fillText('🦫', 0, -ch / 2);
  }

  ctx.restore();
}


// ── 수영 튜브 (파란 존 진입 시 캐릭터 허리에 표시) ───────────────────────────
// 원근감: 아랫 반원(뒤) → 캐릭터 → 윗 반원(앞) 순서로 그려야 올바른 레이어
// ── 캔버스 드로잉 튜브 (빨강/흰색 줄무늬, 참고 이미지 스타일) ─────────────────
// 빨강·흰 4칸 교대 — 고전 구명 튜브 스타일
const TUBE_COLORS = ['#E01818','#FFFFFF','#E01818','#FFFFFF','#E01818','#FFFFFF','#E01818','#FFFFFF','#E01818','#FFFFFF'];
const TUBE_SEG    = (Math.PI * 2) / TUBE_COLORS.length;

// 위쪽 반원(뒤, 캐릭터 뒤): π ~ 2π
function drawTubeBack(px, py)  { _drawTubeArc(px, py, Math.PI, Math.PI * 2); }
// 아래쪽 반원(앞, 캐릭터 앞): 0 ~ π
function drawTubeFront(px, py) { _drawTubeArc(px, py, 0, Math.PI); }

function _drawTubeArc(px, py, arcStart, arcEnd) {
  const cw = CFG.CHAR_W, ch = CFG.CHAR_H;
  const cx = px;
  const cy = py - ch * 0.42 + 3;
  const rx = cw * 0.30 + 5;
  const ry = 16;
  const lw = 25;
  const r  = lw / 2;  // 튜브 단면 반지름
  const t  = animTick;

  ctx.save();
  ctx.lineCap = 'butt';

  // ① 얇은 외곽 윤곽선만 (offset 없음)
  ctx.lineWidth   = lw + 4;
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, arcStart, arcEnd);
  ctx.stroke();

  // ② 8칸 줄무늬
  ctx.lineWidth = lw;
  for (let i = 0; i < TUBE_COLORS.length; i++) {
    const s = i * TUBE_SEG, e = s + TUBE_SEG;
    const drawS = Math.max(s, arcStart), drawE = Math.min(e, arcEnd);
    if (drawE <= drawS) continue;
    ctx.strokeStyle = TUBE_COLORS[i];
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, drawS, drawE);
    ctx.stroke();
  }

  // ③ 하단 그림자 — 단면 아래쪽을 어둡게 (입체감 핵심)
  //    cy + r*0.55 : 단면 중심에서 아래로 치우쳐 하단 절반을 덮음
  ctx.lineWidth   = lw * 0.62;
  ctx.strokeStyle = 'rgba(0,0,0,0.38)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.55, rx, ry, 0, arcStart, arcEnd);
  ctx.stroke();

  // ④ 소프트 하이라이트 — 단면 위쪽에 넓은 흰 빛
  ctx.lineWidth   = lw * 0.50;
  ctx.strokeStyle = 'rgba(255,255,255,0.36)';
  ctx.beginPath();
  ctx.ellipse(cx, cy - r * 0.40, rx, ry, 0, arcStart, arcEnd);
  ctx.stroke();

  // ⑤ 선명한 specular — 단면 가장 위쪽 좁은 하이라이트
  ctx.lineWidth   = lw * 0.18;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.ellipse(cx, cy - r * 0.62, rx * 0.88, ry * 0.82, 0, arcStart, arcEnd);
  ctx.stroke();

  // ⑥ 물 반사 림라이트 — 앞 하단에 파란빛
  const rimS = Math.max(Math.PI * 0.38, arcStart);
  const rimE = Math.min(Math.PI * 0.62, arcEnd);
  if (rimE > rimS) {
    const shimmer = 0.22 + Math.sin(t * 0.11) * 0.08;
    ctx.lineWidth   = 5;
    ctx.strokeStyle = `rgba(120,210,255,${shimmer})`;
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.70, rx * 0.65, ry * 0.50, 0, rimS, rimE);
    ctx.stroke();
  }

  ctx.restore();
}


// ── 동심원 파동 (돌 던진 파동처럼 4단계 확산) ────────────────────────────────
function drawWaterRipple(px, py, bobPhase) {
  const ch     = CFG.CHAR_H, cw = CFG.CHAR_W;
  const t      = animTick;
  const wy     = py - ch * 0.42 + 4;
  const tubeRx = cw * 0.30 + 5;

  // 4단계 동심원: 각 링이 tubeRx에서 시작해 바깥으로 퍼지며 페이드
  for (let i = 0; i < 4; i++) {
    const cycle  = ((t * 0.018 + i / 4 + bobPhase * 0.04) % 1);
    const rx     = tubeRx + cycle * 58;   // 튜브 가장자리에서 확산
    const lw     = 1.8 * (1 - cycle);
    const alpha  = (1 - cycle) * 0.48;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#72C8F0';
    ctx.lineWidth   = lw;
    ctx.beginPath();
    ctx.ellipse(px, wy, rx, rx * 0.28, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// ── 헤엄칠 때 물 가르는 파동 효과 ────────────────────────────────────────────
function drawSwimWake(px, py, player) {
  if (!player.isWalking) return;

  const ch  = CFG.CHAR_H;
  const t   = animTick;
  // 수면 y = 튜브 중심 (물이 튜브 레벨에서 갈라짐)
  const wy  = py - ch * 0.42 + 4;

  // 이동 방향 벡터
  const dirMap = { right:[1,0], left:[-1,0], up:[0,-1], down:[0,1] };
  const [fdx, fdy] = dirMap[player.direction] || [1, 0];
  // 수직 방향 (좌우 퍼짐)
  const px2 = -fdy, py2 = fdx;

  ctx.save();

  // ── ① V자 항적 (wake) : 뒤로 퍼지는 두 선
  for (let i = 0; i < 5; i++) {
    const age    = ((t * 0.028 + i / 5) % 1);
    const dist   = age * 55;           // 뒤로 얼마나 멀어지나
    const spread = age * 38;           // 옆으로 얼마나 퍼지나
    const alpha  = (1 - age) * 0.42;
    const lw     = 1.8 * (1 - age * 0.7);

    ctx.strokeStyle = `rgba(120,195,240,${alpha})`;
    ctx.lineWidth   = lw;

    // 왼쪽 항적
    ctx.beginPath();
    ctx.moveTo(px, wy);
    ctx.quadraticCurveTo(
      px - fdx * dist * 0.4 + px2 * spread * 0.5,
      wy - fdy * dist * 0.4 + py2 * spread * 0.5,
      px - fdx * dist + px2 * spread,
      wy - fdy * dist + py2 * spread
    );
    ctx.stroke();

    // 오른쪽 항적
    ctx.beginPath();
    ctx.moveTo(px, wy);
    ctx.quadraticCurveTo(
      px - fdx * dist * 0.4 - px2 * spread * 0.5,
      wy - fdy * dist * 0.4 - py2 * spread * 0.5,
      px - fdx * dist - px2 * spread,
      wy - fdy * dist - py2 * spread
    );
    ctx.stroke();
  }

  // ── ② 이물 파도 (bow wave): 전면에서 반원형으로 퍼지는 호
  for (let i = 0; i < 3; i++) {
    const age   = ((t * 0.045 + i / 3) % 1);
    const r     = 12 + age * 32;
    const alpha = (1 - age) * 0.50;
    const bowX  = px + fdx * 18;
    const bowY  = wy + fdy * 6;
    const angle = Math.atan2(fdy, fdx);

    ctx.strokeStyle = `rgba(170,225,255,${alpha})`;
    ctx.lineWidth   = 2.2 * (1 - age);
    ctx.beginPath();
    // 전진 방향 앞쪽 반원
    ctx.arc(bowX, bowY, r, angle - Math.PI * 0.55, angle + Math.PI * 0.55);
    ctx.stroke();
  }

  ctx.restore();
}

// ── 수영 다리 — walk 스프라이트시트 하단부를 그대로 활용 ─────────────────────
// 클립은 호출부에서 이미 적용되어 있음. 여기서는 스프라이트만 그림.
function drawSwimmingLegs(px, py, player) {
  if (!assets.walkSheetOk) return;

  const cw = CFG.CHAR_W, ch = CFG.CHAR_H;
  const flip = player.direction === 'left';

  // 물 안에서는 animTick 기반으로 독립 프레임 사이클 (움직임 여부 무관)
  const swimFrame = Math.floor(animTick * 0.22) % WALK_FRAMES;
  const frameW    = assets.walkSheet.width / WALK_FRAMES;
  const frameH    = assets.walkSheet.height;

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(px, py);
  if (flip) ctx.scale(-1, 1);

  ctx.drawImage(
    assets.walkSheet,
    swimFrame * frameW, 0, frameW, frameH,
    -cw / 2, -ch, cw, ch
  );

  ctx.restore();
}


// ── Smoke animation ───────────────────────────────────────────────────────────
function drawSmoke(px, py, direction) {
  const flip  = direction === 'left';
  const sign  = flip ? -1 : 1;
  const t     = Date.now() / 1000;

  // Cigarette tip position (mouth area of sprite)
  const baseX = px + sign * (CFG.CHAR_W * 0.36);
  const baseY = py - CFG.CHAR_H * 0.58;

  const PARTICLES = 10;
  const SPEED     = 0.7;   // how fast smoke rises

  for (let i = 0; i < PARTICLES; i++) {
    const offset = i / PARTICLES;
    const ph     = ((t * SPEED + offset) % 1);  // 0 → 1 lifecycle

    // Near the tip: tight and fast. Far up: wanders and expands.
    const rise    = ph * 70;
    const wander  = Math.sin(ph * Math.PI * 2.5 + i * 0.9) * (ph * 18);
    const sx      = baseX + sign * ph * 6 + wander;
    const sy      = baseY - rise;

    // Puff grows from small at tip to large cloud above
    const size    = 2 + ph * 22;

    // Dense and opaque near tip, fades as it rises
    const alpha   = ph < 0.15
      ? (ph / 0.15) * 0.9          // quick fade-in right at tip
      : (1 - ph) * 0.75;           // slow fade-out as it rises

    ctx.save();
    ctx.globalAlpha = alpha;

    // White smoke with very slight warm tint near ember, pure white higher up
    const warmth = Math.round(255 - ph * 12);
    ctx.fillStyle = `rgb(${warmth}, ${warmth}, 255)`;

    // Soft puff using radial gradient for each particle
    const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, size);
    grad.addColorStop(0,   `rgba(255,255,255,${alpha})`);
    grad.addColorStop(0.5, `rgba(245,245,255,${alpha * 0.6})`);
    grad.addColorStop(1,   `rgba(230,230,255,0)`);

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sx, sy, size, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}


// ── 우산 (초록 존 — 건물 내부) ────────────────────────────────────────────────
function drawUmbrella(px, py, player) {
  const cw = CFG.CHAR_W, ch = CFG.CHAR_H;
  const flip = player.direction === 'left';
  const sign = flip ? -1 : 1;

  // 우산 중심: 담배 반대 손 위, 캐릭터 머리 위
  const ux = px - sign * cw * 0.10;
  const uy = py - ch * 1.05;
  const r  = 46; // 우산 반지름

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  // 손잡이 (우산 중심 → 캐릭터 손 위치)
  ctx.strokeStyle = '#8AAABB';
  ctx.lineWidth   = 4;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(ux, uy + 4);
  ctx.lineTo(ux, uy + ch * 0.55);
  ctx.stroke();

  // 우산 돔 — 8등분 파이 (파란/베이지 교대)
  const SEG   = 8;
  const COLS  = ['#5B6FBF','#E8D5A8','#5B6FBF','#E8D5A8','#5B6FBF','#E8D5A8','#5B6FBF','#E8D5A8'];
  const sweep = Math.PI / SEG;
  for (let i = 0; i < SEG; i++) {
    const sa = Math.PI + i * sweep;
    const ea = sa + sweep;
    ctx.fillStyle = COLS[i];
    ctx.beginPath();
    ctx.moveTo(ux, uy);
    ctx.arc(ux, uy, r, sa, ea);
    ctx.closePath();
    ctx.fill();
  }

  // 외곽 테두리
  ctx.strokeStyle = 'rgba(30,30,70,0.55)';
  ctx.lineWidth   = 1.8;
  ctx.beginPath();
  ctx.arc(ux, uy, r, Math.PI, 0);
  ctx.moveTo(ux - r, uy); ctx.lineTo(ux + r, uy); // 하단 직선
  ctx.stroke();

  // 세그먼트 구분선
  ctx.strokeStyle = 'rgba(30,30,70,0.30)';
  ctx.lineWidth   = 1;
  for (let i = 1; i < SEG; i++) {
    const a = Math.PI + i * sweep;
    ctx.beginPath();
    ctx.moveTo(ux, uy);
    ctx.lineTo(ux + Math.cos(a) * r, uy + Math.sin(a) * r);
    ctx.stroke();
  }

  // 상단 손잡이 knob
  ctx.fillStyle = '#9B6B3A';
  ctx.beginPath();
  ctx.ellipse(ux, uy, 5, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  // 하이라이트
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath();
  ctx.arc(ux - r * 0.08, uy - r * 0.15, r * 0.62, Math.PI * 1.08, Math.PI * 1.92);
  ctx.lineTo(ux, uy);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

// ── Chat bubble ───────────────────────────────────────────────────────────────
function drawChatBubble(x, y, message, ttl) {
  const alpha = ttl < 60 ? ttl / 60 : 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.font = 'bold 12px sans-serif';

  const maxW = 190;
  const lines = [''];
  for (const ch of message) {
    const test = lines[lines.length - 1] + ch;
    if (ctx.measureText(test).width > maxW && lines[lines.length - 1].length > 0) {
      lines.push(ch);
    } else {
      lines[lines.length - 1] = test;
    }
  }

  const lineH = 16, padX = 12, padY = 8;
  const bw = Math.max(...lines.map(l => ctx.measureText(l).width)) + padX * 2;
  const bh = lines.length * lineH + padY * 2;
  const bx = x - bw / 2, by = y - bh;

  // 말풍선 배경 (삼각형 없음)
  ctx.fillStyle   = 'rgba(255,255,255,0.95)';
  ctx.strokeStyle = 'rgba(100,80,120,0.35)';
  ctx.lineWidth   = 1.2;
  ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 10); ctx.fill(); ctx.stroke();

  // 텍스트 — 수직 정중앙 (textBaseline middle 사용)
  ctx.fillStyle  = '#1a1a2e';
  ctx.textAlign  = 'center';
  ctx.textBaseline = 'middle';
  const textStartY = by + padY + lineH / 2;
  lines.forEach((line, i) => ctx.fillText(line, x, textStartY + i * lineH));
  ctx.restore();
}

// ─── Mini-map ─────────────────────────────────────────────────────────────────
function renderMiniMap() {
  const mw = 160, mh = 160;
  miniCtx.clearRect(0, 0, mw, mh);

  // Background
  miniCtx.fillStyle = '#3a6b2a';
  miniCtx.fillRect(0, 0, mw, mh);

  // Map thumbnail
  if (assets.mapOk) {
    miniCtx.imageSmoothingEnabled = true;
    miniCtx.drawImage(assets.map, 0, 0, mw, mh);
  }

  // Viewport rect
  const vx = (cam.x / MAP_W) * mw;
  const vy = (cam.y / MAP_H) * mh;
  const vw = (canvas.width  / MAP_W) * mw;
  const vh = (canvas.height / MAP_H) * mh;

  miniCtx.strokeStyle = 'rgba(255,255,255,0.55)';
  miniCtx.lineWidth   = 1;
  miniCtx.strokeRect(vx, vy, vw, vh);

  // All players (including self) — use per-player color
  Object.values(players).forEach(p => {
    const mx = (p.x / MAP_W) * mw, my = (p.y / MAP_H) * mh;
    const isSelfDot = p.id === selfId;
    miniCtx.fillStyle   = getPlayerColor(p.id);
    miniCtx.strokeStyle = '#fff';
    miniCtx.lineWidth   = 1;
    miniCtx.beginPath(); miniCtx.arc(mx, my, isSelfDot ? 3.5 : 2.5, 0, Math.PI * 2);
    miniCtx.fill();
    if (isSelfDot) miniCtx.stroke();
  });

  // Border
  miniCtx.strokeStyle = 'rgba(255,182,210,0.4)';
  miniCtx.lineWidth   = 1;
  miniCtx.strokeRect(0, 0, mw, mh);
}

// ─── Game loop ────────────────────────────────────────────────────────────────
function loop() {
  animTick++;
  update();
  render();
  requestAnimationFrame(loop);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
const loginScreen   = document.getElementById('loginScreen');
const loadingScreen = document.getElementById('loadingScreen');
const gameUI        = document.getElementById('gameUI');

document.getElementById('loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('nameInput').value.trim().slice(0, 12);
  if (!name) return;

  loginScreen.classList.add('hidden');
  setTimeout(() => { loginScreen.style.display = 'none'; }, 400);

  loadingScreen.classList.add('active');

  loadAssets(
    (pct) => {
      document.getElementById('loadingBar').style.width = `${pct * 100}%`;
      document.getElementById('loadingText').textContent =
        pct < 1 ? '이미지 불러오는 중...' : '거의 다 왔어요!';
    },
    () => {
      loadingScreen.classList.remove('active');
      gameUI.classList.add('active');
      // 입력창 즉시 표시 (포커스는 주지 않아 이동 가능)
      chatOpen = true;
      const _wrap = document.getElementById('chatInputWrap');
      _wrap.style.display = 'block';
      // chatBox bottom은 wrap 높이 확정 후 조정
      setTimeout(() => {
        document.getElementById('chatBox').style.bottom = (16 + _wrap.offsetHeight + 16) + 'px';
      }, 0);
      initPetals();
      initSparkles();
      initButterflies();
      startSmokingCycle();
      socket.emit('join', { name });
      requestAnimationFrame(loop);
    }
  );
});
