// ============================================================================
// MAIN.JS — FPS 3D ZOMBIE: TRƯỜNG HỌC BỎ HOANG (Three.js r160, ES Module)
// Chia rõ theo từng phần bằng comment:
//   1. Hằng số cấu hình & công thức độ khó
//   2. Biến trạng thái toàn cục
//   3. Âm thanh (Web Audio API)
//   4. Xây dựng map trường học (sân trước, hành lang, phòng học, cầu thang, tầng 2)
//   5. Player & PointerLockControls (di chuyển, chạy nhanh, nhảy, va chạm, độ cao địa hình)
//   6. Vũ khí (4 loại súng, viewmodel, bắn bán tự động/tự động, nạp đạn, zoom)
//   7. Zombie thường & Boss (spawn, AI đuổi cắn, triệu hồi, tăng tốc khi máu thấp)
//   8. Hiệu ứng đạn & nổ
//   9. HUD & Minimap
//   10. Quản lý màn chơi vô hạn + độ khó tăng dần
//   11. Lưu / tải tiến trình (localStorage)
//   12. Máy trạng thái game (menu / chơi / thua)
//   13. Sự kiện giao diện
//   14. Game loop
// ============================================================================

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

/* ============================================================================
   PHẦN 1: HẰNG SỐ CẤU HÌNH & CÔNG THỨC ĐỘ KHÓ
   ============================================================================ */
const MAP_HALF = 40;
const WALL_HEIGHT = 6;
const WALL_THICKNESS = 1;
const INNER_BOUND = MAP_HALF - WALL_THICKNESS - 0.5;

const PLAYER_RADIUS = 0.5;
const ZOMBIE_RADIUS = 0.7;
const EYE_HEIGHT = 1.7;
const SPRINT_MULT = 1.8;

// --- Khu vực cầu thang & tầng 2 (dùng để tính độ cao địa hình theo kiểu "height-map" đơn giản,
//     không dùng vật lý 3D đầy đủ vì phạm vi game nhỏ) ---
const FLOOR2_HEIGHT = 4;
const STAIR_X_MIN = -32, STAIR_X_MAX = -28;
const STAIR_Z_BOTTOM = -15, STAIR_Z_TOP = -30; // đi từ z=-15 (nền đất) lên z=-30 (đỉnh cầu thang)
const PLATFORM_X_MIN = -38, PLATFORM_X_MAX = -28;
const PLATFORM_Z_MIN = -38, PLATFORM_Z_MAX = -30;

// --- Công thức tăng độ khó theo màn N (1-based, vô hạn màn) ---
function zombieCountForLevel(N) { return 10 + N * 5; }
function zombieHealthForLevel(N) { return 1 + Math.floor(N / 3); }
function zombieSpeedForLevel(N) { return 1 + N * 0.1; }
function zombieDamageForLevel(N) { return 8 + N * 2; }
function isBossLevel(N) { return N % 5 === 0; }
function bossHealthForLevel(N) { return 50 + N * 10; }

const WEAPON_DEFS = {
  pistol: { key: '1', name: 'SÚNG LỤC', maxAmmo: 30, damage: 1, fireRate: 0.25, reloadTime: 1.0, pellets: 1, spread: 0.004, range: 200, auto: false, zoomFov: null, color: 0x333333, sound: 'pistol' },
  shotgun: { key: '2', name: 'SHOTGUN', maxAmmo: 8, damage: 3, fireRate: 0.9, reloadTime: 1.8, pellets: 8, spread: 0.06, range: 8, auto: false, zoomFov: null, color: 0x5a3d1e, sound: 'shotgun' },
  sniper: { key: '3', name: 'SNIPER', maxAmmo: 5, damage: 5, fireRate: 1.8, reloadTime: 2.2, pellets: 1, spread: 0.0005, range: 200, auto: false, zoomFov: 25, color: 0x223344, sound: 'sniper' },
  smg: { key: '4', name: 'TIỂU LIÊN', maxAmmo: 40, damage: 1, fireRate: 0.08, reloadTime: 1.6, pellets: 1, spread: 0.02, range: 200, auto: true, zoomFov: null, color: 0x2c2c2c, sound: 'smg' },
};
const NORMAL_FOV = 75;

const SAVE_KEY = 'fps3d_school_save_v1';
const SETTINGS_KEY = 'fps3d_school_settings_v1';

/* ============================================================================
   PHẦN 2: BIẾN TRẠNG THÁI TOÀN CỤC
   ============================================================================ */
let scene, camera, renderer, controls;
const clock = new THREE.Clock();

let gameState = 'menu'; // 'menu' | 'settings' | 'playing' | 'gameover'
let currentLevel = 1;
let score = 0;
let levelTransitioning = false;
let bossActive = false;
let bossSpawned = false;

let obstacles = [];       // { mesh, box } — vật cản chặn va chạm ngang (X/Z)
let zombies = [];         // zombie thường (kể cả zombie con boss triệu hồi)
let boss = null;          // boss hiện tại (nếu có)
let bulletTrails = [];

const player = {
  velocity: new THREE.Vector3(),
  canJump: true,
  health: 100,
  maxHealth: 100,
  isSprinting: false,
};
const moveState = { forward: false, backward: false, left: false, right: false };
let isMouseDown = false; // dùng cho súng tự động (SMG)

let currentWeaponName = 'pistol';
let ammo = {};
let weaponCooldown = 0;
let isReloading = false;
let reloadTimer = 0;
let isZooming = false;
let viewmodels = {};

const settings = { volume: 60, sensitivity: 100 };

/* ============================================================================
   PHẦN 3: ÂM THANH (Web Audio API — tự tổng hợp, không cần file mp3 ngoài)
   ============================================================================ */
let audioCtx = null, masterGain = null, sfxGain = null;

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = settings.volume / 100;
    masterGain.connect(audioCtx.destination);
    sfxGain = audioCtx.createGain();
    sfxGain.gain.value = 1.0;
    sfxGain.connect(masterGain);
  }
  return audioCtx;
}
function setMasterVolume(v) { getAudioCtx(); masterGain.gain.value = v; }

function tone(wave, f1, f2, dur, vol) {
  const ctx = getAudioCtx();
  const now = ctx.currentTime;
  const osc = ctx.createOscillator(); const gain = ctx.createGain();
  osc.type = wave; osc.frequency.setValueAtTime(f1, now);
  if (f2 != null) osc.frequency.exponentialRampToValueAtTime(Math.max(f2, 1), now + dur);
  gain.gain.setValueAtTime(vol, now); gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
  osc.connect(gain); gain.connect(sfxGain); osc.start(now); osc.stop(now + dur);
}

function playSound(type) {
  const ctx = getAudioCtx();
  const now = ctx.currentTime;

  if (type === 'pistol') tone('square', 220, 60, 0.12, 0.3);
  else if (type === 'sniper') tone('sawtooth', 900, 40, 0.4, 0.5);
  else if (type === 'smg') tone('square', 260, 140, 0.06, 0.22);
  else if (type === 'empty') tone('square', 150, null, 0.08, 0.15);
  else if (type === 'reload') tone('triangle', 300, 500, 0.3, 0.15);
  else if (type === 'hit') tone('sawtooth', 500, 100, 0.25, 0.3);
  else if (type === 'playerHurt') tone('sawtooth', 140, null, 0.2, 0.3);
  else if (type === 'zombieGrowl') tone('sawtooth', 90, 60, 0.35, 0.12);
  else if (type === 'shotgun') {
    const bufferSize = ctx.sampleRate * 0.25;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const noise = ctx.createBufferSource(); noise.buffer = buffer;
    const gain = ctx.createGain(); gain.gain.setValueAtTime(0.5, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 1200;
    noise.connect(filter); filter.connect(gain); gain.connect(sfxGain); noise.start(now);
  } else if (type === 'bossRoar') {
    [55, 75, 40].forEach((freq, i) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.linearRampToValueAtTime(freq * 0.5, now + 1.3);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.35, now + 0.15);
      gain.gain.linearRampToValueAtTime(0.001, now + 1.5);
      osc.connect(gain); gain.connect(sfxGain);
      osc.start(now + i * 0.05); osc.stop(now + 1.6);
    });
  }
}

/* ============================================================================
   PHẦN 4: XÂY DỰNG MAP TRƯỜNG HỌC BỎ HOANG
   ============================================================================ */
let concreteTex, glassTex;

function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a20);
  scene.fog = new THREE.Fog(0x1a1a20, 8, 55); // sương mù dày, tối u ám

  camera = new THREE.PerspectiveCamera(NORMAL_FOV, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, EYE_HEIGHT, 35);

  const canvas = document.getElementById('gameCanvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // --- Ánh sáng mờ ảo (u ám, không sáng rực) ---
  scene.add(new THREE.AmbientLight(0x445566, 0.35));
  const dirLight = new THREE.DirectionalLight(0xffddaa, 0.4);
  dirLight.position.set(20, 40, 15);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  dirLight.shadow.camera.left = -50; dirLight.shadow.camera.right = 50;
  dirLight.shadow.camera.top = 50; dirLight.shadow.camera.bottom = -50;
  dirLight.shadow.camera.far = 150;
  scene.add(dirLight);
  // Đèn phụ yếu từ dưới lên để không bị tối đen om
  scene.add(new THREE.HemisphereLight(0x334455, 0x111111, 0.3));

  // --- Texture thật: cỏ (dùng cho sân, tinh chỉnh màu úa tàn) + gạch (dùng cho tường, ố vàng) ---
  const texLoader = new THREE.TextureLoader();
  const grassTex = texLoader.load('https://threejs.org/examples/textures/terrain/grasslight-big.jpg');
  grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
  grassTex.repeat.set(18, 18);

  const brickTex = texLoader.load('https://threejs.org/examples/textures/brick_diffuse.jpg');
  brickTex.wrapS = brickTex.wrapT = THREE.RepeatWrapping;
  concreteTex = brickTex;
  glassTex = createCrackedGlassTexture(); // texture kính nứt tạo bằng canvas (không phụ thuộc URL ngoài không chắc tồn tại)

  // --- Mặt đất (sân trường bỏ hoang, cỏ dại mọc lem nhem -> tint úa vàng) ---
  const groundMat = new THREE.MeshStandardMaterial({ map: grassTex, color: 0x8d8a66 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP_HALF * 2, MAP_HALF * 2), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  buildPerimeterWalls();
  buildCourtyard();
  buildHallway();
  buildClassrooms();
  buildStairsAndFloor2();

  controls = new PointerLockControls(camera, document.body);
  scene.add(controls.getObject());
}

// Tạo texture "kính nứt" bằng canvas: nền trong mờ + vài đường nứt trắng ngẫu nhiên toả ra từ tâm
function createCrackedGlassTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(180,210,220,0.18)';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1.5;
  const cx = size / 2, cy = size / 2;
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2 + Math.random() * 0.3;
    const len = 60 + Math.random() * 90;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    let x = cx, y = cy;
    for (let s = 0; s < 4; s++) {
      x += Math.cos(angle + (Math.random() - 0.5) * 0.6) * (len / 4);
      y += Math.sin(angle + (Math.random() - 0.5) * 0.6) * (len / 4);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return new THREE.CanvasTexture(canvas);
}

function addObstacle(mesh) {
  const box = new THREE.Box3().setFromObject(mesh);
  obstacles.push({ mesh, box });
}

function collidesWithObstacles(x, z, radius) {
  for (const obs of obstacles) {
    const b = obs.box;
    if (x > b.min.x - radius && x < b.max.x + radius && z > b.min.z - radius && z < b.max.z + radius) return true;
  }
  return false;
}

// Trả về độ cao nền tại (x,z): 0 = tầng trệt, tăng dần theo cầu thang, hoặc FLOOR2_HEIGHT ở tầng 2.
// Đây là cách đơn giản hoá "height-map" thay vì dựng vật lý 3D đầy đủ, phù hợp game nhỏ.
function getStandingHeight(x, z) {
  if (x >= STAIR_X_MIN && x <= STAIR_X_MAX && z <= STAIR_Z_BOTTOM && z >= STAIR_Z_TOP) {
    const t = (STAIR_Z_BOTTOM - z) / (STAIR_Z_BOTTOM - STAIR_Z_TOP);
    return t * FLOOR2_HEIGHT;
  }
  if (x >= PLATFORM_X_MIN && x <= PLATFORM_X_MAX && z >= PLATFORM_Z_MIN && z <= PLATFORM_Z_MAX) {
    return FLOOR2_HEIGHT;
  }
  return 0;
}

function makeConcreteMat(tintHex) {
  const m = new THREE.MeshStandardMaterial({ map: concreteTex.clone(), color: tintHex, roughness: 0.95 });
  m.map.needsUpdate = true;
  return m;
}

function wallSegment(x, z, w, h, d, tint, repeatW, repeatH) {
  const mat = makeConcreteMat(tint);
  mat.map.repeat.set(repeatW, repeatH);
  mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, h / 2, z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh);
  addObstacle(mesh);
  return mesh;
}

// --- Tường bao quanh toàn bộ map (bê tông ố vàng, cũ kĩ) ---
function buildPerimeterWalls() {
  const tint = 0xac9a6e; // màu ố vàng cho tường cũ
  const fullLen = MAP_HALF * 2 + WALL_THICKNESS;
  wallSegment(0, -MAP_HALF, fullLen, WALL_HEIGHT, WALL_THICKNESS, tint, fullLen / 4, WALL_HEIGHT / 4);
  wallSegment(0, MAP_HALF, fullLen, WALL_HEIGHT, WALL_THICKNESS, tint, fullLen / 4, WALL_HEIGHT / 4);
  wallSegment(-MAP_HALF, 0, WALL_THICKNESS, WALL_HEIGHT, fullLen, tint, WALL_HEIGHT / 4, fullLen / 4);
  wallSegment(MAP_HALF, 0, WALL_THICKNESS, WALL_HEIGHT, fullLen, tint, WALL_HEIGHT / 4, fullLen / 4);
}

// --- Sân trước: bồn cây + khối bê tông, và tường mặt tiền có cổng vào ---
function buildCourtyard() {
  // Bồn cây (hình trụ đất nâu + tán lá xanh phía trên)
  const potPositions = [[-12, 32], [12, 32], [-18, 27], [18, 27]];
  potPositions.forEach(([x, z]) => {
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1, 0.8, 10),
      new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1 })
    );
    pot.position.set(x, 0.4, z);
    pot.castShadow = true; pot.receiveShadow = true;
    scene.add(pot);
    addObstacle(pot);

    const bush = new THREE.Mesh(
      new THREE.SphereGeometry(1.1, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0x2f4a2f, roughness: 1 })
    );
    bush.position.set(x, 1.4, z);
    bush.castShadow = true;
    scene.add(bush); // tán lá chỉ trang trí, không cần thêm vật cản riêng (đã có bồn bên dưới chặn)
  });

  // Khối bê tông đổ nát nằm rải rác
  const blockPositions = [[0, 30], [-6, 36], [8, 35]];
  blockPositions.forEach(([x, z]) => {
    const size = 1.5 + Math.random() * 1;
    const block = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), makeConcreteMat(0x888880));
    block.position.set(x, size / 2, z);
    block.castShadow = true; block.receiveShadow = true;
    scene.add(block);
    addObstacle(block);
  });

  // Tường mặt tiền (có cổng vào ở giữa, dẫn vào hành lang)
  wallSegment(-11.5, 20, 17, 4, WALL_THICKNESS, 0xac9a6e, 4, 1);
  wallSegment(11.5, 20, 17, 4, WALL_THICKNESS, 0xac9a6e, 4, 1);
}

// --- Hành lang dài có cột trụ + mái che ---
function buildHallway() {
  const pillarMat = () => makeConcreteMat(0x9a8f78);
  for (let z = 12; z >= -12; z -= 6) {
    [-5, 5].forEach((x) => {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 5, 0.8), pillarMat());
      pillar.position.set(x, 2.5, z);
      pillar.castShadow = true; pillar.receiveShadow = true;
      scene.add(pillar);
      addObstacle(pillar);
    });
  }
  // Mái che hành lang (chỉ trang trí, không va chạm vì cao hơn đầu người chơi nhiều)
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(14, 0.3, 30),
    new THREE.MeshStandardMaterial({ color: 0x555550, roughness: 1 })
  );
  roof.position.set(0, 5.2, 0);
  roof.receiveShadow = true;
  scene.add(roof);
}

// --- 4 phòng học hai bên hành lang, có cửa, bàn ghế, bảng đen, cửa sổ kính bể ---
function buildClassrooms() {
  createClassroom(20, 8, 20, 14, 'west', false);   // phòng học Đông-Bắc
  createClassroom(20, -8, 20, 14, 'west', true);    // phòng học Đông-Nam (có cửa kính bể)
  createClassroom(-20, 8, 20, 14, 'east', false);   // phòng học Tây-Bắc
  createClassroom(-20, -8, 20, 14, 'east', false);  // phòng học Tây-Nam
}

// cx,cz: tâm phòng; w,d: chiều rộng/sâu; doorSide: hướng tường có cửa (hướng ra hành lang)
function createClassroom(cx, cz, w, d, doorSide, useBrokenGlassDoor) {
  const tint = 0x8f8a6a;
  const wallH = 3.4;
  const doorGap = 2.2;

  // Tường Bắc & Nam (dọc theo trục X)
  [cz - d / 2, cz + d / 2].forEach((z, idx) => {
    const isDoorWall = (doorSide === 'north' && idx === 0) || (doorSide === 'south' && idx === 1);
    if (isDoorWall) {
      const segLen = (w - doorGap) / 2;
      wallSegment(cx - doorGap / 2 - segLen / 2, z, segLen, wallH, 0.3, tint, segLen / 3, 1);
      wallSegment(cx + doorGap / 2 + segLen / 2, z, segLen, wallH, 0.3, tint, segLen / 3, 1);
    } else {
      wallSegment(cx, z, w, wallH, 0.3, tint, w / 3, 1);
    }
  });

  // Tường Đông & Tây (dọc theo trục Z) — bên "west"/"east" hướng ra hành lang có cửa
  [cx - w / 2, cx + w / 2].forEach((x, idx) => {
    const isDoorWall = (doorSide === 'west' && idx === 0) || (doorSide === 'east' && idx === 1);
    if (isDoorWall) {
      const segLen = (d - doorGap) / 2;
      const wA = wallSegment(x, cz - doorGap / 2 - segLen / 2, 0.3, wallH, segLen, tint, 1, segLen / 3);
      const wB = wallSegment(x, cz + doorGap / 2 + segLen / 2, 0.3, wallH, segLen, tint, 1, segLen / 3);

      // Một trong các phòng có cửa kính bị bể thay vì khoảng trống thường
      if (useBrokenGlassDoor) {
        const glassMat = new THREE.MeshStandardMaterial({ map: glassTex, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
        const glass = new THREE.Mesh(new THREE.PlaneGeometry(doorGap, wallH * 0.9), glassMat);
        glass.rotation.y = Math.PI / 2;
        glass.position.set(x, wallH / 2, cz);
        scene.add(glass); // cửa kính bể: không va chạm, người chơi có thể đi xuyên qua chỗ bể
      }
    } else {
      wallSegment(x, cz, 0.3, wallH, d, tint, 1, d / 3);
    }
  });

  // Bảng đen ở tường xa cửa nhất (trang trí, không va chạm)
  const boardZ = doorSide === 'north' ? cz + d / 2 - 0.3 : cz - d / 2 + 0.3;
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(3, 1.2),
    new THREE.MeshStandardMaterial({ color: 0x0e2a1e })
  );
  board.position.set(cx, 1.8, boardZ);
  scene.add(board);

  // Bàn ghế học sinh xếp thành 2 hàng nhỏ bên trong phòng
  for (let row = -1; row <= 1; row += 2) {
    for (let col = -1; col <= 1; col++) {
      const dx = cx + col * 2.2;
      const dz = cz + row * 2.5;
      const desk = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.75, 0.55), makeConcreteMat(0x6b5a3f));
      desk.position.set(dx, 0.375, dz);
      desk.castShadow = true; desk.receiveShadow = true;
      scene.add(desk);
      addObstacle(desk);

      const chair = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.5), makeConcreteMat(0x4a3f2f));
      chair.position.set(dx, 0.3, dz + row * 0.6);
      chair.castShadow = true; chair.receiveShadow = true;
      scene.add(chair);
      addObstacle(chair);
    }
  }
}

// --- Cầu thang lên tầng 2 (bậc khối hộp xếp chồng, chỉ trang trí — độ cao xử lý qua getStandingHeight)
//     và hành lang tầng 2 nhìn xuống ---
function buildStairsAndFloor2() {
  const stepCount = 15;
  for (let i = 0; i < stepCount; i++) {
    const t = i / (stepCount - 1);
    const stepZ = STAIR_Z_BOTTOM - t * (STAIR_Z_BOTTOM - STAIR_Z_TOP);
    const stepY = t * FLOOR2_HEIGHT;
    const step = new THREE.Mesh(
      new THREE.BoxGeometry(STAIR_X_MAX - STAIR_X_MIN, 0.3, 1.1),
      makeConcreteMat(0x999080)
    );
    step.position.set((STAIR_X_MIN + STAIR_X_MAX) / 2, stepY, stepZ);
    step.receiveShadow = true; step.castShadow = true;
    scene.add(step);
    // Không thêm vào obstacles: bậc thang phải đi bộ ngang qua được, độ cao do getStandingHeight() xử lý
  }

  // Sàn tầng 2 (nền đặc)
  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(PLATFORM_X_MAX - PLATFORM_X_MIN, 0.4, PLATFORM_Z_MAX - PLATFORM_Z_MIN),
    makeConcreteMat(0x9a9080)
  );
  platform.position.set((PLATFORM_X_MIN + PLATFORM_X_MAX) / 2, FLOOR2_HEIGHT - 0.2, (PLATFORM_Z_MIN + PLATFORM_Z_MAX) / 2);
  platform.receiveShadow = true;
  scene.add(platform);

  // Lan can 2 cạnh mở (nhìn xuống sân trong) — có va chạm để tránh rơi
  const railZ = PLATFORM_Z_MIN;
  const rail = new THREE.Mesh(new THREE.BoxGeometry(PLATFORM_X_MAX - PLATFORM_X_MIN, 1, 0.2), makeConcreteMat(0x776b55));
  rail.position.set((PLATFORM_X_MIN + PLATFORM_X_MAX) / 2, FLOOR2_HEIGHT + 0.5, railZ);
  scene.add(rail);
  addObstacle(rail);
}

/* ============================================================================
   PHẦN 5: PLAYER — DI CHUYỂN, CHẠY NHANH, NHẢY, VA CHẠM, ĐỘ CAO ĐỊA HÌNH
   ============================================================================ */
function initPlayerInput() {
  document.addEventListener('keydown', (e) => {
    if (gameState !== 'playing') return;
    switch (e.code) {
      case 'KeyW': moveState.forward = true; break;
      case 'KeyS': moveState.backward = true; break;
      case 'KeyA': moveState.left = true; break;
      case 'KeyD': moveState.right = true; break;
      case 'ShiftLeft': case 'ShiftRight': player.isSprinting = true; break;
      case 'Space':
        if (player.canJump) { player.velocity.y = 8; player.canJump = false; }
        break;
      case 'KeyR': startReload(); break;
      case 'Digit1': switchWeapon('pistol'); break;
      case 'Digit2': switchWeapon('shotgun'); break;
      case 'Digit3': switchWeapon('sniper'); break;
      case 'Digit4': switchWeapon('smg'); break;
    }
  });
  document.addEventListener('keyup', (e) => {
    switch (e.code) {
      case 'KeyW': moveState.forward = false; break;
      case 'KeyS': moveState.backward = false; break;
      case 'KeyA': moveState.left = false; break;
      case 'KeyD': moveState.right = false; break;
      case 'ShiftLeft': case 'ShiftRight': player.isSprinting = false; break;
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (gameState !== 'playing') return;
    if (!controls.isLocked) { controls.lock(); return; }
    if (e.button === 0) { isMouseDown = true; attemptShoot(); }
    else if (e.button === 2) setZoomHeld(true);
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) isMouseDown = false;
    if (e.button === 2) setZoomHeld(false);
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
}

function updatePlayer(delta) {
  player.velocity.x -= player.velocity.x * 10.0 * delta;
  player.velocity.z -= player.velocity.z * 10.0 * delta;
  player.velocity.y -= 25.0 * delta;

  const dir = new THREE.Vector3(
    Number(moveState.right) - Number(moveState.left),
    0,
    Number(moveState.forward) - Number(moveState.backward)
  );
  if (dir.lengthSq() > 0) dir.normalize();

  const sprintFactor = player.isSprinting ? SPRINT_MULT : 1.0;
  const accel = 40.0 * sprintFactor * delta;
  if (moveState.forward || moveState.backward) player.velocity.z -= dir.z * accel;
  if (moveState.left || moveState.right) player.velocity.x -= dir.x * accel;

  const obj = controls.getObject();
  const oldX = obj.position.x, oldZ = obj.position.z;

  controls.moveRight(-player.velocity.x * delta);
  controls.moveForward(-player.velocity.z * delta);

  if (collidesWithObstacles(obj.position.x, oldZ, PLAYER_RADIUS)) obj.position.x = oldX;
  if (collidesWithObstacles(obj.position.x, obj.position.z, PLAYER_RADIUS)) obj.position.z = oldZ;

  obj.position.x = Math.max(-INNER_BOUND, Math.min(INNER_BOUND, obj.position.x));
  obj.position.z = Math.max(-INNER_BOUND, Math.min(INNER_BOUND, obj.position.z));

  // --- Trọng lực / nhảy, có tính độ cao địa hình (cầu thang, tầng 2) ---
  const groundY = getStandingHeight(obj.position.x, obj.position.z);
  obj.position.y += player.velocity.y * delta;
  if (obj.position.y < groundY + EYE_HEIGHT) {
    player.velocity.y = 0;
    obj.position.y = groundY + EYE_HEIGHT;
    player.canJump = true;
  }
}

/* ============================================================================
   PHẦN 6: VŨ KHÍ — 4 LOẠI SÚNG, VIEWMODEL, BẮN, NẠP ĐẠN, ZOOM
   ============================================================================ */
function initWeapons() {
  for (const name in WEAPON_DEFS) ammo[name] = WEAPON_DEFS[name].maxAmmo;

  const configs = {
    pistol: { size: [0.12, 0.12, 0.35], pos: [0.28, -0.28, -0.5] },
    shotgun: { size: [0.14, 0.16, 0.65], pos: [0.3, -0.3, -0.65] },
    sniper: { size: [0.1, 0.1, 0.85], pos: [0.28, -0.25, -0.8] },
    smg: { size: [0.13, 0.15, 0.5], pos: [0.3, -0.28, -0.55] },
  };

  for (const name in WEAPON_DEFS) {
    const def = WEAPON_DEFS[name];
    const cfg = configs[name];
    const group = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(...cfg.size),
      new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.5, metalness: 0.4 })
    );
    group.add(body);

    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.25, 8),
      new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.6 })
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -cfg.size[2] / 2 - 0.1;
    group.add(barrel);

    if (name === 'smg') {
      // Băng đạn phụ để phân biệt trực quan với súng lục
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.08), new THREE.MeshStandardMaterial({ color: 0x1a1a1a }));
      mag.position.set(0, -0.15, 0.05);
      group.add(mag);
    }

    group.position.set(...cfg.pos);
    group.userData.basePos = cfg.pos.slice();
    group.visible = (name === currentWeaponName);
    camera.add(group);
    viewmodels[name] = group;
  }
}

function switchWeapon(name) {
  if (!WEAPON_DEFS[name] || name === currentWeaponName || isReloading) return;
  viewmodels[currentWeaponName].visible = false;
  currentWeaponName = name;
  viewmodels[currentWeaponName].visible = true;
  weaponCooldown = 0;
  setZoomHeld(false);
}

function startReload() {
  if (isReloading || ammo[currentWeaponName] === WEAPON_DEFS[currentWeaponName].maxAmmo) return;
  isReloading = true;
  reloadTimer = WEAPON_DEFS[currentWeaponName].reloadTime;
  playSound('reload');
}

function setZoomHeld(held) {
  if (currentWeaponName !== 'sniper') held = false;
  isZooming = held && WEAPON_DEFS.sniper.zoomFov != null;
  camera.fov = isZooming ? WEAPON_DEFS.sniper.zoomFov : NORMAL_FOV;
  camera.updateProjectionMatrix();
  document.getElementById('zoomVignette').style.display = isZooming ? 'block' : 'none';
}

function updateWeapons(delta) {
  if (weaponCooldown > 0) weaponCooldown -= delta;
  if (isReloading) {
    reloadTimer -= delta;
    if (reloadTimer <= 0) { isReloading = false; ammo[currentWeaponName] = WEAPON_DEFS[currentWeaponName].maxAmmo; }
  }
  const vm = viewmodels[currentWeaponName];
  const base = vm.userData.basePos;
  vm.position.lerp(new THREE.Vector3(base[0], base[1], base[2]), 10 * delta);

  // Súng tự động (SMG): tiếp tục bắn khi giữ chuột trái
  const def = WEAPON_DEFS[currentWeaponName];
  if (def.auto && isMouseDown && gameState === 'playing' && controls.isLocked) {
    attemptShoot();
  }
}

function canShoot() {
  return !isReloading && weaponCooldown <= 0 && ammo[currentWeaponName] > 0;
}

function attemptShoot() {
  if (!canShoot()) {
    if (ammo[currentWeaponName] <= 0 && weaponCooldown <= 0) playSound('empty');
    return;
  }
  const def = WEAPON_DEFS[currentWeaponName];
  ammo[currentWeaponName]--;
  weaponCooldown = def.fireRate;
  playSound(def.sound);

  const vm = viewmodels[currentWeaponName];
  vm.position.z += 0.05;

  const zombieMeshes = zombies.filter(z => z.alive).map(z => z.mesh);
  if (boss && boss.alive) zombieMeshes.push(boss.mesh);
  const obstacleMeshes = obstacles.map(o => o.mesh);
  const allObjects = [...zombieMeshes, ...obstacleMeshes];

  for (let i = 0; i < def.pellets; i++) {
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2(
      (Math.random() - 0.5) * def.spread * 2,
      (Math.random() - 0.5) * def.spread * 2
    );
    raycaster.setFromCamera(ndc, camera);
    raycaster.far = def.range; // shotgun giới hạn tầm ngắn 8 đơn vị
    const intersects = raycaster.intersectObjects(allObjects, false);

    createTracer(raycaster, def.range);

    if (intersects.length > 0 && zombieMeshes.includes(intersects[0].object)) {
      const hitMesh = intersects[0].object;
      let target = zombies.find(z => z.mesh === hitMesh);
      if (!target && boss && boss.mesh === hitMesh) target = boss;
      if (target) hitZombie(target, intersects[0].point, def.damage);
    }
  }
}

/* ============================================================================
   PHẦN 7: ZOMBIE THƯỜNG & BOSS
   ============================================================================ */
function createZombieMesh(scale = 1) {
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0x5c6b5c, roughness: 0.9 }); // xanh xám
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.8 * scale, 1.1 * scale, 0.5 * scale), skin);
  torso.position.y = 1.0 * scale;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5 * scale, 0.5 * scale, 0.5 * scale), skin);
  head.position.y = 1.8 * scale;
  const armGeo = new THREE.BoxGeometry(0.25 * scale, 0.9 * scale, 0.25 * scale);
  const armL = new THREE.Mesh(armGeo, skin); armL.position.set(-0.55 * scale, 1.0 * scale, 0);
  const armR = new THREE.Mesh(armGeo, skin); armR.position.set(0.55 * scale, 1.0 * scale, 0);
  const legGeo = new THREE.BoxGeometry(0.3 * scale, 0.9 * scale, 0.3 * scale);
  const legL = new THREE.Mesh(legGeo, skin); legL.position.set(-0.22 * scale, 0.1 * scale, 0);
  const legR = new THREE.Mesh(legGeo, skin); legR.position.set(0.22 * scale, 0.1 * scale, 0);
  group.add(torso, head, armL, armR, legL, legR);
  group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return group;
}

function createZombieEntity(position, level) {
  const mesh = createZombieMesh(1);
  mesh.position.copy(position);
  scene.add(mesh);

  return {
    mesh, alive: true, isBoss: false,
    health: zombieHealthForLevel(level),
    speed: zombieSpeedForLevel(level),
    damagePerSec: zombieDamageForLevel(level),
    lastMeleeTime: 0,
    lastGrowlTime: -10,
  };
}

function createBossEntity(position, level) {
  const scale = 3;
  const mesh = createZombieMesh(scale);
  mesh.position.copy(position);
  scene.add(mesh);

  return {
    mesh, alive: true, isBoss: true,
    health: bossHealthForLevel(level),
    maxHealth: bossHealthForLevel(level),
    baseSpeed: zombieSpeedForLevel(level) * 0.6,
    damagePerSec: 25,
    lastMeleeTime: 0,
    summonCooldown: 10,
    scale,
  };
}

// Vị trí spawn hợp lệ: tránh cầu thang/tầng 2, tránh vật cản, cách người chơi tối thiểu
function findValidSpawnPosition(playerPos, minDist) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const x = (Math.random() - 0.5) * (INNER_BOUND * 2 - 4);
    const z = (Math.random() - 0.5) * (INNER_BOUND * 2 - 4);
    if (Math.hypot(x - playerPos.x, z - playerPos.z) < minDist) continue;
    if (collidesWithObstacles(x, z, ZOMBIE_RADIUS + 0.3)) continue;
    if (x < -25 && z < -12) continue; // tránh khu cầu thang/tầng 2 (zombie chỉ hoạt động tầng trệt)
    return new THREE.Vector3(x, 0, z);
  }
  return new THREE.Vector3(playerPos.x + 10, 0, playerPos.z + 10);
}

function updateZombieAI(z, delta, playerPos, elapsedTime) {
  if (!z.alive) return;

  const dist = z.mesh.position.distanceTo(playerPos);

  // Zombie luôn lao thẳng về phía người chơi (không đi lang thang)
  let speed = z.isBoss ? z.baseSpeed : z.speed;
  if (z.isBoss) {
    // Tăng tốc khi máu thấp
    const ratio = z.health / z.maxHealth;
    speed *= 1 + (1 - ratio) * 1.5;
  }

  const toPlayer = new THREE.Vector3().subVectors(playerPos, z.mesh.position);
  toPlayer.y = 0;
  if (toPlayer.lengthSq() > 0.0001) toPlayer.normalize();

  const step = toPlayer.multiplyScalar(speed * delta);
  const radius = z.isBoss ? ZOMBIE_RADIUS * z.scale : ZOMBIE_RADIUS;
  const newX = z.mesh.position.x + step.x;
  const newZ = z.mesh.position.z + step.z;

  const blockedX = collidesWithObstacles(newX, z.mesh.position.z, radius) || newX < -INNER_BOUND || newX > INNER_BOUND;
  const blockedZ = collidesWithObstacles(z.mesh.position.x, newZ, radius) || newZ < -INNER_BOUND || newZ > INNER_BOUND;

  if (!blockedX) z.mesh.position.x = newX;
  if (!blockedZ) z.mesh.position.z = newZ;
  if (blockedX && blockedZ) {
    // Kẹt tại chỗ -> né ngang tạm thời bằng cách trượt theo trục vuông góc
    const perp = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x).multiplyScalar(speed * delta);
    const px = z.mesh.position.x + perp.x, pz = z.mesh.position.z + perp.z;
    if (!collidesWithObstacles(px, z.mesh.position.z, radius)) z.mesh.position.x = px;
    if (!collidesWithObstacles(z.mesh.position.x, pz, radius)) z.mesh.position.z = pz;
  }

  z.mesh.lookAt(playerPos.x, z.mesh.position.y, playerPos.z);

  // Gầm gừ khi ở gần
  if (dist < 8 && elapsedTime - z.lastGrowlTime > (2 + Math.random() * 2)) {
    z.lastGrowlTime = elapsedTime;
    playSound('zombieGrowl');
  }

  // Cắn người chơi khi rất gần (gây damage theo giây)
  const biteRange = z.isBoss ? 3.5 : 2.0;
  if (dist < biteRange) {
    if (elapsedTime - z.lastMeleeTime > 1) {
      z.lastMeleeTime = elapsedTime;
      damagePlayer(z.damagePerSec);
    }
  }

  // Boss triệu hồi zombie con mỗi 10 giây
  if (z.isBoss) {
    z.summonCooldown -= delta;
    if (z.summonCooldown <= 0) {
      z.summonCooldown = 10;
      summonMinions(z);
    }
  }
}

function summonMinions(bossEntity) {
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    const pos = bossEntity.mesh.position.clone().add(new THREE.Vector3(Math.cos(angle) * 4, 0, Math.sin(angle) * 4));
    pos.x = Math.max(-INNER_BOUND, Math.min(INNER_BOUND, pos.x));
    pos.z = Math.max(-INNER_BOUND, Math.min(INNER_BOUND, pos.z));
    zombies.push(createZombieEntity(pos, currentLevel));
  }
}

function hitZombie(entity, point, damage) {
  entity.health -= damage;
  if (entity.health <= 0 && entity.alive) {
    entity.alive = false;
    playSound('hit');
    createExplosion(point || entity.mesh.position, entity.isBoss ? 0x330000 : 0x445544);
    if (entity.mesh.parent) scene.remove(entity.mesh);
    score += entity.isBoss ? 1000 : 100;
    updateScoreHUD();
  }
}

function damagePlayer(amount) {
  if (gameState !== 'playing') return;
  player.health = Math.max(0, player.health - amount);
  flashHit();
  playSound('playerHurt');
  if (player.health <= 0) gameOver();
}

/* ============================================================================
   PHẦN 8: HIỆU ỨNG ĐẠN & NỔ
   ============================================================================ */
function createTracer(raycaster, range) {
  const origin = raycaster.ray.origin.clone();
  const end = origin.clone().addScaledVector(raycaster.ray.direction, Math.min(range, 100));
  const geo = new THREE.BufferGeometry().setFromPoints([origin, end]);
  const mat = new THREE.LineBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.85 });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  bulletTrails.push({ mesh: line, life: 0.06 });
}

function updateBulletTrails(delta) {
  for (let i = bulletTrails.length - 1; i >= 0; i--) {
    bulletTrails[i].life -= delta;
    if (bulletTrails[i].life <= 0) { scene.remove(bulletTrails[i].mesh); bulletTrails.splice(i, 1); }
  }
}

function createExplosion(position, color) {
  const particles = [];
  const geo = new THREE.SphereGeometry(0.12, 4, 4);
  const mat = new THREE.MeshBasicMaterial({ color: color || 0x445544 });
  for (let i = 0; i < 14; i++) {
    const p = new THREE.Mesh(geo, mat);
    p.position.copy(position);
    scene.add(p);
    particles.push({ mesh: p, dir: new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2), life: 0.6 });
  }
  const step = () => {
    let alive = false;
    particles.forEach(p => {
      if (p.life > 0) {
        p.life -= 0.02;
        p.mesh.position.addScaledVector(p.dir, 0.15);
        p.dir.y -= 0.02;
        p.mesh.scale.multiplyScalar(0.95);
        alive = true;
      } else if (p.mesh.parent) scene.remove(p.mesh);
    });
    if (alive) requestAnimationFrame(step);
  };
  step();
}

/* ============================================================================
   PHẦN 9: HUD & MINIMAP
   ============================================================================ */
let hudEl = {};
function initHUD() {
  hudEl = {
    score: document.getElementById('score'),
    levelInfo: document.getElementById('levelInfo'),
    enemyCount: document.getElementById('enemyCount'),
    bossHealthWrap: document.getElementById('bossHealthWrap'),
    bossHealthFill: document.getElementById('bossHealthBarFill'),
    heartsWrap: document.getElementById('heartsWrap'),
    weaponName: document.getElementById('weaponName'),
    ammoCount: document.getElementById('ammoCount'),
    ammoMax: document.getElementById('ammoMax'),
    reloadHint: document.getElementById('reloadHint'),
    sprintHint: document.getElementById('sprintHint'),
    minimapCanvas: document.getElementById('minimapCanvas'),
    levelBanner: document.getElementById('levelBanner'),
    hitFlash: document.getElementById('hitFlash'),
  };
  hudEl.heartsWrap.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const span = document.createElement('span');
    span.className = 'heart';
    span.textContent = '❤';
    hudEl.heartsWrap.appendChild(span);
  }
}

function updateScoreHUD() { hudEl.score.textContent = `Điểm: ${score}`; }
function updateLevelHUD() { hudEl.levelInfo.textContent = `Màn: ${currentLevel}`; }
function updateEnemyCountHUD() {
  const remaining = zombies.filter(z => z.alive).length;
  hudEl.enemyCount.textContent = `Zombie còn lại: ${remaining}`;
  if (boss && boss.alive) {
    hudEl.bossHealthWrap.style.display = 'block';
    hudEl.bossHealthFill.style.width = `${Math.max(0, (boss.health / boss.maxHealth) * 100)}%`;
  } else {
    hudEl.bossHealthWrap.style.display = 'none';
  }
}
function updateHealthHUD() {
  const ratio = player.health / player.maxHealth;
  const fullHearts = Math.ceil(ratio * 5);
  Array.from(hudEl.heartsWrap.children).forEach((h, i) => h.classList.toggle('empty', i >= fullHearts));
}
function updateAmmoHUD() {
  const def = WEAPON_DEFS[currentWeaponName];
  hudEl.weaponName.textContent = def.name;
  hudEl.ammoCount.textContent = ammo[currentWeaponName];
  hudEl.ammoMax.textContent = `/ ${def.maxAmmo}`;
  hudEl.reloadHint.textContent = isReloading ? 'Đang nạp đạn...' : (ammo[currentWeaponName] === 0 ? 'Hết đạn! Bấm [R]' : '');
  hudEl.sprintHint.textContent = player.isSprinting ? '⚡ Đang chạy nhanh' : '';
}
function flashHit() {
  hudEl.hitFlash.style.opacity = 1;
  setTimeout(() => { hudEl.hitFlash.style.opacity = 0; }, 150);
}
function showLevelBanner(text) {
  hudEl.levelBanner.textContent = text;
  hudEl.levelBanner.style.opacity = 1;
  setTimeout(() => { hudEl.levelBanner.style.opacity = 0; }, 2000);
}

const MINIMAP_RADIUS = 40;
function drawMinimap(playerPos, yaw) {
  const canvas = hudEl.minimapCanvas;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const cx = w / 2, cy = h / 2;
  const scale = (w / 2) / MINIMAP_RADIUS;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(10,10,10,0.75)';
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#888888';
  obstacles.forEach(obs => {
    const b = obs.box;
    const bx = (b.min.x - playerPos.x) * scale + cx;
    const bz = (b.min.z - playerPos.z) * scale + cy;
    const bw = (b.max.x - b.min.x) * scale;
    const bd = (b.max.z - b.min.z) * scale;
    ctx.fillRect(bx, bz, Math.max(bw, 1), Math.max(bd, 1));
  });

  ctx.fillStyle = '#ff3333';
  zombies.forEach(z => {
    if (!z.alive) return;
    const x = cx + (z.mesh.position.x - playerPos.x) * scale;
    const y = cy + (z.mesh.position.z - playerPos.z) * scale;
    if (x < 0 || x > w || y < 0 || y > h) return;
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
  });

  if (boss && boss.alive) {
    const x = cx + (boss.mesh.position.x - playerPos.x) * scale;
    const y = cy + (boss.mesh.position.z - playerPos.z) * scale;
    ctx.fillStyle = '#ff0000';
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
  }

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(yaw);
  ctx.fillStyle = '#33ff66';
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(5, 6);
  ctx.lineTo(-5, 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/* ============================================================================
   PHẦN 10: QUẢN LÝ MÀN CHƠI VÔ HẠN + ĐỘ KHÓ TĂNG DẦN
   ============================================================================ */
function loadLevel(level) {
  zombies.forEach(z => { if (z.mesh.parent) scene.remove(z.mesh); });
  if (boss && boss.mesh.parent) scene.remove(boss.mesh);
  zombies = []; boss = null; bossActive = false; bossSpawned = false;

  const count = zombieCountForLevel(level);
  const playerPos = controls.getObject().position;
  for (let i = 0; i < count; i++) {
    const pos = findValidSpawnPosition(playerPos, 10);
    zombies.push(createZombieEntity(pos, level));
  }

  updateLevelHUD();
  updateEnemyCountHUD();
  showLevelBanner(`MÀN ${level}${isBossLevel(level) ? ' — CÓ BOSS!' : ''}`);
}

function checkLevelProgress() {
  if (levelTransitioning) return;

  if (bossActive) {
    updateEnemyCountHUD();
    if (boss && !boss.alive) {
      levelTransitioning = true;
      showLevelBanner('BOSS ĐÃ BỊ TIÊU DIỆT!');
      saveProgress();
      setTimeout(() => {
        currentLevel++;
        loadLevel(currentLevel);
        saveProgress();
        levelTransitioning = false;
      }, 2000);
    }
    return;
  }

  const remaining = zombies.filter(z => z.alive).length;
  updateEnemyCountHUD();
  if (remaining > 0) return;

  if (isBossLevel(currentLevel) && !bossSpawned) {
    spawnBoss();
    return;
  }

  levelTransitioning = true;
  saveProgress();
  setTimeout(() => {
    currentLevel++;
    loadLevel(currentLevel);
    saveProgress();
    levelTransitioning = false;
  }, 1200);
}

function spawnBoss() {
  bossSpawned = true;
  bossActive = true;
  const playerPos = controls.getObject().position;
  const pos = new THREE.Vector3(playerPos.x + 12, 0, playerPos.z - 12);
  boss = createBossEntity(pos, currentLevel);
  playSound('bossRoar');
  showLevelBanner('⚠ BOSS XUẤT HIỆN!');
}

/* ============================================================================
   PHẦN 11: LƯU / TẢI TIẾN TRÌNH (localStorage) — tự động lưu mỗi màn
   ============================================================================ */
function saveProgress() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      level: currentLevel, score, health: player.health, weapon: currentWeaponName, ammo,
    }));
  } catch (e) {}
}
function loadSaveData() {
  try { const raw = localStorage.getItem(SAVE_KEY); return raw ? JSON.parse(raw) : null; }
  catch (e) { return null; }
}
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }

function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {} }
function loadSettings() {
  try { const raw = localStorage.getItem(SETTINGS_KEY); if (raw) Object.assign(settings, JSON.parse(raw)); }
  catch (e) {}
}

/* ============================================================================
   PHẦN 12: MÁY TRẠNG THÁI GAME (menu / chơi / thua)
   ============================================================================ */
function showScreen(id) {
  ['menuScreen', 'settingsScreen', 'gameOverScreen'].forEach(s => {
    document.getElementById(s).classList.toggle('hidden', s !== id);
  });
}

function goToMenu() {
  gameState = 'menu';
  controls.unlock();
  document.getElementById('hud').style.display = 'none';
  showScreen('menuScreen');
  document.getElementById('continueBtn').disabled = !loadSaveData();
}

function resetPlayerState() {
  const obj = controls.getObject();
  obj.position.set(0, EYE_HEIGHT, 35);
  obj.rotation.set(0, 0, 0);
  player.velocity.set(0, 0, 0);
  player.isSprinting = false;
  isMouseDown = false;
}

function newGame() {
  clearSave();
  currentLevel = 1;
  score = 0;
  levelTransitioning = false;
  resetPlayerState();
  player.health = player.maxHealth;

  for (const name in WEAPON_DEFS) ammo[name] = WEAPON_DEFS[name].maxAmmo;
  Object.keys(viewmodels).forEach(n => viewmodels[n].visible = (n === 'pistol'));
  currentWeaponName = 'pistol';
  isReloading = false; weaponCooldown = 0;
  setZoomHeld(false);

  updateScoreHUD();
  loadLevel(1);
  beginPlaying();
}

function continueGame() {
  const data = loadSaveData();
  if (!data) return;

  currentLevel = Math.max(1, data.level || 1);
  score = data.score || 0;
  levelTransitioning = false;
  resetPlayerState();
  player.health = data.health ?? player.maxHealth;

  if (data.ammo) ammo = { ...ammo, ...data.ammo };
  const weapon = data.weapon && WEAPON_DEFS[data.weapon] ? data.weapon : 'pistol';
  Object.keys(viewmodels).forEach(n => viewmodels[n].visible = (n === weapon));
  currentWeaponName = weapon;
  isReloading = false; weaponCooldown = 0;
  setZoomHeld(false);

  updateScoreHUD();
  loadLevel(currentLevel);
  beginPlaying();
}

function beginPlaying() {
  showScreen(null);
  document.getElementById('hud').style.display = 'block';
  gameState = 'playing';
  controls.lock();
  updateHealthHUD();
  updateAmmoHUD();
  updateLevelHUD();
}

function gameOver() {
  gameState = 'gameover';
  controls.unlock();
  clearSave();
  document.getElementById('hud').style.display = 'none';
  document.getElementById('finalScore').textContent = `Điểm số của bạn: ${score}`;
  document.getElementById('finalLevel').textContent = `Màn đạt được: ${currentLevel}`;
  showScreen('gameOverScreen');
}

/* ============================================================================
   PHẦN 13: SỰ KIỆN GIAO DIỆN
   ============================================================================ */
function initUIEvents() {
  document.getElementById('newGameBtn').addEventListener('click', newGame);
  document.getElementById('continueBtn').addEventListener('click', continueGame);
  document.getElementById('settingsBtn').addEventListener('click', () => showScreen('settingsScreen'));
  document.getElementById('settingsBackBtn').addEventListener('click', () => showScreen('menuScreen'));
  document.getElementById('exitBtn').addEventListener('click', () => {
    if (confirm('Bạn có chắc muốn thoát game?')) {
      window.close();
      setTimeout(() => alert('Trình duyệt chặn đóng tab tự động. Vui lòng đóng tab thủ công.'), 300);
    }
  });

  document.getElementById('restartBtn').addEventListener('click', newGame);
  document.getElementById('backToMenuBtn').addEventListener('click', goToMenu);

  const volumeSlider = document.getElementById('volumeSlider');
  const sensSlider = document.getElementById('sensSlider');
  volumeSlider.value = settings.volume;
  sensSlider.value = settings.sensitivity;
  document.getElementById('volumeVal').textContent = `${settings.volume}%`;
  document.getElementById('sensVal').textContent = `${(settings.sensitivity / 100).toFixed(1)}x`;
  setMasterVolume(settings.volume / 100);
  controls.pointerSpeed = settings.sensitivity / 100;

  volumeSlider.addEventListener('input', () => {
    settings.volume = Number(volumeSlider.value);
    document.getElementById('volumeVal').textContent = `${settings.volume}%`;
    setMasterVolume(settings.volume / 100);
    saveSettings();
  });
  sensSlider.addEventListener('input', () => {
    settings.sensitivity = Number(sensSlider.value);
    document.getElementById('sensVal').textContent = `${(settings.sensitivity / 100).toFixed(1)}x`;
    controls.pointerSpeed = settings.sensitivity / 100;
    saveSettings();
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  window.addEventListener('beforeunload', () => {
    if (gameState === 'playing') saveProgress();
  });
}

/* ============================================================================
   PHẦN 14: GAME LOOP
   ============================================================================ */
function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.1);

  if (gameState === 'playing') {
    if (controls.isLocked && !levelTransitioning) {
      const elapsed = clock.getElapsedTime();
      const playerPos = controls.getObject().position;

      updatePlayer(delta);
      updateWeapons(delta);
      zombies.forEach(z => updateZombieAI(z, delta, playerPos, elapsed));
      if (boss && boss.alive) updateZombieAI(boss, delta, playerPos, elapsed);
      updateBulletTrails(delta);
      checkLevelProgress();
    }

    updateHealthHUD();
    updateAmmoHUD();
    drawMinimap(controls.getObject().position, controls.getObject().rotation.y);
  }

  renderer.render(scene, camera);
}

/* ============================================================================
   KHỞI ĐỘNG ỨNG DỤNG
   ============================================================================ */
function init() {
  loadSettings();
  initScene();
  initHUD();
  initWeapons();
  initPlayerInput();
  initUIEvents();
  goToMenu();
  animate();
}

init();
