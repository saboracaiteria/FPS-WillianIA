/* VISITANTE — boss alienígena — extraído de game.js; deps explícitas */
import * as THREE from 'three';

export function createAlien(deps) {
  const { rand, TAU, _v1, _v2, heightAt, biomeAt, WATER_LEVEL, CITY, SFX, FX, scene, csmMat, addScore, addKillFeed, showBanner, unlockWeapon, state, player, playerDamage, Bosses, Pickups, MFlags, setTimeScale, Chars } = deps;
  // acha um ponto de deserto para a queda do disco
  let SITE = { x: 260, z: 260 };
  for (let i = 0; i < 200; i++) {
    const a = rand(TAU), r = rand(180, 430);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (biomeAt(x, z) < -0.3 && heightAt(x, z) > WATER_LEVEL + 1.5 && Math.hypot(x - CITY.x, z - CITY.z) > 110) { SITE = { x, z }; break; }
  }
  const sy = heightAt(SITE.x, SITE.z);
  // disco voador acidentado
  {
    const hull = csmMat(new THREE.MeshStandardMaterial({ color: 0x7d8894, metalness: 0.85, roughness: 0.3 }));
    const saucer = new THREE.Mesh(new THREE.SphereGeometry(7, 24, 12), hull);
    saucer.scale.set(1, 0.22, 1);
    saucer.position.set(SITE.x, sy + 0.8, SITE.z);
    saucer.rotation.z = 0.28;
    saucer.castShadow = true;
    scene.add(saucer);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(2.4, 16, 10, 0, TAU, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x4dffd2, transparent: true, opacity: 0.35, emissive: 0x2affd0, emissiveIntensity: 0.6 }));
    dome.position.set(SITE.x, sy + 2.0, SITE.z);
    dome.rotation.z = 0.28;
    scene.add(dome);
    const ringG = new THREE.Mesh(new THREE.TorusGeometry(5.6, 0.25, 8, 28),
      new THREE.MeshStandardMaterial({ color: 0x0a2a22, emissive: 0x35ffc8, emissiveIntensity: 2.2 }));
    ringG.rotation.x = Math.PI / 2 + 0.28;
    ringG.position.set(SITE.x, sy + 1.1, SITE.z);
    scene.add(ringG);
  }
  // o Visitante
  const skin = csmMat(new THREE.MeshStandardMaterial({ color: 0x9fb8a8, roughness: 0.6 }));
  const eyeM = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.15, metalness: 0.6 });
  const group = new THREE.Group();
  const parts = {};
  {
    const cast = m => { m.castShadow = true; return m; };
    const torso = cast(new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1.0, 6, 12), skin));
    torso.position.y = 2.2; group.add(torso);
    parts.head = new THREE.Group();
    parts.head.position.y = 3.35;
    const skull = cast(new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), skin));
    skull.scale.set(1, 1.25, 1.05);
    parts.head.add(skull);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 9), eyeM);
      eye.scale.set(1, 1.5, 0.6);
      eye.position.set(s * 0.26, 0.05, 0.42);
      eye.rotation.z = s * 0.4;
      parts.head.add(eye);
    }
    group.add(parts.head);
    for (const s of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(s * 0.5, 2.85, 0);
      const a1 = cast(new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.9, 4, 8), skin));
      a1.position.y = -0.55; arm.add(a1);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), skin);
      hand.position.y = -1.1; arm.add(hand);
      parts[s < 0 ? 'armL' : 'armR'] = arm;
      group.add(arm);
      const leg = cast(new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.9, 4, 8), skin));
      leg.position.set(s * 0.22, 0.85, 0);
      group.add(leg);
    }
  }
  // altura no PONTO DELE (sy é a altura do disco, 6m ao lado — numa duna
  // inclinada o Visitante nascia até 2m enterrado)
  group.position.set(SITE.x + 6, heightAt(SITE.x + 6, SITE.z + 6), SITE.z + 6);
  scene.add(group);

  /* pele nova: alien rigado (alien.optimized.glb) com a animação embutida
     "Take 001" em loop — FSM/hitbox/dano continuam os mesmos */
  let mixer = null, hasModel = false;
  if (Chars) Chars.character('/assets/models/Personagens/alien.optimized.glb', { height: 3.7 })
    .then(mold => {
      const inst = mold.build();
      group.traverse(o => { if (o.isMesh) o.visible = false; }); // corpo procedural some
      group.add(inst.root);
      mixer = inst.mixer;
      hasModel = true;
      const take = Object.values(inst.actions)[0];
      if (take) take.play();
    })
    .catch(err => console.error('Alien GLB falhou — Visitante segue procedural:', err));

  const B = { alive: true, active: false, hp: 1900, hpMax: 1900, yaw: 0, phase: 0, nextShot: 0, blinkT: 6, deadT: -1, respawnT: 0 };
  const orbs = [];
  const orbMat = new THREE.MeshStandardMaterial({ color: 0x03130f, emissive: 0x35ffc8, emissiveIntensity: 4, roughness: 0.3 });
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), orbMat);
    m.visible = false; scene.add(m);
    orbs.push({ m, vel: new THREE.Vector3(), live: false });
  }
  const sph = [
    { c: new THREE.Vector3(), r: 0.75, part: 'head' },
    { c: new THREE.Vector3(), r: 0.62, part: 'body' },
    { c: new THREE.Vector3(), r: 0.45, part: 'body' },
  ];
  function hitSpheres() {
    const p = group.position;
    sph[0].c.set(p.x, p.y + 3.35, p.z);
    sph[1].c.set(p.x, p.y + 2.2, p.z);
    sph[2].c.set(p.x, p.y + 1.0, p.z);
    return sph;
  }
  function damage(dmg, hitPos, dir, part) {
    if (!B.alive || B.deadT >= 0) return false;
    B.active = true;
    B.hp -= dmg * (part === 'head' ? 1.4 : 1);
    if (B.hp <= 0) {
      B.alive = false; B.deadT = 0; B.respawnT = 150;
      addScore(2000, true);
      addKillFeed('<b>Você</b> ▸ <b>O VISITANTE</b>');
      SFX.victory();
      setTimeScale(0.3);
      setTimeout(() => { setTimeScale(1); }, 900);
      showBanner('VISITANTE ELIMINADO<small>tecnologia alienígena recuperada</small>', 4200);
      unlockWeapon(4, 'rifle de plasma equipável na tecla 5');
      for (let i = 0; i < 4; i++) Pickups.drop({ x: group.position.x + rand(-4, 4), z: group.position.z + rand(-4, 4) }, true);
      MFlags.alien = true;
      return true;
    }
    return false;
  }
  function update(dt, t) {
    for (const o of orbs) {
      if (!o.live) continue;
      o.m.position.addScaledVector(o.vel, dt);
      o.m.scale.setScalar(1 + Math.sin(t * 26) * 0.15);
      const d = o.m.position.distanceTo(player.pos);
      if (d < 1.2 || o.m.position.y < heightAt(o.m.position.x, o.m.position.z) + 0.2) {
        o.live = false; o.m.visible = false;
        FX.burst(o.m.position, _v1.set(0, 1, 0), 'spark');
        if (d < 4) playerDamage(Math.round(16 * (1 - d / 5)) + 5, o.m.position);
      }
    }
    if (!B.alive) {
      if (B.deadT >= 0) {
        B.deadT += dt;
        group.rotation.x = -Math.min(1.4, B.deadT * 1.5);
        if (B.deadT > 1) group.position.y = heightAt(group.position.x, group.position.z) - (B.deadT - 1) * 0.8;
        if (B.deadT > 3) { B.deadT = -1; group.visible = false; }
      } else {
        B.respawnT -= dt;
        if (B.respawnT <= 0) {
          B.alive = true; B.active = false; B.hp = B.hpMax;
          group.visible = true; group.rotation.set(0, 0, 0);
          group.position.set(SITE.x + 6, heightAt(SITE.x + 6, SITE.z + 6), SITE.z + 6);
        }
      }
      return;
    }
    const dP = group.position.distanceTo(player.pos);
    if (!B.active) {
      if (dP < 45 && !player.dead) { B.active = true; SFX.roar(); showBanner('O VISITANTE<small>algo saiu dos destroços...</small>', 3000); }
      group.position.y = heightAt(group.position.x, group.position.z) + Math.sin(t * 1.2) * 0.1;
      return;
    }
    B.phase += dt;
    // teleporte lateral (blink)
    B.blinkT -= dt;
    if (B.blinkT <= 0 && dP < 60) {
      B.blinkT = rand(4, 7);
      FX.burst(group.position, _v1.set(0, 1, 0), 'spark');
      const a = rand(TAU);
      group.position.x += Math.cos(a) * 10;
      group.position.z += Math.sin(a) * 10;
      FX.burst(group.position, _v1.set(0, 1, 0), 'spark');
    }
    // persegue flutuando
    const dx = player.pos.x - group.position.x, dz = player.pos.z - group.position.z;
    const d = Math.hypot(dx, dz);
    if (d > 12) {
      group.position.x += dx / d * 3.4 * dt;
      group.position.z += dz / d * 3.4 * dt;
    }
    B.yaw = Math.atan2(dx, dz);
    group.rotation.y = B.yaw;
    group.position.y = heightAt(group.position.x, group.position.z) + 0.25 + Math.sin(B.phase * 2) * 0.15;
    if (hasModel) {
      mixer.update(dt); // "Take 001" em loop dá vida ao corpo inteiro
    } else {
      parts.armR.rotation.x = -1.2; // mão erguida disparando
      parts.armL.rotation.x = Math.sin(B.phase * 1.5) * 0.3;
    }
    // tiro triplo de plasma
    if (dP < 70 && state.gameTime >= B.nextShot && !player.dead) {
      B.nextShot = state.gameTime + 1.6;
      for (let i = 0; i < 3; i++) {
        const o = orbs.find(o => !o.live);
        if (!o) break;
        o.live = true; o.m.visible = true;
        o.m.position.set(group.position.x, group.position.y + 2.8, group.position.z);
        _v2.copy(player.pos); _v2.y += 1.2;
        _v2.x += rand(-2, 2) * i; _v2.z += rand(-2, 2) * i;
        o.vel.copy(_v2).sub(o.m.position).normalize().multiplyScalar(22);
        SFX.bossShot();
      }
    }
  }
  const api = { update, damage, hitSpheres, get alive() { return B.alive; }, pos: () => group.position, state: B, name: 'VISITANTE', SITE };
  Bosses.push(api);
  return api;
}
