/* ================================================================
   FOGUETES da bazuca — projétil físico com rastro de fumaça
   ================================================================ */
import * as THREE from 'three';

export function createRockets(deps) {
  const { rand, _v1, _v2, heightAt, FX, scene, Structures, player, Enemies, Grenades, Boss } = deps;
  const pool = [];
  const _prevR = new THREE.Vector3(); // posição anterior do foguete (temp exclusivo)
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a3f3a, roughness: 0.5 });
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.34, 8), bodyMat);
    body.rotation.x = Math.PI / 2; m.add(body);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.13, 8), new THREE.MeshStandardMaterial({ color: 0xc8581e, roughness: 0.4 }));
    tip.rotation.x = -Math.PI / 2; tip.position.z = -0.22; m.add(tip);
    m.visible = false;
    scene.add(m);
    pool.push({ m, vel: new THREE.Vector3(), live: false, smokeAcc: 0 });
  }
  function fire(from, dir) {
    const r = pool.find(p => !p.live);
    if (!r) return;
    r.live = true; r.m.visible = true;
    r.m.position.copy(from);
    r.vel.copy(dir).multiplyScalar(34);
    r.m.lookAt(_v1.copy(from).add(dir));
  }
  function update(dt, t) {
    for (const r of pool) {
      if (!r.live) continue;
      r.vel.y -= 2.5 * dt;
      _prevR.copy(r.m.position); // posição anterior (checa parede no caminho)
      r.m.position.addScaledVector(r.vel, dt);
      r.m.lookAt(_v1.copy(r.m.position).add(r.vel));
      r.smokeAcc += dt;
      if (r.smokeAcc > 0.03) {
        r.smokeAcc = 0;
        FX.spawnParticle(r.m.position, _v2.set(rand(-0.5, 0.5), rand(0.2, 0.8), rand(-0.5, 0.5)), 0x9b958c, 0.16, 0.5, -0.3);
      }
      let boom = r.m.position.y < heightAt(r.m.position.x, r.m.position.z) + 0.2;
      if (!boom && Structures.segBlocked(_prevR, r.m.position)) boom = true; // parede detona (antes atravessava prédio)
      if (!boom) for (const e of Enemies.list) if (e.alive && e.group.position.distanceToSquared(r.m.position) < 2.3) { boom = true; break; }
      if (!boom && Boss.alive && Boss.pos().distanceTo(r.m.position) < 2.6) boom = true;
      // espoleta de proximidade também pros jogadores remotos (BR)
      if (!boom && window.__MP_remotePlayers) for (const rp of window.__MP_remotePlayers)
        if (rp.alive && rp.group.position.distanceToSquared(r.m.position) < 4) { boom = true; break; }
      if (boom || r.m.position.distanceTo(player.pos) > 340) {
        r.live = false; r.m.visible = false;
        Grenades.explode(r.m.position);
      }
    }
  }
  return { fire, update };
}
