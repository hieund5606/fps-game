// ============================================================================
// MAIN.JS — FPS 3D SHOOTER (Three.js r160, ES Module)
// Toàn bộ logic game nằm trong 1 file, chia rõ theo từng phần bằng comment:
//   1. Import & hằng số
//   2. Biến trạng thái toàn cục
//   3. Âm thanh (Web Audio API)
//   4. Khởi tạo scene (map 80x80, tường bao, hộp vật cản, ánh sáng)
//   5. Player & PointerLockControls (di chuyển, nhảy, va chạm tường)
//   6. Vũ khí (3 loại súng, viewmodel, bắn, nạp đạn, zoom)
//   7. Quái (spawn, di chuyển né tường, bắn trả, va chạm)
//   8. Đạn & hiệu ứng
//   9. HUD & Minimap
//   10. Quản lý màn chơi
//   11. Lưu / tải tiến trình (localStorage)
//   12. Máy trạng thái game (menu / chơi / thua / thắng)
//   13. Sự kiện giao diện (menu, cài đặt, bàn phím, chuột)
//   14. Game loop
// ============================================================================

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

/* ============================================================================
   PHẦN 1: HẰNG SỐ CẤU HÌNH
   ============================================================================ */
const MAP_HALF = 40;          // map hình vuông từ -40 đến +40
const WALL_HEIGHT = 6;
const WALL_THICKNESS = 1;
const INNER_BOUND = MAP_HALF - WALL_THICKNESS - 0.5; // biên an toàn phía trong tường (~38.5)

const PLAYER_RADIUS = 0.5;
const ENEMY_RADIUS = 0.7;
const EYE_HEIGHT = 1.7;

const LEVELS = [
  { enemyCount: 5 },   // Màn 1
  { enemyCount: 8 },   // Màn 2
  { enemyCount: 12 },  // Màn 3
];

const WEAPON_DEFS = {
  pistol: { key: '1', name: 'SÚNG LỤC', maxAmmo: 30, damage: 1, fireRate: 0.25, reloadTime: 1.0, pellets: 1, spread: 0.004, zoomFov: null, color: 0x333333, sound: 'pistol' },
  shotgun: { key: '2', name: 'SHOTGUN', maxAmmo: 8, damage: 3, fireRate: 0.9, reloadTime: 1.8, pellets: 8, spread: 0.05, zoomFov: null, color: 0x5a3d1e, sound: 'shotgun' },
  sniper: { key: '3', name: 'SNIPER', maxAmmo: 5, damage: 5, fireRate: 1.8, reloadTime: 2.2, pellets: 1, spread: 0.0005, zoomFov: 25, color: 0x223344, sound: 'sniper' },
};
const NORMAL_FOV = 75;

const SAVE_KEY = 'fps3d_save_v2';
const SETTINGS_KEY = 'fps3d_settings_v2';

/* ============================================================================
   PHẦN 2: BIẾN TRẠNG THÁI TOÀN CỤC
   ============================================================================ */
let scene, camera, renderer, controls;
const clock = new THREE.Clock();

let gameState = 'menu'; // 'menu' | 'settings' | 'playing' | 'gameover' | 'win'
let currentLevelIndex = 0;
let score = 0;
let levelTransitioning = false;

// Vật cản: mảng { mesh, box } dùng để kiểm tra va chạm (tường + hộp)
let obstacles = [];

// Quái, đạn của quái, tia đạn của người chơi
let enemies = [];
let enemyProjectiles = [];
let bulletTrails = [];

// Người chơi
const player = {
  velocity: new THREE.Vector3(),
  canJump: true,
  health: 100,
  maxHealth: 100,
};
const moveState = { forward: false, backward: false, left: false, right: false };

// Vũ khí
let currentWeaponName = 'pistol';
let ammo = {};
let weaponCooldown = 0;
let isReloading = false;
let reloadTimer = 0;
let isZooming = false;
let viewmodels = {};

// Cài đặt
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

// Phát âm thanh tổng hợp theo loại sự kiện (súng khác nhau, trúng đích, nạp đạn, bị thương...)
function playSound(type) {
  const ctx = getAudioCtx();
  const now = ctx.currentTime;

  const tone = (wave, f1, f2, dur, vol) => {
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = wave; osc.frequency.setValueAtTime(f1, now);
    if (f2 != null) osc.frequency.exponentialRampToValueAtTime(Math.max(f2, 1), now + dur);
    gain.gain.setValueAtTime(vol, now); gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(gain); gain.connect(sfxGain); osc.start(now); osc.stop(now + dur);
  };

  if (type === 'pistol') tone('square', 220, 60, 0.12, 0.3);
  else if (type === 'sniper') tone('sawtooth', 900, 40, 0.4, 0.5);
  else if (type === 'empty') tone('square', 150, null, 0.08, 0.15);
  else if (type === 'reload') tone('triangle', 300, 500, 0.3, 0.15);
  else if (type === 'hit') tone('sawtooth', 500, 100, 0.25, 0.3);
  else if (type === 'playerHurt') tone('sawtooth', 140, null, 0.2, 0.3);
  else if (type === 'enemyShoot') tone('square', 180, 90, 0.1, 0.15);
  else if (type === 'shotgun') {
    // Tiếng nổ ồn kiểu "noise burst" cho cảm giác đạn ghém
    const bufferSize = ctx.sampleRate * 0.25;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const noise = ctx.createBufferSource(); noise.buffer = buffer;
    const gain = ctx.createGain(); gain.gain.setValueAtTime(0.5, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 1200;
    noise.connect(filter); filter.connect(gain); gain.connect(sfxGain); noise.start(now);
  }
}

/* ============================================================================
   PHẦN 4: KHỞI TẠO SCENE (map, tường bao, hộp vật cản, ánh sáng, texture)
   ============================================================================ */
function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 25, 100);

  camera = new THREE.PerspectiveCamera(NORMAL_FOV, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, EYE_HEIGHT, 10);

  const canvas = document.getElementById('gameCanvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // --- Ánh sáng ---
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
  dirLight.position.set(30, 50, 20);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  dirLight.shadow.camera.left = -50; dirLight.shadow.camera.right = 50;
  dirLight.shadow.camera.top = 50; dirLight.shadow.camera.bottom = -50;
  dirLight.shadow.camera.far = 150;
  scene.add(dirLight);

  // --- Texture thật (cỏ + gạch) ---
  const texLoader = new THREE.TextureLoader();
  const grassTex = texLoader.load('https://threejs.org/examples/textures/terrain/grasslight-big.jpg');
  grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
  grassTex.repeat.set(16, 16);

  const brickTex = texLoader.load('https://threejs.org/examples/textures/brick_diffuse.jpg');
  brickTex.wrapS = brickTex.wrapT = THREE.RepeatWrapping;

  // --- Mặt đất (80x80, khớp với map) ---
  const groundGeo = new THREE.PlaneGeometry(MAP_HALF * 2, MAP_HALF * 2);
  const groundMat = new THREE.MeshStandardMaterial({ map: grassTex });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // --- Tường bao quanh map (4 bức, cao 6, dày 1, texture gạch) ---
  const wallMat = new THREE.MeshStandardMaterial({ map: brickTex });
  const fullLen = MAP_HALF * 2 + WALL_THICKNESS;
  const wallDefs = [
    { x: 0, z: -MAP_HALF, w: fullLen, d: WALL_THICKNESS },  // tường Bắc
    { x: 0, z: MAP_HALF, w: fullLen, d: WALL_THICKNESS },   // tường Nam
    { x: -MAP_HALF, z: 0, w: WALL_THICKNESS, d: fullLen },  // tường Tây
    { x: MAP_HALF, z: 0, w: WALL_THICKNESS, d: fullLen },   // tường Đông
  ];
  wallDefs.forEach(w => {
    const m = wallMat.clone();
    m.map = brickTex.clone(); m.map.needsUpdate = true;
    m.map.repeat.set(w.w / 4, WALL_HEIGHT / 4);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w.w, WALL_HEIGHT, w.d), m);
    mesh.position.set(w.x, WALL_HEIGHT / 2, w.z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
    addObstacle(mesh);
  });

  // --- Vài khối hộp làm vật cản bên trong (4-6 hộp ngẫu nhiên) ---
  const boxCount = 4 + Math.floor(Math.random() * 3); // 4..6
  const boxMat = new THREE.MeshStandardMaterial({ color: 0xaa7744 });
  let attempts = 0;
  let placed = 0;
  while (placed < boxCount && attempts < 100) {
    attempts++;
    const size = 2 + Math.random() * 2;
    const x = (Math.random() - 0.5) * (MAP_HALF * 2 - 12);
    const z = (Math.random() - 0.5) * (MAP_HALF * 2 - 12);
    if (Math.hypot(x, z - 10) < 6) continue; // tránh spawn quá gần điểm bắt đầu người chơi
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), boxMat.clone());
    mesh.position.set(x, size / 2, z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
    addObstacle(mesh);
    placed++;
  }

  // --- PointerLockControls: camera chính là "object" bị điều khiển ---
  controls = new PointerLockControls(camera, document.body);
  scene.add(controls.getObject());
}

// Thêm vật cản vào mảng obstacles kèm theo Box3 tính sẵn (tường/hộp đứng yên nên chỉ cần tính 1 lần)
function addObstacle(mesh) {
  const box = new THREE.Box3().setFromObject(mesh);
  obstacles.push({ mesh, box });
}

// Kiểm tra một vị trí (x,z) với bán kính "radius" có va chạm vật cản nào không
function collidesWithObstacles(x, z, radius) {
  for (const obs of obstacles) {
    const b = obs.box;
    if (x > b.min.x - radius && x < b.max.x + radius && z > b.min.z - radius && z < b.max.z + radius) {
      return true;
    }
  }
  return false;
}

/* ============================================================================
   PHẦN 5: PLAYER — DI CHUYỂN, NHẢY, VA CHẠM TƯỜNG (PointerLockControls)
   ============================================================================ */
function initPlayerInput() {
  document.addEventListener('keydown', (e) => {
    if (gameState !== 'playing') return;
    switch (e.code) {
      case 'KeyW': moveState.forward = true; break;
      case 'KeyS': moveState.backward = true; break;
      case 'KeyA': moveState.left = true; break;
      case 'KeyD': moveState.right = true; break;
      case 'Space':
        if (player.canJump) { player.velocity.y = 8; player.canJump = false; }
        break;
      case 'KeyR': startReload(); break;
      case 'Digit1': switchWeapon('pistol'); break;
      case 'Digit2': switchWeapon('shotgun'); break;
      case 'Digit3': switchWeapon('sniper'); break;
    }
  });
  document.addEventListener('keyup', (e) => {
    switch (e.code) {
      case 'KeyW': moveState.forward = false; break;
      case 'KeyS': moveState.backward = false; break;
      case 'KeyA': moveState.left = false; break;
      case 'KeyD': moveState.right = false; break;
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (gameState !== 'playing') return;
    if (!controls.isLocked) { controls.lock(); return; }
    if (e.button === 0) attemptShoot();
    else if (e.button === 2) setZoomHeld(true);
  });
  document.addEventListener('mouseup', (e) => { if (e.button === 2) setZoomHeld(false); });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
}

// Cập nhật chuyển động người chơi mỗi frame — theo đúng công thức chuẩn của
// three.js cho PointerLockControls (nhân vận tốc cục bộ rồi gọi moveForward/moveRight)
function updatePlayer(delta) {
  player.velocity.x -= player.velocity.x * 10.0 * delta;
  player.velocity.z -= player.velocity.z * 10.0 * delta;
  player.velocity.y -= 25.0 * delta; // trọng lực

  const dir = new THREE.Vector3(
    Number(moveState.right) - Number(moveState.left),
    0,
    Number(moveState.forward) - Number(moveState.backward)
  );
  if (dir.lengthSq() > 0) dir.normalize();

  const accel = 40.0 * delta;
  if (moveState.forward || moveState.backward) player.velocity.z -= dir.z * accel;
  if (moveState.left || moveState.right) player.velocity.x -= dir.x * accel;

  const obj = controls.getObject();
  const oldX = obj.position.x, oldZ = obj.position.z;

  controls.moveRight(-player.velocity.x * delta);
  controls.moveForward(-player.velocity.z * delta);

  // --- Va chạm với tường/hộp: nếu vị trí mới đâm vào vật cản thì lùi lại trục tương ứng ---
  if (collidesWithObstacles(obj.position.x, oldZ, PLAYER_RADIUS)) obj.position.x = oldX;
  if (collidesWithObstacles(obj.position.x, obj.position.z, PLAYER_RADIUS)) obj.position.z = oldZ;

  // Giới hạn cứng trong biên map (an toàn thêm ngoài tường)
  obj.position.x = Math.max(-INNER_BOUND, Math.min(INNER_BOUND, obj.position.x));
  obj.position.z = Math.max(-INNER_BOUND, Math.min(INNER_BOUND, obj.position.z));

  // --- Trọng lực / nhảy ---
  obj.position.y += player.velocity.y * delta;
  if (obj.position.y < EYE_HEIGHT) {
    player.velocity.y = 0;
    obj.position.y = EYE_HEIGHT;
    player.canJump = true;
  }
}

/* ============================================================================
   PHẦN 6: VŨ KHÍ — 3 LOẠI SÚNG, VIEWMODEL, BẮN, NẠP ĐẠN, ZOOM
   ============================================================================ */
function initWeapons() {
  for (const name in WEAPON_DEFS) ammo[name] = WEAPON_DEFS[name].maxAmmo;

  const configs = {
    pistol: { size: [0.12, 0.12, 0.35], pos: [0.28, -0.28, -0.5] },
    shotgun: { size: [0.14, 0.16, 0.65], pos: [0.3, -0.3, -0.65] },
    sniper: { size: [0.1, 0.1, 0.85], pos: [0.28, -0.25, -0.8] },
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
  // Hiệu ứng viewmodel giật nhẹ rồi trở lại vị trí gốc
  const vm = viewmodels[currentWeaponName];
  const base = vm.userData.basePos;
  vm.position.lerp(new THREE.Vector3(base[0], base[1], base[2]), 10 * delta);
}

function canShoot() {
  return !isReloading && weaponCooldown <= 0 && ammo[currentWeaponName] > 0;
}

// Bắn: dùng Raycaster kiểm tra trúng quái (chặn bởi vật cản nếu vật cản ở gần hơn)
function attemptShoot() {
  if (!canShoot()) {
    if (ammo[currentWeaponName] <= 0) playSound('empty');
    return;
  }
  const def = WEAPON_DEFS[currentWeaponName];
  ammo[currentWeaponName]--;
  weaponCooldown = def.fireRate;
  playSound(def.sound);

  const vm = viewmodels[currentWeaponName];
  vm.position.z += 0.06; // giật súng

  const targets = enemies.filter(e => e.alive).map(e => e.mesh);
  const obstacleMeshes = obstacles.map(o => o.mesh);
  const allObjects = [...targets, ...obstacleMeshes];

  for (let i = 0; i < def.pellets; i++) {
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2(
      (Math.random() - 0.5) * def.spread * 2,
      (Math.random() - 0.5) * def.spread * 2
    );
    raycaster.setFromCamera(ndc, camera);
    const intersects = raycaster.intersectObjects(allObjects, false);

    createTracer(raycaster);

    if (intersects.length > 0 && targets.includes(intersects[0].object)) {
      const hitMesh = intersects[0].object;
      const enemy = enemies.find(e => e.mesh === hitMesh);
      if (enemy) hitEnemy(enemy, intersects[0].point, def.damage);
    }
  }
}

/* ============================================================================
   PHẦN 7: QUÁI — SPAWN, DI CHUYỂN NÉ TƯỜNG, BẮN TRẢ
   ============================================================================ */
function createEnemyEntity(position) {
  const geo = new THREE.BoxGeometry(1.2, 2, 1.2);
  const mat = new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0x330000 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(position);
  mesh.position.y = 1;
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh);

  return {
    mesh, alive: true, health: 1,
    speed: 1 + Math.random() * 1.2,
    moveDir: new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(),
    changeDirTimer: Math.random() * 3,
    shootCooldown: 1 + Math.random() * 2.5, // lệch pha để quái không bắn cùng lúc
    lastMeleeTime: 0,
  };
}

// Tìm vị trí spawn hợp lệ: cách người chơi >= 8 đơn vị, không nằm trong vật cản, trong biên map
function findValidSpawnPosition(playerPos) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const x = (Math.random() - 0.5) * (INNER_BOUND * 2 - 4);
    const z = (Math.random() - 0.5) * (INNER_BOUND * 2 - 4);
    if (Math.hypot(x - playerPos.x, z - playerPos.z) < 8) continue;
    if (collidesWithObstacles(x, z, ENEMY_RADIUS + 0.5)) continue;
    return new THREE.Vector3(x, 1, z);
  }
  // Fallback nếu không tìm được vị trí sau nhiều lần thử (map quá chật)
  return new THREE.Vector3(playerPos.x + 10, 1, playerPos.z + 10);
}

function updateEnemyAI(enemy, delta, playerPos, elapsedTime) {
  if (!enemy.alive) return;

  enemy.changeDirTimer -= delta;
  if (enemy.changeDirTimer <= 0) {
    enemy.moveDir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    enemy.changeDirTimer = 2 + Math.random() * 3;
  }

  const dist = enemy.mesh.position.distanceTo(playerPos);
  if (dist < 15) {
    const toPlayer = new THREE.Vector3().subVectors(playerPos, enemy.mesh.position);
    toPlayer.y = 0; toPlayer.normalize();
    enemy.moveDir.lerp(toPlayer, 0.02);
  }

  // --- Di chuyển có kiểm tra va chạm tường/hộp (bắt buộc né tường) ---
  const step = enemy.moveDir.clone().multiplyScalar(enemy.speed * delta);
  const newX = enemy.mesh.position.x + step.x;
  const newZ = enemy.mesh.position.z + step.z;

  const blockedX = collidesWithObstacles(newX, enemy.mesh.position.z, ENEMY_RADIUS)
    || newX < -INNER_BOUND || newX > INNER_BOUND;
  const blockedZ = collidesWithObstacles(enemy.mesh.position.x, newZ, ENEMY_RADIUS)
    || newZ < -INNER_BOUND || newZ > INNER_BOUND;

  if (!blockedX) enemy.mesh.position.x = newX;
  if (!blockedZ) enemy.mesh.position.z = newZ;
  if (blockedX || blockedZ) {
    // Đâm tường/hộp -> đổi hướng ngẫu nhiên ngay để không bị kẹt tại chỗ
    enemy.moveDir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    enemy.changeDirTimer = 1 + Math.random() * 2;
  }

  enemy.mesh.rotation.y += delta * 0.5;

  // --- Cận chiến: gây 8 dmg/giây khi ở rất gần ---
  if (dist < 2.5) {
    if (elapsedTime - enemy.lastMeleeTime > 1) {
      enemy.lastMeleeTime = elapsedTime;
      damagePlayer(8);
    }
  }

  // --- Bắn trả: trong khoảng cách 5-25, mỗi 2.5s ---
  if (dist >= 5 && dist <= 25) {
    enemy.shootCooldown -= delta;
    if (enemy.shootCooldown <= 0) {
      enemy.shootCooldown = 2.5;
      fireEnemyProjectile(enemy, playerPos);
    }
  }
}

function fireEnemyProjectile(enemy, playerPos) {
  const from = enemy.mesh.position.clone();
  from.y += 0.8;
  const target = playerPos.clone();
  target.y += 1.0;
  const dir = new THREE.Vector3().subVectors(target, from).normalize();

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xff3300 })
  );
  mesh.position.copy(from);
  scene.add(mesh);

  playSound('enemyShoot');
  enemyProjectiles.push({ mesh, velocity: dir.multiplyScalar(7), damage: 6, life: 6 });
}

// Cập nhật đạn của quái: di chuyển, CHẠM TƯỜNG thì biến mất, CHẠM NGƯỜI CHƠI thì trừ máu và biến mất
function updateEnemyProjectiles(delta, playerPos) {
  for (let i = enemyProjectiles.length - 1; i >= 0; i--) {
    const p = enemyProjectiles[i];
    p.mesh.position.addScaledVector(p.velocity, delta);
    p.life -= delta;

    // Chạm tường/hộp -> biến mất
    if (collidesWithObstacles(p.mesh.position.x, p.mesh.position.z, 0.2)) {
      scene.remove(p.mesh);
      enemyProjectiles.splice(i, 1);
      continue;
    }

    // Chạm người chơi -> trừ máu và biến mất
    const dx = p.mesh.position.x - playerPos.x;
    const dz = p.mesh.position.z - playerPos.z;
    if (Math.hypot(dx, dz) < 1.0 && Math.abs(p.mesh.position.y - EYE_HEIGHT) < 1.6) {
      damagePlayer(p.damage);
      scene.remove(p.mesh);
      enemyProjectiles.splice(i, 1);
      continue;
    }

    // Hết vòng đời hoặc bay ra ngoài map -> dọn dẹp
    if (p.life <= 0 || Math.abs(p.mesh.position.x) > MAP_HALF || Math.abs(p.mesh.position.z) > MAP_HALF) {
      scene.remove(p.mesh);
      enemyProjectiles.splice(i, 1);
    }
  }
}

function hitEnemy(enemy, point, damage) {
  enemy.health -= damage;
  if (enemy.health <= 0 && enemy.alive) {
    enemy.alive = false;
    playSound('hit');
    createExplosion(point || enemy.mesh.position);
    if (enemy.mesh.parent) scene.remove(enemy.mesh);
    score += 100;
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
   PHẦN 8: ĐẠN NGƯỜI CHƠI (TRACER) & HIỆU ỨNG NỔ
   ============================================================================ */
function createTracer(raycaster) {
  const origin = raycaster.ray.origin.clone();
  const end = origin.clone().addScaledVector(raycaster.ray.direction, 100);
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

function createExplosion(position) {
  const particles = [];
  const geo = new THREE.SphereGeometry(0.1, 4, 4);
  const mat = new THREE.MeshBasicMaterial({ color: 0xff5500 });
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
    heartsWrap: document.getElementById('heartsWrap'),
    weaponName: document.getElementById('weaponName'),
    ammoCount: document.getElementById('ammoCount'),
    ammoMax: document.getElementById('ammoMax'),
    reloadHint: document.getElementById('reloadHint'),
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
function updateLevelHUD() { hudEl.levelInfo.textContent = `Màn: ${currentLevelIndex + 1}/${LEVELS.length}`; }
function updateEnemyCountHUD() {
  const remaining = enemies.filter(e => e.alive).length;
  hudEl.enemyCount.textContent = `Địch còn lại: ${remaining}`;
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

// Minimap: bán kính 40 đơn vị quanh người chơi, Bắc luôn hướng lên (map không xoay),
// chỉ mũi tên người chơi xoay theo hướng camera đang nhìn.
const MINIMAP_RADIUS = 40;
function drawMinimap(playerPos, yaw) {
  const canvas = hudEl.minimapCanvas;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const cx = w / 2, cy = h / 2;
  const scale = (w / 2) / MINIMAP_RADIUS;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(20,20,20,0.7)';
  ctx.fillRect(0, 0, w, h);

  // Tường & hộp (màu xám)
  ctx.fillStyle = '#999999';
  obstacles.forEach(obs => {
    const b = obs.box;
    const bx = (b.min.x - playerPos.x) * scale + cx;
    const bz = (b.min.z - playerPos.z) * scale + cy;
    const bw = (b.max.x - b.min.x) * scale;
    const bd = (b.max.z - b.min.z) * scale;
    ctx.fillRect(bx, bz, Math.max(bw, 1), Math.max(bd, 1));
  });

  // Quái (chấm đỏ)
  ctx.fillStyle = '#ff3333';
  enemies.forEach(e => {
    if (!e.alive) return;
    const x = cx + (e.mesh.position.x - playerPos.x) * scale;
    const y = cy + (e.mesh.position.z - playerPos.z) * scale;
    if (x < 0 || x > w || y < 0 || y > h) return;
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
  });

  // Người chơi: mũi tên xanh lá, xoay đúng theo hướng camera (yaw)
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
   PHẦN 10: QUẢN LÝ MÀN CHƠI
   ============================================================================ */
function loadLevel(levelIndex) {
  enemies.forEach(e => { if (e.mesh.parent) scene.remove(e.mesh); });
  enemyProjectiles.forEach(p => scene.remove(p.mesh));
  enemies = []; enemyProjectiles = [];

  const cfg = LEVELS[levelIndex];
  const playerPos = controls.getObject().position;

  for (let i = 0; i < cfg.enemyCount; i++) {
    const pos = findValidSpawnPosition(playerPos);
    enemies.push(createEnemyEntity(pos));
  }

  updateLevelHUD();
  updateEnemyCountHUD();
  showLevelBanner(`MÀN ${levelIndex + 1}`);
}

function checkLevelProgress() {
  if (levelTransitioning) return;
  const remaining = enemies.filter(e => e.alive).length;
  updateEnemyCountHUD();
  if (remaining > 0) return;

  levelTransitioning = true;
  if (currentLevelIndex >= LEVELS.length - 1) {
    winGame();
    return;
  }
  showLevelBanner(`HOÀN THÀNH MÀN ${currentLevelIndex + 1}!`);
  saveProgress();
  setTimeout(() => {
    currentLevelIndex++;
    loadLevel(currentLevelIndex);
    saveProgress();
    levelTransitioning = false;
  }, 2000);
}

/* ============================================================================
   PHẦN 11: LƯU / TẢI TIẾN TRÌNH (localStorage)
   ============================================================================ */
function saveProgress() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      level: currentLevelIndex, score, health: player.health, weapon: currentWeaponName, ammo,
    }));
  } catch (e) { /* localStorage có thể bị chặn — bỏ qua an toàn */ }
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
   PHẦN 12: MÁY TRẠNG THÁI GAME (menu / chơi / thua / thắng)
   ============================================================================ */
function showScreen(id) {
  ['menuScreen', 'settingsScreen', 'gameOverScreen', 'winScreen'].forEach(s => {
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

function newGame() {
  clearSave();
  currentLevelIndex = 0;
  score = 0;
  levelTransitioning = false;

  const obj = controls.getObject();
  obj.position.set(0, EYE_HEIGHT, 10);
  obj.rotation.set(0, 0, 0);
  player.velocity.set(0, 0, 0);
  player.health = player.maxHealth;

  for (const name in WEAPON_DEFS) ammo[name] = WEAPON_DEFS[name].maxAmmo;
  Object.keys(viewmodels).forEach(n => viewmodels[n].visible = (n === 'pistol'));
  currentWeaponName = 'pistol';
  isReloading = false; weaponCooldown = 0;
  setZoomHeld(false);

  updateScoreHUD();
  loadLevel(0);
  beginPlaying();
}

function continueGame() {
  const data = loadSaveData();
  if (!data) return;

  currentLevelIndex = Math.min(data.level ?? 0, LEVELS.length - 1);
  score = data.score || 0;
  levelTransitioning = false;

  const obj = controls.getObject();
  obj.position.set(0, EYE_HEIGHT, 10);
  obj.rotation.set(0, 0, 0);
  player.velocity.set(0, 0, 0);
  player.health = data.health ?? player.maxHealth;

  if (data.ammo) ammo = { ...ammo, ...data.ammo };
  const weapon = data.weapon && WEAPON_DEFS[data.weapon] ? data.weapon : 'pistol';
  Object.keys(viewmodels).forEach(n => viewmodels[n].visible = (n === weapon));
  currentWeaponName = weapon;
  isReloading = false; weaponCooldown = 0;
  setZoomHeld(false);

  updateScoreHUD();
  loadLevel(currentLevelIndex);
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
  showScreen('gameOverScreen');
}

function winGame() {
  gameState = 'win';
  controls.unlock();
  clearSave();
  document.getElementById('hud').style.display = 'none';
  document.getElementById('winScore').textContent = `Điểm số của bạn: ${score}`;
  showScreen('winScreen');
}

/* ============================================================================
   PHẦN 13: SỰ KIỆN GIAO DIỆN (menu, cài đặt, resize, lưu trước khi thoát)
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
  document.getElementById('winRestartBtn').addEventListener('click', newGame);
  document.getElementById('winBackToMenuBtn').addEventListener('click', goToMenu);

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
      enemies.forEach(e => updateEnemyAI(e, delta, playerPos, elapsed));
      updateEnemyProjectiles(delta, playerPos);
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
