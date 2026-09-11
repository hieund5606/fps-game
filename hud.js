// ============================================================================
// HUD.JS
// Cập nhật giao diện người chơi (điểm, máu dạng trái tim, đạn, tên súng,
// minimap) và toàn bộ hệ thống âm thanh (nhạc nền loop + tiếng súng khác
// nhau cho từng loại + tiếng boss gầm) dùng Web Audio API — không cần file
// mp3 ngoài nên luôn chạy được, không lỗi mạng/CORS.
// ============================================================================

const HEART_TOTAL = 5;      // hiển thị 5 trái tim, mỗi trái tim = 20 HP
const HP_PER_HEART = 20;

// ---------------- CÁC PHẦN TỬ DOM (được cache khi initHUD) ----------------
let el = {};

export function initHUD() {
  el = {
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

  // Dựng sẵn 5 icon trái tim
  el.heartsWrap.innerHTML = '';
  for (let i = 0; i < HEART_TOTAL; i++) {
    const span = document.createElement('span');
    span.className = 'heart';
    span.textContent = '❤';
    el.heartsWrap.appendChild(span);
  }
}

export function updateScoreHUD(score) {
  el.score.textContent = `Điểm: ${score}`;
}

export function updateLevelHUD(level, maxLevel) {
  el.levelInfo.textContent = `Màn: ${level}/${maxLevel}`;
}

export function updateEnemyCountHUD(remaining, bossAlive) {
  el.enemyCount.textContent = bossAlive
    ? `⚠ BOSS đang tấn công!`
    : `Địch còn lại: ${remaining}`;
}

// Vẽ lại 5 trái tim theo % máu hiện có (làm tròn theo từng nửa trái tim đơn giản hóa = tròn theo heart đầy/rỗng)
export function updateHealthHUD(health, maxHealth) {
  const ratio = health / maxHealth;
  const fullHearts = Math.ceil(ratio * HEART_TOTAL);
  const hearts = el.heartsWrap.children;
  for (let i = 0; i < hearts.length; i++) {
    hearts[i].classList.toggle('empty', i >= fullHearts);
  }
  if (health <= 0) el.hitFlash.style.opacity = 0; // tắt flash khi đã chết
}

export function updateAmmoHUD(weaponName, ammo, maxAmmo, isReloading) {
  el.weaponName.textContent = weaponName;
  el.ammoCount.textContent = ammo;
  el.ammoMax.textContent = `/ ${maxAmmo}`;
  el.reloadHint.textContent = isReloading ? 'Đang nạp đạn...' : (ammo === 0 ? 'Hết đạn! Bấm [R]' : '');
}

export function flashHit() {
  el.hitFlash.style.opacity = 1;
  setTimeout(() => { el.hitFlash.style.opacity = 0; }, 150);
}

export function showLevelBanner(text) {
  el.levelBanner.textContent = text;
  el.levelBanner.style.opacity = 1;
  setTimeout(() => { el.levelBanner.style.opacity = 0; }, 2200);
}

// ---------------- MINIMAP (canvas 2D, góc nhìn từ trên xuống, bắc luôn hướng lên) ----------------
const MINIMAP_RANGE = 45; // bán kính thế giới hiển thị trên minimap (đơn vị world)

export function drawMinimap(playerPos, playerYaw, enemies, boss) {
  const canvas = el.minimapCanvas;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const cx = w / 2, cy = h / 2;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,30,0,0.6)';
  ctx.fillRect(0, 0, w, h);

  // Lưới nhẹ cho dễ nhìn
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  for (let i = 0; i <= 4; i++) {
    const x = (w / 4) * i;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    const y = (h / 4) * i;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  const scale = (w / 2) / MINIMAP_RANGE;

  // Vẽ địch (chấm đỏ)
  enemies.forEach(e => {
    if (!e.alive) return;
    const dx = (e.mesh.position.x - playerPos.x) * scale;
    const dz = (e.mesh.position.z - playerPos.z) * scale;
    const x = cx + dx, y = cy + dz;
    if (x < 0 || x > w || y < 0 || y > h) return;
    ctx.fillStyle = '#ff3333';
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
  });

  // Vẽ boss (chấm to màu vàng-đỏ)
  if (boss && boss.alive) {
    const dx = (boss.mesh.position.x - playerPos.x) * scale;
    const dz = (boss.mesh.position.z - playerPos.z) * scale;
    const x = cx + dx, y = cy + dz;
    ctx.fillStyle = '#ff9900';
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
  }

  // Vẽ người chơi (tam giác xanh chỉ theo hướng nhìn) ở chính giữa
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(playerYaw);
  ctx.fillStyle = '#33ccff';
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(5, 6);
  ctx.lineTo(-5, 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ============================================================================
// HỆ THỐNG ÂM THANH (Web Audio API) — tự tổng hợp, không cần file ngoài
// ============================================================================
let audioCtx = null;
let masterGain = null;
let musicGain = null;
let sfxGain = null;
let musicSource = null;

function getCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.6;
    masterGain.connect(audioCtx.destination);

    musicGain = audioCtx.createGain();
    musicGain.gain.value = 0.25;
    musicGain.connect(masterGain);

    sfxGain = audioCtx.createGain();
    sfxGain.gain.value = 1.0;
    sfxGain.connect(masterGain);
  }
  return audioCtx;
}

// Đặt âm lượng tổng (0.0 - 1.0) theo thanh trượt trong Cài đặt
export function setMasterVolume(v) {
  getCtx();
  masterGain.gain.value = v;
}

// --- Nhạc nền: tạo một đoạn "pad" ambient bằng nhiều oscillator hòa âm,
// lặp vô hạn bằng cách giữ oscillator chạy liên tục (không cần buffer/file mp3).
let musicOscillators = [];
export function startBackgroundMusic() {
  const ctx = getCtx();
  if (musicOscillators.length > 0) return; // đã chạy rồi

  const notes = [55, 82.4, 110]; // A1, E2, A2 - hợp âm trầm tạo không khí hồi hộp
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    osc.type = i === 0 ? 'sine' : 'triangle';
    osc.frequency.value = freq;

    const lfo = ctx.createOscillator(); // LFO tạo hiệu ứng rung nhẹ, đỡ nhàm chán khi loop
    lfo.frequency.value = 0.15 + i * 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 3;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    lfo.start();

    const gain = ctx.createGain();
    gain.gain.value = 0.15 / (i + 1);
    osc.connect(gain);
    gain.connect(musicGain);
    osc.start();

    musicOscillators.push(osc, lfo);
  });
}

export function stopBackgroundMusic() {
  musicOscillators.forEach(o => { try { o.stop(); } catch (e) {} });
  musicOscillators = [];
}

// --- Tiếng súng / hiệu ứng, mỗi loại có "màu âm thanh" riêng ---
export function playGunSound(type) {
  const ctx = getCtx();
  const now = ctx.currentTime;

  if (type === 'pistol') {
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = 'square'; osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.1);
    gain.gain.setValueAtTime(0.3, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(gain); gain.connect(sfxGain); osc.start(now); osc.stop(now + 0.12);

  } else if (type === 'shotgun') {
    // Tiếng nổ ồn kiểu "noise burst" cho cảm giác đạn ghém
    const bufferSize = ctx.sampleRate * 0.25;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const noise = ctx.createBufferSource(); noise.buffer = buffer;
    const gain = ctx.createGain(); gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 1200;
    noise.connect(filter); filter.connect(gain); gain.connect(sfxGain); noise.start(now);

  } else if (type === 'sniper') {
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = 'sawtooth'; osc.frequency.setValueAtTime(900, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.35);
    gain.gain.setValueAtTime(0.5, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc.connect(gain); gain.connect(sfxGain); osc.start(now); osc.stop(now + 0.4);

  } else if (type === 'empty') {
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = 'square'; osc.frequency.setValueAtTime(150, now);
    gain.gain.setValueAtTime(0.15, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(gain); gain.connect(sfxGain); osc.start(now); osc.stop(now + 0.08);

  } else if (type === 'reload') {
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = 'triangle'; osc.frequency.setValueAtTime(300, now);
    osc.frequency.linearRampToValueAtTime(500, now + 0.3);
    gain.gain.setValueAtTime(0.15, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.connect(gain); gain.connect(sfxGain); osc.start(now); osc.stop(now + 0.3);

  } else if (type === 'hit') {
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = 'sawtooth'; osc.frequency.setValueAtTime(500, now);
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.2);
    gain.gain.setValueAtTime(0.3, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.connect(gain); gain.connect(sfxGain); osc.start(now); osc.stop(now + 0.25);

  } else if (type === 'playerHurt') {
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = 'sawtooth'; osc.frequency.setValueAtTime(140, now);
    gain.gain.setValueAtTime(0.3, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(gain); gain.connect(sfxGain); osc.start(now); osc.stop(now + 0.2);

  } else if (type === 'enemyShoot') {
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = 'square'; osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.1);
    gain.gain.setValueAtTime(0.15, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(gain); gain.connect(sfxGain); osc.start(now); osc.stop(now + 0.1);

  } else if (type === 'bossShoot') {
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = 'sawtooth'; osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.2);
    gain.gain.setValueAtTime(0.3, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(gain); gain.connect(sfxGain); osc.start(now); osc.stop(now + 0.2);
  }
}

// --- Tiếng boss gầm khi xuất hiện: nhiều oscillator trầm quét tần số + noise ---
export function playBossRoar() {
  const ctx = getCtx();
  const now = ctx.currentTime;

  [60, 80, 45].forEach((freq, i) => {
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.linearRampToValueAtTime(freq * 0.5, now + 1.2);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.35, now + 0.15);
    gain.gain.linearRampToValueAtTime(0.001, now + 1.4);
    osc.connect(gain); gain.connect(sfxGain);
    osc.start(now + i * 0.05); osc.stop(now + 1.5);
  });

  // Lớp noise trầm để tăng độ "gầm"
  const bufferSize = ctx.sampleRate * 1.2;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize) * 0.6;
  const noise = ctx.createBufferSource(); noise.buffer = buffer;
  const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 300;
  const gain = ctx.createGain(); gain.gain.value = 0.5;
  noise.connect(filter); filter.connect(gain); gain.connect(sfxGain); noise.start(now);
}
