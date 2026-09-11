// ============================================================================
// PLAYER.JS
// Quản lý người chơi: camera góc nhìn thứ nhất, di chuyển WASD, nhảy,
// điều khiển chuột tự viết (không dùng addon PointerLockControls) để có thể
// tùy chỉnh độ nhạy chuột theo Cài đặt, máu và va chạm với vật cản.
// ============================================================================

import * as THREE from 'three';

export class Player {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;

    // "Rig" là khối cha chứa camera, dùng để xoay ngang (yaw) và di chuyển
    // vị trí. Camera con chỉ xoay dọc (pitch). Đây là cách chuẩn để làm
    // camera FPS bằng Three.js thuần, không cần addon.
    this.rig = new THREE.Object3D();
    this.rig.position.set(0, 0, 10);
    this.eyeHeight = 1.7;
    this.camera.position.set(0, this.eyeHeight, 0);
    this.rig.add(this.camera);

    // Thông số chuyển động
    this.velocity = new THREE.Vector3();
    this.moveSpeed = 8;
    this.jumpSpeed = 8;
    this.gravity = 20;
    this.canJump = true;
    this.height = this.eyeHeight;

    // Máu
    this.maxHealth = 100;
    this.health = this.maxHealth;

    // Độ nhạy chuột (được Cài đặt cập nhật), đơn vị nhân thêm vào hệ số gốc
    this.sensitivity = 1.0;
    this._baseLookFactor = 0.0022;

    // Trạng thái phím
    this.keys = { forward: false, backward: false, left: false, right: false };

    // Pitch giới hạn để không lật ngược đầu
    this.pitchLimit = Math.PI / 2 - 0.05;

    this.isLocked = false;

    this._initKeyboard();
    this._initMouseLook();
  }

  // ---------------- BÀN PHÍM ----------------
  _initKeyboard() {
    window.addEventListener('keydown', (e) => {
      switch (e.code) {
        case 'KeyW': this.keys.forward = true; break;
        case 'KeyS': this.keys.backward = true; break;
        case 'KeyA': this.keys.left = true; break;
        case 'KeyD': this.keys.right = true; break;
        case 'Space':
          if (this.canJump) { this.velocity.y = this.jumpSpeed; this.canJump = false; }
          break;
      }
    });
    window.addEventListener('keyup', (e) => {
      switch (e.code) {
        case 'KeyW': this.keys.forward = false; break;
        case 'KeyS': this.keys.backward = false; break;
        case 'KeyA': this.keys.left = false; break;
        case 'KeyD': this.keys.right = false; break;
      }
    });
  }

  // ---------------- CHUỘT / POINTER LOCK ----------------
  _initMouseLook() {
    document.addEventListener('pointerlockchange', () => {
      this.isLocked = (document.pointerLockElement === this.domElement);
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.isLocked) return;
      const factor = this._baseLookFactor * this.sensitivity;
      // Xoay ngang toàn bộ rig (yaw)
      this.rig.rotation.y -= e.movementX * factor;
      // Xoay dọc chỉ camera (pitch), giới hạn để tránh lật đầu
      this.camera.rotation.x -= e.movementY * factor;
      this.camera.rotation.x = Math.max(-this.pitchLimit, Math.min(this.pitchLimit, this.camera.rotation.x));
    });
  }

  lock() { this.domElement.requestPointerLock(); }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  // ---------------- CẬP NHẬT MỖI FRAME ----------------
  update(delta, obstacles) {
    // Ma sát để dừng mượt
    this.velocity.x -= this.velocity.x * 10 * delta;
    this.velocity.z -= this.velocity.z * 10 * delta;
    this.velocity.y -= this.gravity * delta;

    // Input cục bộ: velocity.z dương = tiến tới, velocity.x dương = sang phải
    // (quy ước riêng, độc lập hướng camera; sẽ quy chiếu sang thế giới bên dưới)
    const inputForward = Number(this.keys.forward) - Number(this.keys.backward); // +1 tiến
    const inputRight = Number(this.keys.right) - Number(this.keys.left);         // +1 phải

    const accel = this.moveSpeed * 10 * delta;
    this.velocity.z += inputForward * accel;
    this.velocity.x += inputRight * accel;

    // Quy chiếu vận tốc cục bộ sang không gian thế giới theo yaw của rig.
    // forward = hướng camera đang nhìn (local -Z xoay theo yaw); right = local +X xoay theo yaw.
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.rig.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.rig.quaternion);
    const moveVec = new THREE.Vector3();
    moveVec.addScaledVector(forward, this.velocity.z * delta);
    moveVec.addScaledVector(right, this.velocity.x * delta);

    const oldPos = this.rig.position.clone();
    this.rig.position.add(moveVec);

    // Trọng lực / nhảy
    this.rig.position.y += this.velocity.y * delta;
    if (this.rig.position.y <= 0) {
      this.velocity.y = 0;
      this.rig.position.y = 0;
      this.canJump = true;
    }

    // Va chạm đơn giản với vật cản (AABB mở rộng theo bán kính người chơi)
    const radius = 0.5;
    for (const obs of obstacles) {
      const box = new THREE.Box3().setFromObject(obs);
      box.expandByScalar(radius);
      const p = this.rig.position;
      if (p.x > box.min.x && p.x < box.max.x && p.z > box.min.z && p.z < box.max.z) {
        this.rig.position.x = oldPos.x;
        this.rig.position.z = oldPos.z;
      }
    }

    // Giới hạn trong biên bản đồ
    this.rig.position.x = Math.max(-95, Math.min(95, this.rig.position.x));
    this.rig.position.z = Math.max(-95, Math.min(95, this.rig.position.z));
  }

  // Vị trí thế giới của "mắt" người chơi (dùng cho tính khoảng cách, AI địch...)
  getWorldPosition() {
    return this.rig.position;
  }

  takeDamage(amount) {
    this.health = Math.max(0, this.health - amount);
    return this.health <= 0;
  }

  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  reset(position = new THREE.Vector3(0, 0, 10)) {
    this.rig.position.copy(position);
    this.rig.rotation.set(0, 0, 0);
    this.camera.rotation.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.health = this.maxHealth;
  }
}
