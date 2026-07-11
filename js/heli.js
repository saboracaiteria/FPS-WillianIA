/* ================================================================
   HELICÓPTERO — voo arcade no topo da TORRE NEXUS
   ================================================================ */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export function createHeli(deps) {
  const { CFG, clamp, damp, _v1, groundAt, SFX, scene, camera, csmMat, Structures, ui, centerMsg, state, keys, mouse, player, chaseCamPos } = deps;
  const group = new THREE.Group();
  const body = csmMat(new THREE.MeshStandardMaterial({ color: 0x2b5e8c, metalness: 0.5, roughness: 0.3 }));
  const dark = csmMat(new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.6 }));
  const glassH = new THREE.MeshStandardMaterial({ color: 0xa8d8f0, metalness: 0.85, roughness: 0.08, transparent: true, opacity: 0.6 });
  function hp(geo, mat, x, y, z, o = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
    m.castShadow = true;
    group.add(m); return m;
  }
  hp(new RoundedBoxGeometry(3.1, 1.5, 1.6, 3, 0.5), body, 0.2, 1.15, 0);                   // fuselagem
  hp(new RoundedBoxGeometry(0.9, 1.1, 1.4, 3, 0.4), glassH, 1.6, 1.2, 0);                  // cabine de vidro
  hp(new THREE.CylinderGeometry(0.16, 0.3, 2.6, 10), body, -2.2, 1.45, 0, { rz: Math.PI / 2 }); // cauda
  hp(new RoundedBoxGeometry(0.5, 0.9, 0.12, 2, 0.05), body, -3.4, 1.8, 0);                 // leme
  const trotor = hp(new RoundedBoxGeometry(0.08, 1.1, 0.1, 1, 0.03), dark, -3.45, 1.8, 0.12);
  hp(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 8), dark, 0.4, 0.18, 0.78, { rz: Math.PI / 2 }); // esquis
  hp(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 8), dark, 0.4, 0.18, -0.78, { rz: Math.PI / 2 });
  for (const sx of [-0.5, 1.1]) for (const sz of [0.7, -0.7])
    hp(new THREE.CylinderGeometry(0.04, 0.04, 0.65, 6), dark, sx, 0.55, sz, { rx: sz > 0 ? 0.4 : -0.4 });
  hp(new THREE.CylinderGeometry(0.09, 0.12, 0.5, 8), dark, 0.2, 2.05, 0);                  // mastro
  const rotor = new THREE.Group();
  rotor.position.set(0.2, 2.3, 0);
  const blade = new RoundedBoxGeometry(5.6, 0.045, 0.32, 1, 0.02);
  const b1 = new THREE.Mesh(blade, dark), b2 = new THREE.Mesh(blade, dark);
  b2.rotation.y = Math.PI / 2;
  rotor.add(b1, b2);
  group.add(rotor);
  const hs = Structures.heliSpot;
  group.position.set(hs.x, hs.y + 0.05, hs.z);
  scene.add(group);

  const vel = new THREE.Vector3();
  let yaw = 0, pitchK = 0, rollK = 0, rotorSpd = 0;

  function tryEnter() {
    if (player.pos.distanceTo(group.position) > 5) return false;
    if (window.__BR_heliTaken) { centerMsg('Helicóptero ocupado!', 1400); return false; }
    state.flying = true;
    ui.speedo.style.display = 'block';
    ui.ammoWrap.style.display = 'none';
    mouse.shooting = false; mouse.aiming = false;
    SFX.carDoor();
    chaseCamPos.copy(camera.position);
    centerMsg('ESPAÇO sobe · CTRL desce · WASD voa', 2600);
    return true;
  }
  function exit() {
    state.flying = false;
    _v1.set(0, 0, -2.6).applyQuaternion(group.quaternion).add(group.position);
    player.pos.set(_v1.x, Math.max(groundAt(_v1.x, _v1.z, group.position.y + 1), group.position.y - 0.6), _v1.z);
    player.vel.set(0, 0, 0);
    ui.speedo.style.display = 'none';
    ui.ammoWrap.style.display = '';
    SFX.carDoor();
  }
  function update(dt, t) {
    const on = state.flying && !state.paused;
    rotorSpd = damp(rotorSpd, on ? 26 : 1.2, 1.6, dt);
    rotor.rotation.y += rotorSpd * dt;
    trotor.rotation.x += rotorSpd * 3 * dt;
    if (on) {
      const fwdIn = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);
      const yawIn = (keys['KeyA'] ? 1 : 0) - (keys['KeyD'] ? 1 : 0);
      yaw += yawIn * 1.4 * dt;
      pitchK = damp(pitchK, fwdIn * 0.2, 4, dt);
      rollK = damp(rollK, -yawIn * 0.13, 4, dt);
      const fx = Math.cos(yaw), fz = -Math.sin(yaw); // nariz = +X girado
      vel.x = damp(vel.x, fx * fwdIn * 27, 1.8, dt);
      vel.z = damp(vel.z, fz * fwdIn * 27, 1.8, dt);
      const vyT = keys['Space'] ? 8 : (keys['ControlLeft'] || keys['ControlRight']) ? -7 : 0;
      vel.y = damp(vel.y, vyT, 3, dt);
      group.position.addScaledVector(vel, dt);
      const lim = CFG.WORLD_SIZE * 0.49;
      group.position.x = clamp(group.position.x, -lim, lim);
      group.position.z = clamp(group.position.z, -lim, lim);
      group.position.y = Math.min(group.position.y, 130);
      const minY = groundAt(group.position.x, group.position.z, group.position.y) + 0.55;
      if (group.position.y < minY) { group.position.y = minY; vel.y = Math.max(0, vel.y); }
      group.rotation.set(rollK, yaw, -pitchK); // banca na curva, inclina o nariz ao acelerar
      // player acompanha (recentra grama/chunks)
      player.pos.set(group.position.x, groundAt(group.position.x, group.position.z, group.position.y), group.position.z);
      player.vel.set(0, 0, 0);
      ui.speedVal.textContent = Math.round(Math.hypot(vel.x, vel.z) * 3.6);
      SFX.heliUpdate(true, keys['Space'] ? 1 : 0.45);
    } else {
      SFX.heliUpdate(false, 0);
    }
  }
  return { group, update, tryEnter, exit, get vel() { return vel; } };
}
