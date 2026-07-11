/* ================================================================
   PICKUPS — drops de munição, kit médico e granada (flutuam e giram)
   ================================================================ */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export function createPickups(deps) {
  const { heightAt, SFX, scene, Structures, showBanner, centerMsg, getGun, updateAmmoHUD, updateInvHUD, updateArmorHUD, player, inventory } = deps;
  const N = 26;
  const pool = [];
  const mAmmoBox = new THREE.MeshStandardMaterial({ color: 0x3a4a2e, roughness: 0.6, metalness: 0.2 });
  const mBrass = new THREE.MeshStandardMaterial({ color: 0xd9b04e, metalness: 0.85, roughness: 0.3, emissive: 0x402800, emissiveIntensity: 0.6 });
  const mMed = new THREE.MeshStandardMaterial({ color: 0xf2f5f7, roughness: 0.4 });
  const mCross = new THREE.MeshStandardMaterial({ color: 0xd23b30, emissive: 0xd23b30, emissiveIntensity: 0.8, roughness: 0.4 });
  const mNadeB = new THREE.MeshStandardMaterial({ color: 0x2c3328, roughness: 0.5 });
  const mNadeR = new THREE.MeshStandardMaterial({ color: 0x201000, emissive: 0xff8a2e, emissiveIntensity: 1.6 });

  function makeModel(type) {
    const g = new THREE.Group();
    if (type === 'ammo') {
      g.add(new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.3, 0.34, 2, 0.06), mAmmoBox));
      for (let i = 0; i < 3; i++) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 8), mBrass);
        b.position.set(-0.12 + i * 0.12, 0.22, 0);
        g.add(b);
      }
    } else if (type === 'med') {
      g.add(new THREE.Mesh(new RoundedBoxGeometry(0.44, 0.3, 0.34, 2, 0.07), mMed));
      const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.04), mCross); c1.position.set(0, 0, 0.18); g.add(c1);
      const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.26, 0.04), mCross); c2.position.set(0, 0, 0.18); g.add(c2);
    } else if (type === 'meat') { // pernil: osso + carne
      const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 6), mMed);
      bone.rotation.z = 0.5; g.add(bone);
      const m1 = new THREE.Mesh(new THREE.SphereGeometry(0.13, 9, 7), new THREE.MeshStandardMaterial({ color: 0xa14b2e, roughness: 0.7 }));
      m1.scale.set(1.25, 0.9, 0.9); m1.position.set(-0.07, -0.05, 0); g.add(m1);
      const m2 = new THREE.Mesh(new THREE.SphereGeometry(0.05, 7, 5), mMed);
      m2.position.set(0.12, 0.1, 0); g.add(m2);
    } else if (type === 'armor') { // peitoral azul brilhante
      const pl = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.42, 0.24, 2, 0.08),
        new THREE.MeshStandardMaterial({ color: 0x10243f, emissive: 0x3d8eff, emissiveIntensity: 1.6, metalness: 0.6, roughness: 0.3 }));
      g.add(pl);
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0x0a1830, emissive: 0x8fd0ff, emissiveIntensity: 3 }));
      core.position.z = 0.13; g.add(core);
    } else {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), mNadeB);
      b.scale.y = 1.25; g.add(b);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.03, 6, 14), mNadeR);
      band.rotation.x = Math.PI / 2; g.add(band);
    }
    return g;
  }
  for (let i = 0; i < N; i++) {
    const root = new THREE.Group();
    const models = { ammo: makeModel('ammo'), med: makeModel('med'), nade: makeModel('nade'), meat: makeModel('meat'), armor: makeModel('armor') };
    root.add(models.ammo, models.med, models.nade, models.meat, models.armor);
    root.visible = false;
    scene.add(root);
    pool.push({ root, models, type: 'ammo', live: false, age: 0 });
  }
  let idx = 0;
  function spawn(pos, type) {
    const p = pool[idx]; idx = (idx + 1) % N;
    p.type = type; p.live = true; p.age = 0;
    for (const k in p.models) p.models[k].visible = k === type;
    p.root.position.set(pos.x, heightAt(pos.x, pos.z) + 0.45, pos.z);
    p.root.visible = true;
  }
  function drop(pos, generous = false) {
    const r = Math.random();
    spawn(pos, r < (generous ? 0.34 : 0.45) ? 'ammo' : r < (generous ? 0.67 : 0.78) ? 'med' : 'nade');
  }
  // loot inicial nas construções (recompensa por explorar)
  for (const s of Structures.sites) {
    if (s.type === 'cabana') spawn({ x: s.x, z: s.z }, Math.random() < 0.5 ? 'med' : 'ammo');
    if (s.type === 'ruína') spawn({ x: s.x + 1, z: s.z + 1 }, Math.random() < 0.5 ? 'nade' : 'ammo');
  }

  function collect(p) {
    if (p.type === 'ammo') {
      getGun().reserve += Math.ceil(getGun().magSize * 1.5);
      updateAmmoHUD();
      centerMsg('+ munição', 700);
    } else if (p.type === 'med') {
      if (inventory.medkits < inventory.medkitsMax) { inventory.medkits++; centerMsg('+ kit médico', 700); }
      else { player.healPool += 30; centerMsg('+ vida', 700); }
      updateInvHUD();
    } else if (p.type === 'meat') {
      if (inventory.meat >= inventory.meatMax) { player.healPool += 20; centerMsg('+ vida', 700); }
      else { inventory.meat++; centerMsg('+ carne (F para comer)', 900); }
      updateInvHUD();
    } else if (p.type === 'armor') {
      player.armor = player.armorMax;
      updateArmorHUD();
      showBanner('ARMADURA DO GUARDIÃO<small>escudo azul absorve 70% do dano</small>', 4000);
    } else {
      if (inventory.nades >= inventory.nadesMax) return; // sem espaço: fica no chão
      inventory.nades++;
      updateInvHUD();
      centerMsg('+ granada', 700);
    }
    SFX.pickup();
    p.live = false;
    p.root.visible = false;
  }
  function update(dt, t) {
    for (const p of pool) {
      if (!p.live) continue;
      p.age += dt;
      p.root.rotation.y += dt * 1.6;
      p.root.position.y += Math.sin(t * 2.2 + p.root.position.x) * 0.0016;
      if (p.age > 40) { p.live = false; p.root.visible = false; continue; }
      if (p.age > 34) p.root.visible = Math.sin(t * 14) > 0; // pisca antes de sumir
      if (!player.dead && p.root.position.distanceToSquared(player.pos) < 2.1 * 2.1) collect(p);
    }
  }
  function actives() { return pool.filter(p => p.live); }
  return { spawn, drop, update, actives };
}
