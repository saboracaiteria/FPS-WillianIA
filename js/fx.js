/* ================================================================
   EFEITOS — object pooling: nada é criado/destruído durante o loop
   ================================================================ */
import * as THREE from 'three';

export function createFX(deps) {
  const { rand, _v1, scene, camera } = deps;
  /* ---- tracers (hitscan visual) ---- */
  const TRACER_N = 24;
  const tracerGeo = new THREE.BoxGeometry(0.025, 0.025, 1);
  const tracers = [];
  for (let i = 0; i < TRACER_N; i++) {
    const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({
      color: 0xffe9a8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    m.visible = false; m.frustumCulled = false;
    scene.add(m);
    tracers.push({ mesh: m, life: 0, max: 0.07 });
  }
  let tracerIdx = 0;
  function spawnTracer(from, to, color = 0xffe9a8) {
    const t = tracers[tracerIdx]; tracerIdx = (tracerIdx + 1) % TRACER_N;
    const len = from.distanceTo(to);
    t.mesh.position.lerpVectors(from, to, 0.5);
    t.mesh.lookAt(to);
    t.mesh.scale.set(1, 1, Math.max(0.1, len));
    t.mesh.material.color.setHex(color);
    t.mesh.material.opacity = 0.9;
    t.mesh.visible = true;
    t.life = t.max;
  }

  /* ---- partículas (faísca de impacto, poeira, sangue estilizado) ---- */
  const PART_N = 64;
  const partGeo = new THREE.CircleGeometry(0.55, 8); // octógono ~redondo, barato
  const parts = [];
  for (let i = 0; i < PART_N; i++) {
    const m = new THREE.Mesh(partGeo, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
    }));
    m.visible = false; m.frustumCulled = false;
    scene.add(m);
    parts.push({ mesh: m, vel: new THREE.Vector3(), life: 0, max: 1, size: 1, grav: 9 });
  }
  let partIdx = 0;
  function spawnParticle(pos, vel, color, size, life, grav = 9, additive = false) {
    const p = parts[partIdx]; partIdx = (partIdx + 1) % PART_N;
    p.mesh.position.copy(pos);
    p.vel.copy(vel);
    p.mesh.material.color.setHex(color);
    p.mesh.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    p.mesh.material.opacity = 1;
    p.mesh.visible = true;
    p.size = size; p.life = life; p.max = life; p.grav = grav;
  }
  function burst(pos, normal, kind) {
    // kind: 'dirt' | 'spark' | 'blood'
    const n = kind === 'blood' ? 7 : 6;
    for (let i = 0; i < n; i++) {
      _v1.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(1.2, 4.2));
      _v1.addScaledVector(normal, rand(2, 4.5));
      if (kind === 'dirt')  spawnParticle(pos, _v1, i % 2 ? 0x8a6f48 : 0x6f8a48, rand(0.05, 0.13), rand(0.3, 0.6), 14);
      if (kind === 'spark') spawnParticle(pos, _v1, i % 2 ? 0xffd27a : 0xfff6d8, rand(0.03, 0.07), rand(0.15, 0.3), 7, true);
      if (kind === 'blood') spawnParticle(pos, _v1, i % 2 ? 0xc8332a : 0x8f1f18, rand(0.06, 0.15), rand(0.35, 0.7), 13);
    }
  }

  function update(dt) {
    for (const t of tracers) {
      if (!t.mesh.visible) continue;
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life / t.max) * 0.9;
      if (t.life <= 0) t.mesh.visible = false;
    }
    for (const p of parts) {
      if (!p.mesh.visible) continue;
      p.life -= dt;
      if (p.life <= 0) { p.mesh.visible = false; continue; }
      p.vel.y -= p.grav * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      const k = p.life / p.max;
      p.mesh.material.opacity = Math.min(1, k * 2);
      p.mesh.scale.setScalar(p.size * (0.6 + 0.4 * k));
      p.mesh.quaternion.copy(camera.quaternion); // billboard
    }
  }
  return { spawnTracer, spawnParticle, burst, update };
}
