// ============================================================================
// WEAPONS.JS
// Định nghĩa các loại súng (súng lục / shotgun / sniper), quản lý đạn,
// bắn (raycast hitscan), viewmodel (mô hình súng gắn theo camera) và zoom.
// ============================================================================

import * as THREE from 'three';
import { playGunSound } from './hud.js';

// ---------------- ĐỊNH NGHĨA CÁC LOẠI SÚNG ----------------
export const WEAPON_DEFS = {
  pistol: {
    key: '1',
    name: 'SÚNG LỤC',
    maxAmmo: 30,
    damage: 1,
    fireRate: 0.18,      // giây giữa 2 phát bắn -> bắn nhanh
    reloadTime: 1.0,
    pellets: 1,           // số tia bắn ra mỗi phát (shotgun sẽ nhiều hơn)
    spread: 0.004,
    zoomFov: null,
    color: 0x333333,
    soundType: 'pistol',
  },
  shotgun: {
    key: '2',
    name: 'SHOTGUN',
    maxAmmo: 8,
    damage: 3,            // sát thương mỗi viên đạn ghém nếu bắn gần
    fireRate: 0.9,        // bắn chậm
    reloadTime: 1.8,
    pellets: 8,            // bắn nhiều viên nhỏ cùng lúc (chùm đạn ghém)
    spread: 0.05,
    zoomFov: null,
    color: 0x5a3d1e,
    soundType: 'shotgun',
  },
  sniper: {
    key: '3',
    name: 'SNIPER',
    maxAmmo: 5,
    damage: 5,
    fireRate: 1.5,         // bắn rất chậm
    reloadTime: 2.2,
    pellets: 1,
    spread: 0.0005,
    zoomFov: 25,            // FOV khi zoom (thu hẹp góc nhìn = phóng to)
    color: 0x223344,
    soundType: 'sniper',
  },
};

const NORMAL_FOV = 75;
const SHOTGUN_MAX_DIST = 15; // trong khoảng này shotgun gây sát thương đầy đủ

export class WeaponSystem {
  constructor(camera, scene) {
    this.camera = camera;
    this.scene = scene;

    this.currentName = 'pistol';
    this.cooldown = 0;
    this.isReloading = false;
    this.reloadTimer = 0;
    this.isZooming = false;

    // Kho đạn hiện có cho từng súng (dùng chung khi đổi súng, lưu riêng từng loại)
    this.ammo = {};
    for (const name in WEAPON_DEFS) this.ammo[name] = WEAPON_DEFS[name].maxAmmo;

    this._buildViewmodels();
  }

  // Tạo mô hình súng đơn giản (khối hộp) cho từng loại, gắn vào camera,
  // ẩn hết trừ súng đang cầm. Đây là "viewmodel" ở góc dưới màn hình.
  _buildViewmodels() {
    this.viewmodels = {};
    const configs = {
      pistol: { size: [0.12, 0.12, 0.35], pos: [0.28, -0.28, -0.5] },
      shotgun: { size: [0.14, 0.16, 0.65], pos: [0.3, -0.3, -0.65] },
      sniper: { size: [0.1, 0.1, 0.85], pos: [0.28, -0.25, -0.8] },
    };
    for (const name in WEAPON_DEFS) {
      const def = WEAPON_DEFS[name];
      const cfg = configs[name];
      const group = new THREE.Group();

      const bodyGeo = new THREE.BoxGeometry(...cfg.size);
      const bodyMat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.5, metalness: 0.4 });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      group.add(body);

      // Nòng súng nhỏ phía trước cho sinh động
      const barrelGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.25, 8);
      const barrelMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.6 });
      const barrel = new THREE.Mesh(barrelGeo, barrelMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.z = -cfg.size[2] / 2 - 0.1;
      group.add(barrel);

      group.position.set(...cfg.pos);
      group.visible = false;
      group.userData.basePos = cfg.pos.slice();

      this.camera.add(group);
      this.viewmodels[name] = group;
    }
    this.viewmodels[this.currentName].visible = true;
  }

  get current() { return WEAPON_DEFS[this.currentName]; }

  switchTo(name) {
    if (!WEAPON_DEFS[name] || name === this.currentName || this.isReloading) return;
    this.viewmodels[this.currentName].visible = false;
    this.currentName = name;
    this.viewmodels[this.currentName].visible = true;
    this.cooldown = 0;
    this._setZoom(false);
  }

  startReload() {
    if (this.isReloading) return;
    if (this.ammo[this.currentName] === this.current.maxAmmo) return;
    this.isReloading = true;
    this.reloadTimer = this.current.reloadTime;
    playGunSound('reload');
  }

  // Bật/tắt zoom (chỉ sniper). Thay đổi FOV camera.
  setZoomHeld(held) {
    if (this.currentName !== 'sniper') return;
    this._setZoom(held);
  }

  _setZoom(on) {
    this.isZooming = on && this.current.zoomFov != null;
    this.camera.fov = this.isZooming ? this.current.zoomFov : NORMAL_FOV;
    this.camera.updateProjectionMatrix();
    document.getElementById('zoomVignette').style.display = this.isZooming ? 'block' : 'none';
  }

  update(delta) {
    if (this.cooldown > 0) this.cooldown -= delta;

    if (this.isReloading) {
      this.reloadTimer -= delta;
      if (this.reloadTimer <= 0) {
        this.isReloading = false;
        this.ammo[this.currentName] = this.current.maxAmmo;
      }
    }

    // Hiệu ứng giật nhẹ viewmodel trở lại vị trí gốc sau khi bắn
    const vm = this.viewmodels[this.currentName];
    const base = vm.userData.basePos;
    vm.position.lerp(new THREE.Vector3(base[0], base[1], base[2]), 10 * delta);
  }

  canShoot() {
    return !this.isReloading && this.cooldown <= 0 && this.ammo[this.currentName] > 0;
  }

  // Thực hiện bắn: trả về mảng các đối tượng bị trúng dạng
  // { object, point, damage } để main.js xử lý sát thương/hiệu ứng.
  // targets: mảng mesh có thể trúng đạn (địch + boss). obstacles: tường/hộp để chặn tia.
  shoot(targets, obstacles) {
    if (!this.canShoot()) {
      if (this.ammo[this.currentName] <= 0) playGunSound('empty');
      return { hits: [], rays: [] };
    }

    this.ammo[this.currentName]--;
    this.cooldown = this.current.fireRate;
    playGunSound(this.current.soundType);

    // Hiệu ứng giật súng
    const vm = this.viewmodels[this.currentName];
    vm.position.z += 0.06;

    const hits = [];
    const rays = [];
    const pelletCount = this.current.pellets;

    for (let i = 0; i < pelletCount; i++) {
      const raycaster = new THREE.Raycaster();
      const ndc = new THREE.Vector2(
        (Math.random() - 0.5) * this.current.spread * 2,
        (Math.random() - 0.5) * this.current.spread * 2
      );
      raycaster.setFromCamera(ndc, this.camera);

      // Kiểm tra va chạm với cả vật cản lẫn địch, lấy điểm gần nhất
      const allObjects = [...targets, ...obstacles];
      const intersects = raycaster.intersectObjects(allObjects, false);
      rays.push(raycaster);

      if (intersects.length > 0) {
        const first = intersects[0];
        if (targets.includes(first.object)) {
          let dmg = this.current.damage;
          if (this.currentName === 'shotgun' && first.distance > SHOTGUN_MAX_DIST) {
            dmg = 1; // giảm sát thương nếu bắn xa
          }
          hits.push({ object: first.object, point: first.point, damage: dmg });
        }
      }
    }

    return { hits, rays };
  }
}
