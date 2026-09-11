// ============================================================================
// ENEMIES.JS
// Định nghĩa kẻ địch thường và boss: di chuyển ngẫu nhiên/đuổi theo người chơi,
// bắn đạn đỏ trả người chơi, và quản lý các viên đạn của địch (di chuyển,
// va chạm với người chơi).
// ============================================================================

import * as THREE from 'three';
import { playGunSound } from './hud.js';

// Bộ đếm id đơn giản để phân biệt các thực thể
let idCounter = 0;

// ---------------- TẠO KẺ ĐỊCH THƯỜNG ----------------
export function createEnemy(scene, position) {
  const geo = new THREE.BoxGeometry(1.2, 2, 1.2);
  const mat = new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0x330000 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(position);
  mesh.position.y = 1;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  return {
    id: idCounter++,
    mesh,
    isBoss: false,
    alive: true,
    health: 1,
    maxHealth: 1,
    speed: 1 + Math.random() * 1.2,
    moveDir: new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(),
    changeDirTimer: Math.random() * 3,
    shootCooldown: 2 + Math.random() * 2,
    shootRange: 20,
    projectileDamage: 5,
    projectileSpeed: 6,
  };
}

// ---------------- TẠO BOSS ----------------
// tier: 2 = boss nhỏ (màn 2), 3 = boss lớn (màn 3)
export function createBoss(scene, position, tier = 3) {
  const scale = tier === 3 ? 3 : 2;
  const health = tier === 3 ? 20 : 10;

  const geo = new THREE.BoxGeometry(1.2 * scale, 2 * scale, 1.2 * scale);
  const mat = new THREE.MeshStandardMaterial({ color: 0x990000, emissive: 0x550000, roughness: 0.4 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(position);
  mesh.position.y = (2 * scale) / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  // Thêm "mắt" phát sáng cho boss để nhìn hung dữ hơn
  const eyeGeo = new THREE.SphereGeometry(0.15 * scale, 8, 8);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-0.3 * scale, 0.5 * scale, 0.6 * scale);
  eyeR.position.set(0.3 * scale, 0.5 * scale, 0.6 * scale);
  mesh.add(eyeL, eyeR);

  return {
    id: idCounter++,
    mesh,
    isBoss: true,
    tier,
    alive: true,
    health,
    maxHealth: health,
    speed: 3.5,
    moveDir: new THREE.Vector3(1, 0, 0),
    changeDirTimer: 0,
    shootCooldown: 2,
    shootRange: 30,
    projectileDamage: 10,
    projectileSpeed: 8,
    scale,
  };
}

// ---------------- CẬP NHẬT MỘT KẺ ĐỊCH (DI CHUYỂN + BẮN) ----------------
// projectiles: mảng chứa đạn của địch (được main.js quản lý & render)
export function updateEnemy(enemy, delta, playerPos, scene, projectiles, elapsedTime) {
  if (!enemy.alive) return;

  // --- Di chuyển ---
  enemy.changeDirTimer -= delta;
  if (enemy.changeDirTimer <= 0) {
    enemy.moveDir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    enemy.changeDirTimer = 2 + Math.random() * 3;
  }

  const distToPlayer = enemy.mesh.position.distanceTo(playerPos);
  const chaseRange = enemy.isBoss ? 40 : 15;
  if (distToPlayer < chaseRange) {
    const toPlayer = new THREE.Vector3().subVectors(playerPos, enemy.mesh.position);
    toPlayer.y = 0;
    toPlayer.normalize();
    enemy.moveDir.lerp(toPlayer, enemy.isBoss ? 0.05 : 0.02);
  }

  const move = enemy.moveDir.clone().multiplyScalar(enemy.speed * delta);
  enemy.mesh.position.add(move);
  enemy.mesh.position.y = enemy.isBoss ? (2 * enemy.scale) / 2 : 1;
  enemy.mesh.position.x = Math.max(-95, Math.min(95, enemy.mesh.position.x));
  enemy.mesh.position.z = Math.max(-95, Math.min(95, enemy.mesh.position.z));
  enemy.mesh.rotation.y += delta * 0.5;

  // --- Bắn trả người chơi khi trong tầm ---
  if (distToPlayer < enemy.shootRange) {
    enemy.shootCooldown -= delta;
    if (enemy.shootCooldown <= 0) {
      enemy.shootCooldown = enemy.isBoss ? 1.8 : (2.5 + Math.random() * 1.5);
      fireEnemyProjectile(enemy, playerPos, scene, projectiles);
    }
  }
}

// Địch bắn 1 (hoặc nhiều nếu là boss) viên đạn đỏ về hướng người chơi
function fireEnemyProjectile(enemy, playerPos, scene, projectiles) {
  const from = enemy.mesh.position.clone();
  from.y += enemy.isBoss ? 0.8 * enemy.scale : 0.8;

  const target = playerPos.clone();
  target.y += 1.5; // nhắm khoảng chiều cao mắt người chơi

  const numShots = enemy.isBoss ? 3 : 1;
  playGunSound(enemy.isBoss ? 'bossShoot' : 'enemyShoot');

  for (let i = 0; i < numShots; i++) {
    const dir = new THREE.Vector3().subVectors(target, from).normalize();

    // Nếu boss bắn 3 viên, tạo góc lệch (spread) cho 2 viên bên cạnh
    if (numShots > 1) {
      const angleOffset = (i - 1) * 0.15; // -0.15, 0, +0.15 rad
      const axis = new THREE.Vector3(0, 1, 0);
      dir.applyAxisAngle(axis, angleOffset);
    }

    const geo = new THREE.SphereGeometry(0.18, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff3300 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(from);
    scene.add(mesh);

    projectiles.push({
      mesh,
      velocity: dir.multiplyScalar(enemy.projectileSpeed),
      damage: enemy.projectileDamage,
      life: 6, // tự hủy sau 6 giây nếu không trúng gì
    });
  }
}

// ---------------- CẬP NHẬT ĐẠN CỦA ĐỊCH MỖI FRAME ----------------
// Trả về tổng sát thương gây ra cho người chơi trong frame này.
export function updateProjectiles(projectiles, delta, playerPos, scene) {
  let damageToPlayer = 0;
  const hitRadius = 1.0;

  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.mesh.position.addScaledVector(p.velocity, delta);
    p.life -= delta;

    const distFull = p.mesh.position.distanceTo(new THREE.Vector3(playerPos.x, p.mesh.position.y, playerPos.z));

    if (distFull < hitRadius) {
      damageToPlayer += p.damage;
      scene.remove(p.mesh);
      projectiles.splice(i, 1);
      continue;
    }

    if (p.life <= 0) {
      scene.remove(p.mesh);
      projectiles.splice(i, 1);
    }
  }

  return damageToPlayer;
}

// Xử lý khi kẻ địch/boss bị bắn trúng (damage đến từ weapons.js)
// Trả về true nếu kẻ địch vừa chết ở lần trúng đạn này.
export function damageEnemy(enemy, damage) {
  if (!enemy.alive) return false;
  enemy.health -= damage;
  if (enemy.health <= 0) {
    enemy.alive = false;
    return true;
  }
  return false;
}

export function removeEnemyMesh(enemy, scene) {
  if (enemy.mesh.parent) scene.remove(enemy.mesh);
}
