// ============================================================================
// MAIN.JS
// File trung tâm: khởi tạo scene Three.js (đất/tường có texture thật, ánh
// sáng), ghép nối Player + WeaponSystem + Enemies + HUD, quản lý máy trạng
// thái game (menu / chơi / thua / thắng), quản lý nhiều màn chơi, lưu/tải
// tiến trình bằng localStorage, và vòng lặp game chính (game loop).
// ============================================================================

import * as THREE from 'three';
import { Player } from './player.js';
import { WeaponSystem, WEAPON_DEFS } from './weapons.js';
import {
  createEnemy, createBoss, updateEnemy, updateProjectiles,
  damageEnemy, removeEnemyMesh,
} from './enemies.js';
import {
  initHUD, updateScoreHUD, updateLevelHUD, updateEnemyCountHUD,
  updateHealthHUD, updateAmmoHUD, drawMinimap, flashHit, showLevelBanner,
  setMasterVolume, startBackgroundMusic, stopBackgroundMusic,
  playGunSound, playBossRoar,
} from './hud.js';

/* ============================================================================
   PHẦN 1: CẤU HÌNH MÀN CHƠI & HẰNG SỐ
   ============================================================================ */
const LEVELS = [
  { enemyCount: 5, bossTier: null },  // Màn 1: 5 địch thường
  { enemyCount: 8, bossTier: 2 },     // Màn 2: 8 địch thường + boss nhỏ
  { enemyCount: 12, bossTier: 3 },    // Màn 3: 12 địch + boss lớn
];
const SAVE_KEY = 'fps3d_save_v1';
const SETTINGS_KEY = 'fps3d_settings_v1';

/* ============================================================================
   PHẦN 2: TRẠNG THÁI GAME TOÀN CỤC
   ============================================================================ */
let scene, camera, renderer;
let player, weaponSystem;
const clock = new THREE.Clock();

let gameState = 'menu'; // 'menu' | 'settings' | 'playing' | 'gameover' | 'win'
let currentLevelIndex = 0;
let score = 0;

let obstacles = [];      // tường / khối hộp để va chạm & chặn tia bắn
let enemies = [];        // địch thường của màn hiện tại
let boss = null;         // boss của màn hiện tại (nếu có), null nếu chưa xuất hiện
let bossSpawned = false; // đã spawn boss của màn này chưa
let projectiles = [];    // đạn của địch/boss đang bay
let bulletTrails = [];   // hiệu ứng tia đạn của người chơi (line tồn tại ngắn)
let levelTransitioning = false;

const settings = { volume: 60, sensitivity: 100 };

/* ============================================================================
   PHẦN 3: KHỞI TẠO SCENE (ánh sáng, đất texture cỏ, tường texture gạch)
   ============================================================================ */
function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 25, 110);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

  const canvas = document.getElementById('gameCanvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // --- Ánh sáng ---
  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(ambient);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
  dirLight.position.set(30, 50, 20);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  dirLight.shadow.camera.left = -60;
  dirLight.shadow.camera.right = 60;
  dirLight.shadow.camera.top = 60;
  dirLight.shadow.camera.bottom = -60;
  dirLight.shadow.camera.far = 160;
  scene.add(dirLight);

  // --- Texture thật tải từ kho ảnh công khai của Three.js ---
  const texLoader = new THREE.TextureLoader();
  texLoader.setCrossOrigin('anonymous');

  const grassTex = texLoader.load('https://threejs.org/examples/textures/terrain/grasslight-big.jpg');
  grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
  grassTex.repeat.set(20, 20);

  const brickTex = texLoader.load('https://threejs.org/examples/textures/brick_diffuse.jpg');
  brickTex.wrapS = brickTex.wrapT = THREE.RepeatWrapping;

  // --- Mặt đất (texture cỏ) ---
  const groundGeo = new THREE.PlaneGeometry(200, 200);
  const groundMat = new THREE.MeshStandardMaterial({ map: grassTex });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // --- Tường & khối hộp (texture gạch) ---
  const wallMat = new THREE.MeshStandardMaterial({ map: brickTex });
  const wallData = [
    { x: 0, z: -25, w: 30, h: 6, d: 1 },
    { x: -20, z: -10, w: 1, h: 6, d: 20 },
    { x: 20, z: -10, w: 1, h: 6, d: 20 },
    { x: -10, z: -15, w: 8, h: 4, d: 1 },
    { x: 10, z: -5, w: 8, h: 4, d: 1 },
  ];
  wallData.forEach(w => {
    const m = wallMat.clone();
    m.map = brickTex.clone();
    m.map.needsUpdate = true;
    m.map.repeat.set(w.w / 4, w.h / 4);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w.w, w.h, w.d), m);
    mesh.position.set(w.x, w.h / 2, w.z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
    obstacles.push(mesh);
  });

  const boxPositions = [[-5, -8], [5, -12], [-12, -20], [12, -18], [0, -18], [-3, 3], [8, 5]];
  boxPositions.forEach(([x, z]) => {
    const size = 2 + Math.random() * 1.5;
    const m = wallMat.clone();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), m);
    mesh.position.set(x, size / 2, z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
    obstacles.push(mesh);
  });

  // --- Player & camera (camera được Player tạo bên trong rig) ---
  player = new Player(camera, renderer.domElement);
  scene.add(player.rig);

  // --- Hệ thống vũ khí (viewmodel gắn theo camera) ---
  weaponSystem = new WeaponSystem(camera, scene);
}

/* ============================================================================
   PHẦN 4: QUẢN LÝ MÀN CHƠI (spawn địch, spawn boss, kiểm tra tiến độ)
   ============================================================================ */
function loadLevel(levelIndex) {
  // Xóa địch & boss & đạn của màn trước
  enemies.forEach(e => removeEnemyMesh(e, scene));
  if (boss) removeEnemyMesh(boss, scene);
  projectiles.forEach(p => scene.remove(p.mesh));
  enemies = []; boss = null; bossSpawned = false; projectiles = [];

  const cfg = LEVELS[levelIndex];
  const playerPos = player.getWorldPosition();

  for (let i = 0; i < cfg.enemyCount; i++) {
    let x, z;
    do {
      x = (Math.random() - 0.5) * 70;
      z = (Math.random() - 0.5) * 70 - 5;
    } while (Math.hypot(x - playerPos.x, z - playerPos.z) < 10);
    enemies.push(createEnemy(scene, new THREE.Vector3(x, 1, z)));
  }

  updateLevelHUD(levelIndex + 1, LEVELS.length);
  updateEnemyCountHUD(enemies.length, false);
  showLevelBanner(`MÀN ${levelIndex + 1}`);
}

// Kiểm tra xem đã dọn sạch địch thường / boss chưa để tiến sang bước tiếp theo
function checkLevelProgress() {
  if (levelTransitioning) return;
  const cfg = LEVELS[currentLevelIndex];
  const remaining = enemies.filter(e => e.alive).length;
  updateEnemyCountHUD(remaining, boss !== null && boss.alive);

  if (remaining > 0) return; // còn địch thường thì chưa làm gì thêm

  // Đã hết địch thường của màn này
  if (cfg.bossTier != null && !bossSpawned) {
    spawnBoss(cfg.bossTier);
    return;
  }

  // Không có boss, hoặc boss đã chết -> hoàn thành màn
  if (cfg.bossTier == null || (boss && !boss.alive)) {
    completeLevel();
  }
}

function spawnBoss(tier) {
  bossSpawned = true;
  const playerPos = player.getWorldPosition();
  const pos = new THREE.Vector3(playerPos.x + 15, 0, playerPos.z - 15);
  boss = createBoss(scene, pos, tier);
  playBossRoar();
  showLevelBanner(tier === 3 ? '⚠ BOSS LỚN XUẤT HIỆN!' : '⚠ BOSS NHỎ XUẤT HIỆN!');
}

function completeLevel() {
  levelTransitioning = true;
  const isLast = currentLevelIndex >= LEVELS.length - 1;

  if (isLast) {
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
   PHẦN 5: BẮN SÚNG & HIỆU ỨNG ĐẠN CỦA NGƯỜI CHƠI
   ============================================================================ */
function attemptShoot() {
  const targets = enemies.filter(e => e.alive).map(e => e.mesh);
  if (boss && boss.alive) targets.push(boss.mesh);

  const { hits } = weaponSystem.shoot(targets, obstacles);

  // Tạo hiệu ứng tia đạn (tracer) đơn giản từ giữa màn hình ra xa
  createTracerEffect();

  hits.forEach(hit => {
    let entity = enemies.find(e => e.mesh === hit.object);
    if (!entity && boss && boss.mesh === hit.object) entity = boss;
    if (!entity) return;

    const died = damageEnemy(entity, hit.damage);
    if (died) {
      playGunSound('hit');
      createExplosionEffect(hit.point);
      removeEnemyMesh(entity, scene);
      score += entity.isBoss ? 1000 : 100;
      updateScoreHUD(score);
    }
  });
}

function createTracerEffect() {
  const origin = camera.getWorldPosition(new THREE.Vector3());
  const dir = camera.getWorldDirection(new THREE.Vector3());
  const end = origin.clone().addScaledVector(dir, 100);
  const geo = new THREE.BufferGeometry().setFromPoints([origin, end]);
  const mat = new THREE.LineBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.85 });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  bulletTrails.push({ mesh: line, life: 0.06 });
}

function updateBulletTrails(delta) {
  for (let i = bulletTrails.length - 1; i >= 0; i--) {
    bulletTrails[i].life -= delta;
    if (bulletTrails[i].life <= 0) {
      scene.remove(bulletTrails[i].mesh);
      bulletTrails.splice(i, 1);
    }
  }
}

// Hiệu ứng nổ nhỏ (mảnh vỡ) khi tiêu diệt kẻ địch/boss
function createExplosionEffect(position) {
  const particles = [];
  const geo = new THREE.SphereGeometry(0.1, 4, 4);
  const mat = new THREE.MeshBasicMaterial({ color: 0xff5500 });
  for (let i = 0; i < 14; i++) {
    const p = new THREE.Mesh(geo, mat);
    p.position.copy(position);
    scene.add(p);
    const dir = new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2);
    particles.push({ mesh: p, dir, life: 0.6 });
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
   PHẦN 6: LƯU / TẢI TIẾN TRÌNH (localStorage)
   ============================================================================ */
function saveProgress() {
  const data = {
    level: currentLevelIndex,
    score,
    health: player.health,
    weapon: weaponSystem.currentName,
    ammo: weaponSystem.ammo,
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) {}
}

function loadSaveData() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) Object.assign(settings, JSON.parse(raw));
  } catch (e) {}
}

/* ============================================================================
   PHẦN 7: MÁY TRẠNG THÁI GAME (menu / chơi / thua / thắng)
   ============================================================================ */
function showScreen(id) {
  ['menuScreen', 'settingsScreen', 'gameOverScreen', 'winScreen'].forEach(s => {
    document.getElementById(s).classList.toggle('hidden', s !== id);
  });
}

function goToMenu() {
  gameState = 'menu';
  player.unlock();
  document.getElementById('hud').style.display = 'none';
  document.getElementById('menuScreen').classList.remove('hidden');
  document.getElementById('settingsScreen').classList.add('hidden');
  document.getElementById('gameOverScreen').classList.add('hidden');
  document.getElementById('winScreen').classList.add('hidden');
  document.getElementById('continueBtn').disabled = !loadSaveData();
  stopBackgroundMusic();
}

function newGame() {
  clearSave();
  currentLevelIndex = 0;
  score = 0;
  player.reset(new THREE.Vector3(0, 0, 10));

  // Đặt lại toàn bộ đạn về mặc định và luôn bắt đầu bằng súng lục
  for (const name in WEAPON_DEFS) weaponSystem.ammo[name] = WEAPON_DEFS[name].maxAmmo;
  Object.keys(weaponSystem.viewmodels).forEach(n => weaponSystem.viewmodels[n].visible = (n === 'pistol'));
  weaponSystem.currentName = 'pistol';
  weaponSystem.isReloading = false;
  weaponSystem.cooldown = 0;

  loadLevel(0);
  updateScoreHUD(score);
  beginPlaying();
}

function continueGame() {
  const data = loadSaveData();
  if (!data) return;
  currentLevelIndex = Math.min(data.level, LEVELS.length - 1);
  score = data.score || 0;

  loadLevel(currentLevelIndex);

  player.health = data.health ?? player.maxHealth;
  if (data.ammo) weaponSystem.ammo = data.ammo;
  weaponSystem.switchTo(data.weapon || 'pistol');
  // switchTo bỏ qua nếu trùng tên hiện tại, nên đảm bảo hiển thị đúng viewmodel
  Object.keys(weaponSystem.viewmodels).forEach(n => weaponSystem.viewmodels[n].visible = (n === (data.weapon || 'pistol')));
  weaponSystem.currentName = data.weapon || 'pistol';

  updateScoreHUD(score);
  beginPlaying();
}

function beginPlaying() {
  showScreen(null);
  document.getElementById('hud').style.display = 'block';
  gameState = 'playing';
  player.lock();
  startBackgroundMusic();
  updateHealthHUD(player.health, player.maxHealth);
  updateAmmoHUD(weaponSystem.current.name, weaponSystem.ammo[weaponSystem.currentName], weaponSystem.current.maxAmmo, false);
}

function gameOver() {
  gameState = 'gameover';
  player.unlock();
  stopBackgroundMusic();
  clearSave();
  document.getElementById('hud').style.display = 'none';
  document.getElementById('finalScore').textContent = `Điểm số của bạn: ${score}`;
  showScreen('gameOverScreen');
}

function winGame() {
  gameState = 'win';
  player.unlock();
  stopBackgroundMusic();
  clearSave();
  document.getElementById('hud').style.display = 'none';
  document.getElementById('winScore').textContent = `Điểm số của bạn: ${score}`;
  showScreen('winScreen');
}

/* ============================================================================
   PHẦN 8: SỰ KIỆN GIAO DIỆN (menu, cài đặt, bàn phím, chuột)
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

  document.getElementById('restartBtn').addEventListener('click', () => { newGame(); });
  document.getElementById('backToMenuBtn').addEventListener('click', goToMenu);
  document.getElementById('winRestartBtn').addEventListener('click', () => { newGame(); });
  document.getElementById('winBackToMenuBtn').addEventListener('click', goToMenu);

  // --- Cài đặt: âm lượng & độ nhạy chuột ---
  const volumeSlider = document.getElementById('volumeSlider');
  const sensSlider = document.getElementById('sensSlider');
  volumeSlider.value = settings.volume;
  sensSlider.value = settings.sensitivity;
  document.getElementById('volumeVal').textContent = `${settings.volume}%`;
  document.getElementById('sensVal').textContent = `${(settings.sensitivity / 100).toFixed(1)}x`;
  setMasterVolume(settings.volume / 100);

  volumeSlider.addEventListener('input', () => {
    settings.volume = Number(volumeSlider.value);
    document.getElementById('volumeVal').textContent = `${settings.volume}%`;
    setMasterVolume(settings.volume / 100);
    saveSettings();
  });
  sensSlider.addEventListener('input', () => {
    settings.sensitivity = Number(sensSlider.value);
    document.getElementById('sensVal').textContent = `${(settings.sensitivity / 100).toFixed(1)}x`;
    player.sensitivity = settings.sensitivity / 100;
    saveSettings();
  });

  // --- Bàn phím: đổi súng (1/2/3) và nạp đạn (R) ---
  window.addEventListener('keydown', (e) => {
    if (gameState !== 'playing') return;
    if (e.code === 'Digit1') weaponSystem.switchTo('pistol');
    else if (e.code === 'Digit2') weaponSystem.switchTo('shotgun');
    else if (e.code === 'Digit3') weaponSystem.switchTo('sniper');
    else if (e.code === 'KeyR') weaponSystem.startReload();
  });

  // --- Chuột: click trái để bắn, giữ chuột phải để zoom (sniper) ---
  window.addEventListener('mousedown', (e) => {
    if (gameState !== 'playing') return;
    if (!player.isLocked) { player.lock(); return; }
    if (e.button === 0) attemptShoot();
    else if (e.button === 2) weaponSystem.setZoomHeld(true);
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 2) weaponSystem.setZoomHeld(false);
  });
  window.addEventListener('contextmenu', (e) => e.preventDefault());

  // Responsive
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Lưu tiến trình trước khi đóng tab
  window.addEventListener('beforeunload', () => {
    if (gameState === 'playing') saveProgress();
  });
}

/* ============================================================================
   PHẦN 9: GAME LOOP
   ============================================================================ */
function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.1);

  if (gameState === 'playing') {
    if (player.isLocked && !levelTransitioning) {
      player.update(delta, obstacles);
      weaponSystem.update(delta);

      const playerPos = player.getWorldPosition();
      enemies.forEach(e => updateEnemy(e, delta, playerPos, scene, projectiles));
      if (boss && boss.alive) updateEnemy(boss, delta, playerPos, scene, projectiles);

      const dmg = updateProjectiles(projectiles, delta, playerPos, scene);
      if (dmg > 0) {
        const died = player.takeDamage(dmg);
        flashHit();
        playGunSound('playerHurt');
        if (died) gameOver();
      }

      updateBulletTrails(delta);
      checkLevelProgress();
    }

    // Cập nhật HUD mỗi frame (nhẹ, không tốn kém)
    updateHealthHUD(player.health, player.maxHealth);
    updateAmmoHUD(weaponSystem.current.name, weaponSystem.ammo[weaponSystem.currentName], weaponSystem.current.maxAmmo, weaponSystem.isReloading);
    drawMinimap(player.getWorldPosition(), player.rig.rotation.y, enemies, boss);
  }

  renderer.render(scene, camera);
}

/* ============================================================================
   KHỞI ĐỘNG ỨNG DỤNG
   ============================================================================ */
function init() {
  loadSettings();
  initHUD();
  initScene();
  player.sensitivity = settings.sensitivity / 100;
  initUIEvents();
  goToMenu(); // hiển thị menu chính, kiểm tra xem có save không để bật nút "Tiếp tục"
  animate();
}

init();
