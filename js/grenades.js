/* ================================================================
   GRANADAS — arco físico, quique no terreno, explosão em área
   ================================================================ */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export function createGrenades(deps) {
  const { clamp, rand, _v1, heightAt, terrainNormal, SFX, FX, scene, camera, updateInvHUD, state, player, playerDamage, addTrauma, recoil, inventory, Car, Enemies, Bosses, extraTargets } = deps;
  const N = 6;
  const pool = [];
  const gMat = new THREE.MeshStandardMaterial({ color: 0x2c3328, roughness: 0.5, metalness: 0.3 });
  for (let i = 0; i < N; i++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.095, 10, 8), gMat);
    body.scale.y = 1.2;
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.018, 6, 14),
      new THREE.MeshStandardMaterial({ color: 0x200800, emissive: 0xff8a2e, emissiveIntensity: 2, roughness: 0.4 }));
    band.rotation.x = Math.PI / 2; band.position.y = 0.04;
    const pin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.03), gMat);
    pin.position.y = 0.12;
    g.add(body, band, pin);
    g.visible = false;
    scene.add(g);
    pool.push({ g, band, vel: new THREE.Vector3(), fuse: 0, live: false, spin: rand(2, 5) });
  }
  const boomLight = new THREE.PointLight(0xffa050, 0, 26, 2);
  scene.add(boomLight);
  let boomT = 0;

  function throwNade(t) {
    if (inventory.nades <= 0 || state.driving || player.dead || state.paused) return;
    const n = pool.find(p => !p.live);
    if (!n) return;
    inventory.nades--;
    updateInvHUD();
    SFX.throwNade();
    recoil.kickRot += 0.12; // a arma acompanha o gesto do arremesso
    camera.getWorldDirection(_v1);
    n.g.position.copy(camera.position).addScaledVector(_v1, 0.5);
    n.g.position.y -= 0.12;
    n.vel.copy(_v1).multiplyScalar(17.5);
    n.vel.y += 4.5;
    n.vel.addScaledVector(player.vel, 0.45);
    n.fuse = 2.2;
    n.live = true;
    n.g.visible = true;
  }

  const _n = new THREE.Vector3();
  function explode(p) {
    SFX.explosion();
    boomT = 0.35;
    boomLight.position.copy(p);
    boomLight.position.y += 0.6;
    for (let i = 0; i < 8; i++) { // fogo
      _v1.set(rand(-1, 1), rand(0.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(4, 9));
      FX.spawnParticle(p, _v1, i % 2 ? 0xffb347 : 0xff7a22, rand(0.2, 0.45), rand(0.25, 0.5), 6, true);
    }
    for (let i = 0; i < 7; i++) { // terra/fumaça
      _v1.set(rand(-1, 1), rand(0.5, 1.4), rand(-1, 1)).normalize().multiplyScalar(rand(3, 7));
      FX.spawnParticle(p, _v1, i % 2 ? 0x776952 : 0x57544e, rand(0.35, 0.7), rand(0.6, 1.1), 5);
    }
    const R = 7.5;
    for (const e of Enemies.list) {
      if (!e.alive) continue;
      const d = e.group.position.distanceTo(p);
      if (d < R) {
        _n.copy(e.group.position).sub(p).normalize();
        e.damage(Math.round(135 * (1 - d / R) + 25), e.group.position, _n, false);
      }
    }
    for (const B2 of Bosses) {
      if (!B2.alive) continue;
      const d = B2.pos().distanceTo(p);
      if (d < R + 2) {
        _n.copy(B2.pos()).sub(p).normalize();
        B2.damage(Math.round(110 * (1 - d / (R + 2)) + 20), p, _n, 'body');
      }
    }
    for (const a of extraTargets) {
      if (!a.alive) continue;
      const d = a.pos().distanceTo(p);
      if (d < R) {
        _n.copy(a.pos()).sub(p).normalize();
        a.damage(Math.round(120 * (1 - d / R) + 20), p, _n, false);
      }
    }
    if (window.__BR_splash) window.__BR_splash(p, R, 110); // BR: fere jogadores remotos/boss
    const dp = player.pos.distanceTo(p);
    if (dp < 6.5) playerDamage(Math.round(55 * (1 - dp / 6.5)), p);
    addTrauma(clamp(0.9 - dp * 0.04, 0.15, 0.9));
    // o carro sente a onda de choque
    const dcx = Car.chassisBody.position.x - p.x, dcy = Car.chassisBody.position.y - p.y, dcz = Car.chassisBody.position.z - p.z;
    const dc = Math.hypot(dcx, dcy, dcz);
    if (dc < 9 && dc > 0.1) {
      const f = 3800 * (1 - dc / 9) / dc;
      Car.chassisBody.wakeUp(); // pode estar dormindo (PERF)
      Car.chassisBody.applyImpulse(new CANNON.Vec3(dcx * f, Math.abs(dcy) * f + 600, dcz * f));
    }
  }

  function update(dt, t) {
    boomT = Math.max(0, boomT - dt);
    boomLight.intensity = boomT > 0 ? (boomT / 0.35) * 55 : 0;
    for (const n of pool) {
      if (!n.live) continue;
      n.fuse -= dt;
      n.band.material.emissiveIntensity = n.fuse < 0.7 ? (Math.sin(t * 30) > 0 ? 5 : 1) : 2;
      if (n.fuse <= 0) {
        n.live = false;
        n.g.visible = false;
        explode(n.g.position);
        continue;
      }
      n.vel.y -= 18 * dt;
      n.g.position.addScaledVector(n.vel, dt);
      n.g.rotation.x += n.spin * dt;
      n.g.rotation.z += n.spin * 0.7 * dt;
      const gy = heightAt(n.g.position.x, n.g.position.z);
      if (n.g.position.y < gy + 0.09) {
        n.g.position.y = gy + 0.09;
        terrainNormal(n.g.position.x, n.g.position.z, _n);
        const vn = n.vel.dot(_n);
        if (vn < 0) {
          n.vel.addScaledVector(_n, -1.45 * vn); // reflete com restituição
          n.vel.multiplyScalar(0.75);            // atrito
          if (-vn > 2.5) SFX.bounce();
        }
        if (n.vel.lengthSq() < 0.4) n.vel.set(0, 0, 0);
      }
    }
  }
  return { throwNade, update, explode };
}
