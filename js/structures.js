/* ================================================================
   CONSTRUÇÕES — torres de vigia, cabanas, ruínas e o forte do boss
   Tudo mesclado em UMA malha com vertex colors (1 draw call) +
   AABBs para bala/visão/colisão e corpos estáticos no cannon.
   ================================================================ */
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

export function createStructures(deps) {
  const { clamp, rand, TAU, heightAt, slopeAt, platforms, WATER_LEVEL, CITY, scene, csmMat, paintGeometry } = deps;
  const sites = [];      // {x, z, r, type}
  const walls = [];      // AABBs sólidas {x0,x1,y0,y1,z0,z1}
  const geos = [];
  const smokeSpots = []; // topos de chaminé (fumaça ambiente)
  const flags = [];      // bandeiras que tremulam
  const flagGeo = new THREE.PlaneGeometry(1.15, 0.55);
  flagGeo.translate(0.6, 0, 0); // articulada no mastro
  const flagMat = new THREE.MeshStandardMaterial({ color: 0xe8562a, side: THREE.DoubleSide, roughness: 0.7 });
  const _sc = new THREE.Color();

  function sbox(w, h, d, x, y, z, color, solid = true) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    paintGeometry(g, _sc.setHex(color));
    geos.push(g);
    if (solid) {
      // corpo físico NÃO é criado aqui: o game.js cria um por parede a partir
      // de walls[] (com updateAABB) — criar aqui duplicava ~400 corpos mortos
      walls.push({ x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2, z0: z - d / 2, z1: z + d / 2 });
    }
  }
  function scone(r, h, x, y, z, color) {
    const g = new THREE.ConeGeometry(r, h, 4);
    g.rotateY(Math.PI / 4);
    g.translate(x, y, z);
    paintGeometry(g, _sc.setHex(color));
    geos.push(g);
  }

  function tower(cx, cz) {
    const y = heightAt(cx, cz);
    sites.push({ x: cx, z: cz, r: 5, type: 'torre' });
    const H = 6.2;
    for (const [ox, oz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]])
      sbox(0.34, H + 2, 0.34, cx + ox, y + H / 2 - 1, cz + oz, 0x6b4a2e);
    sbox(3.4, 0.2, 0.2, cx, y + 2.3, cz - 1.4, 0x8a6238, false);
    sbox(3.4, 0.2, 0.2, cx, y + 2.3, cz + 1.4, 0x8a6238, false);
    sbox(0.2, 0.2, 3.4, cx - 1.4, y + 3.6, cz, 0x8a6238, false);
    sbox(0.2, 0.2, 3.4, cx + 1.4, y + 3.6, cz, 0x8a6238, false);
    sbox(3.7, 0.28, 3.7, cx, y + H, cz, 0x8a6238);
    sbox(3.7, 0.5, 0.14, cx, y + H + 0.5, cz - 1.78, 0x6b4a2e, false);
    sbox(3.7, 0.5, 0.14, cx, y + H + 0.5, cz + 1.78, 0x6b4a2e, false);
    sbox(0.14, 0.5, 3.7, cx - 1.78, y + H + 0.5, cz, 0x6b4a2e, false);
    sbox(0.14, 0.5, 3.7, cx + 1.78, y + H + 0.5, cz, 0x6b4a2e, false);
    scone(3, 1.7, cx, y + H + 1.8, cz, 0xa84f35);
  }

  function cabin(cx, cz, flip) {
    const y = heightAt(cx, cz);
    sites.push({ x: cx, z: cz, r: 6.5, type: 'cabana' });
    const W = flip ? 4.4 : 5.4, D = flip ? 5.4 : 4.4, H = 2.7;
    sbox(W + 0.7, 0.34, D + 0.7, cx, y + 0.05, cz, 0x6e6a63, false);          // base (decorativa)
    sbox(W, H, 0.26, cx, y + H / 2 + 0.15, cz - D / 2, 0x8a6238);             // fundo
    sbox(0.26, H, D, cx - W / 2, y + H / 2 + 0.15, cz, 0x8a6238);             // lateral esq
    sbox(0.26, H, D, cx + W / 2, y + H / 2 + 0.15, cz, 0x8a6238);             // lateral dir
    const doorW = 1.2, segW = (W - doorW) / 2;                                 // frente com porta
    sbox(segW, H, 0.26, cx - (doorW + segW) / 2, y + H / 2 + 0.15, cz + D / 2, 0x8a6238);
    sbox(segW, H, 0.26, cx + (doorW + segW) / 2, y + H / 2 + 0.15, cz + D / 2, 0x8a6238);
    sbox(doorW + 0.3, 0.45, 0.3, cx, y + H + 0.05, cz + D / 2, 0x6b4a2e, false);
    sbox(W + 0.8, 0.18, D + 0.8, cx, y + H + 0.35, cz, 0x6b4a2e);             // forro
    const r1 = new THREE.BoxGeometry(W + 1.1, 0.15, D * 0.64);
    r1.rotateX(0.48); r1.translate(cx, y + H + 0.92, cz - D * 0.26);
    paintGeometry(r1, _sc.setHex(0xa84f35)); geos.push(r1);
    const r2 = new THREE.BoxGeometry(W + 1.1, 0.15, D * 0.64);
    r2.rotateX(-0.48); r2.translate(cx, y + H + 0.92, cz + D * 0.26);
    paintGeometry(r2, _sc.setHex(0xa84f35)); geos.push(r2);
    sbox(0.5, 1.5, 0.5, cx + W * 0.28, y + H + 1.1, cz - D * 0.18, 0x6e6a63, false); // chaminé
    smokeSpots.push({ x: cx + W * 0.28, y: y + H + 1.95, z: cz - D * 0.18 });
  }

  function ruin(cx, cz) {
    const y = heightAt(cx, cz);
    sites.push({ x: cx, z: cz, r: 5.5, type: 'ruína' });
    sbox(4.6, rand(1.1, 2.4), 0.42, cx, y + 0.7, cz - 2, 0x9a958c);
    sbox(0.42, rand(0.9, 2.6), 4.2, cx - 2.2, y + 0.7, cz, 0x9a958c);
    sbox(2, rand(0.6, 1.1), 0.42, cx + 1, y + 0.4, cz + 1.8, 0x6e6a63);
    sbox(0.7, 3, 0.7, cx + 2.1, y + 1.5, cz + 1.9, 0x9a958c);
    sbox(0.7, rand(0.8, 1.6), 0.7, cx - 2.1, y + 0.6, cz + 1.9, 0x6e6a63);
  }

  const flames = [];
  function fort(cx, cz) {
    sites.push({ x: cx, z: cz, r: 28, type: 'forte' });
    const y = heightAt(cx, cz);
    const S = 17, H = 4.6, T = 0.9;
    sbox(S * 2 + T, H + 2.5, T, cx, y + H / 2 - 0.6, cz - S, 0x9a958c);
    sbox(T, H + 2.5, S * 2, cx - S, y + H / 2 - 0.6, cz, 0x9a958c);
    sbox(T, H + 2.5, S * 2, cx + S, y + H / 2 - 0.6, cz, 0x9a958c);
    const gate = 4.6, seg = (S * 2 - gate) / 2;
    sbox(seg, H + 2.5, T, cx - (gate + seg) / 2, y + H / 2 - 0.6, cz + S, 0x9a958c);
    sbox(seg, H + 2.5, T, cx + (gate + seg) / 2, y + H / 2 - 0.6, cz + S, 0x9a958c);
    sbox(gate + 1.4, 1.1, T + 0.5, cx, y + H + 0.4, cz + S, 0x6e6a63, false);  // arco do portão
    for (const [ox, oz] of [[-S, -S], [S, -S], [-S, S], [S, S]]) {
      sbox(2.8, H + 4, 2.8, cx + ox, y + (H + 4) / 2 - 0.6, cz + oz, 0x6e6a63);
      // telhado pagode em 2 camadas (estilo oriental)
      scone(2.6, 1.3, cx + ox, y + H + 4.1, cz + oz, 0xb8342a);
      sbox(1.5, 0.5, 1.5, cx + ox, y + H + 4.9, cz + oz, 0x6e2620, false);
      scone(1.6, 1.1, cx + ox, y + H + 5.6, cz + oz, 0xb8342a);
      // mastro + bandeira tremulante
      sbox(0.09, 1.7, 0.09, cx + ox, y + H + 7.0, cz + oz, 0x6b4a2e, false);
      const fl = new THREE.Mesh(flagGeo, flagMat);
      fl.position.set(cx + ox, y + H + 7.4, cz + oz);
      fl.userData.ry = rand(TAU);
      scene.add(fl);
      flags.push(fl);
    }
    // portão torii vermelho + lanternas
    sbox(0.7, 7, 0.7, cx - 3.4, y + 3.2, cz + S + 1.6, 0xb8342a);
    sbox(0.7, 7, 0.7, cx + 3.4, y + 3.2, cz + S + 1.6, 0xb8342a);
    sbox(9.5, 0.55, 1.1, cx, y + 6.6, cz + S + 1.6, 0xb8342a, false);
    sbox(8, 0.45, 0.9, cx, y + 5.7, cz + S + 1.6, 0x6e2620, false);
    const lanternMat = new THREE.MeshStandardMaterial({ color: 0x401505, emissive: 0xff9a40, emissiveIntensity: 2.4, roughness: 0.5 });
    for (const lx of [-3.4, 3.4]) {
      const lt = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), lanternMat);
      lt.scale.y = 1.25;
      lt.position.set(cx + lx, y + 5.1, cz + S + 1.6);
      scene.add(lt);
      flames.push(lt);
    }
    // santuário central de teto curvo sobre o estrado
    sbox(0.45, 3.2, 0.45, cx - 2.4, y + 1.7, cz - 2.4, 0xb8342a);
    sbox(0.45, 3.2, 0.45, cx + 2.4, y + 1.7, cz - 2.4, 0xb8342a);
    sbox(0.45, 3.2, 0.45, cx - 2.4, y + 1.7, cz + 2.4, 0xb8342a);
    sbox(0.45, 3.2, 0.45, cx + 2.4, y + 1.7, cz + 2.4, 0xb8342a);
    scone(4.6, 1.6, cx, y + 3.9, cz, 0xb8342a);
    sbox(2.6, 0.5, 2.6, cx, y + 4.8, cz, 0x6e2620, false);
    scone(2.6, 1.3, cx, y + 5.7, cz, 0xb8342a);
    for (let i = -3; i <= 3; i++) sbox(1, 0.7, 0.5, cx + i * 4.2, y + H + 0.55, cz - S, 0x9a958c, false);
    sbox(7, 0.34, 7, cx, y + 0.05, cz, 0x6e6a63, false);                       // estrado central
    // braseiros com chama emissiva (brilham no bloom)
    const flameMat = new THREE.MeshStandardMaterial({ color: 0x331303, emissive: 0xff8a2e, emissiveIntensity: 3.2, roughness: 0.4 });
    for (const [ox, oz] of [[-4, 4], [4, 4], [-4, -4], [4, -4]]) {
      sbox(0.3, 1.3, 0.3, cx + ox, y + 0.75, cz + oz, 0x4b4843);
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), flameMat);
      f.position.set(cx + ox, y + 1.6, cz + oz);
      scene.add(f);
      flames.push(f);
    }
  }

  /* ---- posicionamento: acha pontos planos e sem sobreposição ---- */
  function flatSpot(rMin, rMax, tries = 70) {
    let best = null, bestS = 1e9;
    for (let i = 0; i < tries; i++) {
      const a = rand(TAU), r = rand(rMin, rMax);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!clearOf(x, z)) continue;
      const s = slopeAt(x, z) + slopeAt(x + 6, z) + slopeAt(x, z + 6) + slopeAt(x - 6, z) + slopeAt(x, z - 6);
      if (s < bestS) { bestS = s; best = { x, z }; }
    }
    return best;
  }
  function clearOf(x, z, need = 16) {
    if (Math.hypot(x, z) < 42) return false;
    if (Math.hypot(x - CITY.x, z - CITY.z) < 100) return false; // zona urbana reservada
    if (heightAt(x, z) < WATER_LEVEL + 1.5) return false; // nada construído dentro de lago
    for (const s of sites) if (Math.hypot(x - s.x, z - s.z) < s.r + need) return false;
    return true;
  }

  const FORT_POS = flatSpot(290, 410) || { x: 330, z: -280 };
  fort(FORT_POS.x, FORT_POS.z);
  for (let i = 0; i < 6; i++) { const p = flatSpot(90, 470); if (p) tower(p.x, p.z); }
  for (let i = 0; i < 6; i++) { const p = flatSpot(70, 440); if (p) cabin(p.x, p.z, i % 2 === 0); }
  for (let i = 0; i < 5; i++) { const p = flatSpot(80, 460); if (p) ruin(p.x, p.z); }

  /* ================= CIDADE + TORRE NEXUS ================= */
  const carSpots = [];      // vagas de veículos {x,z,ry,type}
  const enemyCamps = [];    // spawns planejados {x,z,suit,army,floorY}
  const chestSpots = [];    // baús
  let heliSpot, bazookaSpot, towerTopY;

  // fachada: texturas de janela geradas por canvas (lit à noite via emissiveMap)
  function facadeTex() {
    const c1 = document.createElement('canvas'); c1.width = 64; c1.height = 128;
    const c2 = document.createElement('canvas'); c2.width = 64; c2.height = 128;
    const a = c1.getContext('2d'), b = c2.getContext('2d');
    a.fillStyle = '#454c57'; a.fillRect(0, 0, 64, 128);
    b.fillStyle = '#000'; b.fillRect(0, 0, 64, 128);
    const warm = ['#ffd27a', '#ffe9b0', '#bcd8ff', '#ffc2a0'];
    for (let wy = 5; wy < 122; wy += 13) for (let wx = 5; wx < 58; wx += 13) {
      const lit = Math.random() < 0.4;
      a.fillStyle = lit ? '#2a2e36' : '#14181f';
      a.fillRect(wx, wy, 9, 8);
      if (lit) { b.fillStyle = warm[(Math.random() * warm.length) | 0]; b.fillRect(wx, wy, 9, 8); }
    }
    const t1 = new THREE.CanvasTexture(c1); t1.colorSpace = THREE.SRGBColorSpace;
    const t2 = new THREE.CanvasTexture(c2); t2.colorSpace = THREE.SRGBColorSpace;
    t1.wrapS = t1.wrapT = t2.wrapS = t2.wrapT = THREE.RepeatWrapping;
    return [t1, t2];
  }
  const [fMap, fEmis] = facadeTex();
  const cityMat = csmMat(new THREE.MeshStandardMaterial({
    map: fMap, emissiveMap: fEmis, emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.8, metalness: 0.1 }));
  const cityGeos = [];
  let emCidade = false; // marca walls/platforms urbanos p/ Structures.city
  function cityBox(w, h, d, x, y, z, solid = true) { // caixa texturizada (UV ~ por andar)
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(w, d) / 9, uv.getY(i) * h / 7);
    g.translate(x, y, z);
    cityGeos.push(g);
    if (solid) {
      walls.push({ x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2, z0: z - d / 2, z1: z + d / 2, city: true });
      // telhado pisável: pousar de paraquedas/pular em prédio da cidade funciona
      platforms.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y: y + h / 2, city: true });
    }
  }
  function floorSlab(w, d, x, y, z) { // andar: pisável + bloqueia bala, sem empurrar player
    sbox(w, 0.25, d, x, y - 0.13, z, 0x8b9099, false);
    walls.push({ x0: x - w / 2, x1: x + w / 2, y0: y - 0.26, y1: y, z0: z - d / 2, z1: z + d / 2, noCollide: true, city: emCidade });
    platforms.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y, city: emCidade });
  }
  {
    const cx = CITY.x, cz = CITY.z, gy = heightAt(cx, cz);
    emCidade = true;
    sites.push({ x: cx, z: cz, r: 88, type: 'cidade' });
    // ruas cruzadas + praça
    sbox(110, 0.12, 9, cx, gy + 0.02, cz + 26, 0x2b2e33, false);
    sbox(9, 0.12, 110, cx + 26, gy + 0.02, cz, 0x2b2e33, false);
    // prédios da cidade ao redor da torre
    const lots = [[-34, -28, 11, 22], [-16, -34, 12, 16], [4, -30, 10, 26], [38, -26, 13, 18],
      [-40, -2, 10, 14], [-38, 44, 12, 20], [-14, 42, 11, 24], [8, 44, 12, 15],
      [40, 8, 11, 19], [42, 42, 13, 28], [-44, 18, 9, 12], [16, -8, 9, 13]];
    for (const [ox, oz, w, h] of lots) {
      cityBox(w, h, w * rand(0.8, 1.1), cx + ox, gy + h / 2, cz + oz);
      // cobertura
      sbox(w * 0.4, 1, w * 0.3, cx + ox, gy + h + 0.5, cz + oz, 0x3a3f48, false);
    }
    // vagas de carros esportivos na rua
    carSpots.push({ x: cx + 14, z: cz + 26, ry: 0, type: 'sport' });          // de frente pra avenida
    carSpots.push({ x: cx - 8, z: cz + 26, ry: Math.PI, type: 'sport2' });
    carSpots.push({ x: cx + 26, z: cz - 16, ry: -Math.PI / 2, type: 'sport' });
    chestSpots.push({ x: cx + 21.5, z: cz + 18 });

    /* ---- TORRE NEXUS: 10 andares + escadaria + heliponto ---- */
    const W = 18, fh = 3.4, NF = 10;
    towerTopY = gy + NF * fh + 0.25;
    // casca externa texturizada (porta ao sul)
    cityBox(W, NF * fh + 1, 0.5, cx, gy + (NF * fh + 1) / 2, cz - W / 2);              // norte
    cityBox(0.5, NF * fh + 1, W, cx - W / 2, gy + (NF * fh + 1) / 2, cz);              // oeste
    cityBox(0.5, NF * fh + 1, W, cx + W / 2, gy + (NF * fh + 1) / 2, cz);              // leste
    cityBox(W / 2 - 2, NF * fh + 1, 0.5, cx - W / 4 - 1, gy + (NF * fh + 1) / 2, cz + W / 2); // sul-esq
    cityBox(W / 2 - 2, NF * fh + 1, 0.5, cx + W / 4 + 1, gy + (NF * fh + 1) / 2, cz + W / 2); // sul-dir
    cityBox(4.2, NF * fh + 1 - 3, 0.5, cx, gy + 3 + (NF * fh - 2) / 2, cz + W / 2);    // acima da porta
    // andares com poço de escada a oeste-norte
    for (let k = 1; k <= NF; k++) {
      const fy = gy + k * fh;
      floorSlab(13.4, 16.8, cx + 1.9, fy, cz);                  // laje principal
      floorSlab(3, 10.6, cx - 7, fy, cz + 3.1);                 // laje da ala oeste
      // rampa (escada) k-1 -> k no poço
      const ry0 = gy + (k - 1) * fh, ry1 = fy;
      platforms.push({ ramp: true, axis: 'z', x0: cx - 8.5, x1: cx - 5.5, z0: cz - 8.4, z1: cz - 2.4, y0: ry1, y1: ry0, city: emCidade });
      const rmp = new THREE.BoxGeometry(3, 0.22, 6.7);
      rmp.rotateX(Math.atan2(fh, 6));
      rmp.translate(cx - 7, (ry0 + ry1) / 2 - 0.1, cz - 5.4);
      paintGeometry(rmp, _sc.setHex(0x7d828c));
      geos.push(rmp);
      // inimigos de terno em andares alternados
      if (k % 2 === 0 && k < NF) {
        enemyCamps.push({ x: cx + 3, z: cz + rand(-4, 4), suit: true, floorY: fy });
        enemyCamps.push({ x: cx + rand(0, 5), z: cz + rand(-5, 5), suit: true, floorY: fy });
      }
    }
    // telhado: heliponto + recompensa
    floorSlab(W, W, cx, towerTopY, cz);
    sbox(W, 0.6, 0.4, cx, towerTopY + 0.3, cz - W / 2 + 0.2, 0x3a3f48, false); // mureta
    sbox(W, 0.6, 0.4, cx, towerTopY + 0.3, cz + W / 2 - 0.2, 0x3a3f48, false);
    sbox(0.4, 0.6, W, cx - W / 2 + 0.2, towerTopY + 0.3, cz, 0x3a3f48, false);
    sbox(0.4, 0.6, W, cx + W / 2 - 0.2, towerTopY + 0.3, cz, 0x3a3f48, false);
    const padGeo = new THREE.CylinderGeometry(5.2, 5.2, 0.1, 24);
    padGeo.translate(cx, towerTopY + 0.06, cz);
    paintGeometry(padGeo, _sc.setHex(0x32363d));
    geos.push(padGeo);
    sbox(3.4, 0.06, 0.7, cx, towerTopY + 0.12, cz, 0xe8eef4, false); // H
    sbox(0.7, 0.06, 2.6, cx - 1.35, towerTopY + 0.12, cz, 0xe8eef4, false);
    sbox(0.7, 0.06, 2.6, cx + 1.35, towerTopY + 0.12, cz, 0xe8eef4, false);
    heliSpot = { x: cx, y: towerTopY, z: cz };
    bazookaSpot = { x: cx + 6.5, y: towerTopY, z: cz + 6.5 };
    sbox(1.2, 0.7, 0.7, bazookaSpot.x, towerTopY + 0.35, bazookaSpot.z, 0x4a5240); // caixa da bazuca
    emCidade = false;
  }

  /* ================= BASES MILITARES ================= */
  const baseSites = [];
  function mbase(cx, cz) {
    const y = heightAt(cx, cz);
    sites.push({ x: cx, z: cz, r: 22, type: 'base' });
    baseSites.push({ x: cx, z: cz, cleared: false });
    const W2 = 21, D2 = 15, H2 = 2.4;
    sbox(W2 * 2, H2, 0.7, cx, y + H2 / 2 - 0.3, cz - D2, 0x4a5240);
    sbox(0.7, H2, D2 * 2, cx - W2, y + H2 / 2 - 0.3, cz, 0x4a5240);
    sbox(0.7, H2, D2 * 2, cx + W2, y + H2 / 2 - 0.3, cz, 0x4a5240);
    const g2 = 6;
    sbox(W2 - g2 / 2, H2, 0.7, cx - (g2 / 2 + (W2 - g2 / 2) / 2), y + H2 / 2 - 0.3, cz + D2, 0x4a5240);
    sbox(W2 - g2 / 2, H2, 0.7, cx + (g2 / 2 + (W2 - g2 / 2) / 2), y + H2 / 2 - 0.3, cz + D2, 0x4a5240);
    // tendas militares (prismas)
    for (const [ox, oz] of [[-12, -6], [-12, 4], [12, -5]]) {
      const t1 = new THREE.BoxGeometry(5.5, 0.16, 4.4); t1.rotateZ(0.7); t1.translate(cx + ox - 1.25, y + 1.25, cz + oz);
      paintGeometry(t1, _sc.setHex(0x55603f)); geos.push(t1);
      const t2 = new THREE.BoxGeometry(5.5, 0.16, 4.4); t2.rotateZ(-0.7); t2.translate(cx + ox + 1.25, y + 1.25, cz + oz);
      paintGeometry(t2, _sc.setHex(0x55603f)); geos.push(t2);
    }
    // sacos de areia + caixotes
    for (let i = 0; i < 5; i++) sbox(2.2, 0.8, 0.6, cx - 4 + i * 2.4, y + 0.4, cz + D2 - 3, 0x8a7a58);
    sbox(1.4, 1.4, 1.4, cx + 6, y + 0.7, cz - 8, 0x6b5a38);
    sbox(1.2, 1.2, 1.2, cx + 7.6, y + 0.6, cz - 7.2, 0x6b5a38);
    // guardas + caminhão
    for (let i = 0; i < 4; i++) enemyCamps.push({ x: cx + rand(-12, 12), z: cz + rand(-8, 8), army: true });
    carSpots.push({ x: cx, z: cz - 4, ry: rand(TAU), type: 'truck' });
    chestSpots.push({ x: cx - 5, z: cz - 8 });
  }
  for (let i = 0; i < 2; i++) { const p = flatSpot(130, 380); if (p) mbase(p.x, p.z); }
  chestSpots.push({ x: 5, z: 0.5 });

  const merged = BufferGeometryUtils.mergeGeometries(geos);
  const mesh = new THREE.Mesh(merged, csmMat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.02 })));
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  const cityMesh = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(cityGeos), cityMat);
  cityMesh.castShadow = cityMesh.receiveShadow = true;
  scene.add(cityMesh);

  /* ---- raio vs AABBs (slab test, sem alocação) ---- */
  function rayHit(o, d, maxDist) {
    let best = maxDist;
    for (const b of walls) {
      let t0 = 0, t1 = best, ta, tb;
      if (Math.abs(d.x) < 1e-8) { if (o.x < b.x0 || o.x > b.x1) continue; }
      else { ta = (b.x0 - o.x) / d.x; tb = (b.x1 - o.x) / d.x; if (ta > tb) { const m = ta; ta = tb; tb = m; } t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) continue; }
      if (Math.abs(d.y) < 1e-8) { if (o.y < b.y0 || o.y > b.y1) continue; }
      else { ta = (b.y0 - o.y) / d.y; tb = (b.y1 - o.y) / d.y; if (ta > tb) { const m = ta; ta = tb; tb = m; } t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) continue; }
      if (Math.abs(d.z) < 1e-8) { if (o.z < b.z0 || o.z > b.z1) continue; }
      else { ta = (b.z0 - o.z) / d.z; tb = (b.z1 - o.z) / d.z; if (ta > tb) { const m = ta; ta = tb; tb = m; } t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) continue; }
      if (t0 > 0 && t0 < best) best = t0;
    }
    return best === maxDist ? Infinity : best;
  }
  const _sd = new THREE.Vector3();
  function segBlocked(from, to) {
    _sd.copy(to).sub(from);
    const len = _sd.length();
    if (len < 1e-4) return false;
    _sd.multiplyScalar(1 / len);
    return rayHit(from, _sd, len) < len;
  }

  /* ---- empurra círculo (player/inimigo) para fora das paredes ---- */
  function collide(pos, radius, height) {
    for (const b of walls) {
      if (b.noCollide) continue; // lajes: pisáveis, não empurram
      // pés no nível do topo = está PISANDO no bloco (telhado) — não expulsa
      if (pos.y + height < b.y0 || pos.y >= b.y1 - 0.12) continue;
      const nx = clamp(pos.x, b.x0, b.x1), nz = clamp(pos.z, b.z0, b.z1);
      const dx = pos.x - nx, dz = pos.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        pos.x = nx + dx / d * radius;
        pos.z = nz + dz / d * radius;
      } else {
        const px = Math.min(pos.x - b.x0, b.x1 - pos.x);
        const pz = Math.min(pos.z - b.z0, b.z1 - pos.z);
        if (px < pz) pos.x = (pos.x - b.x0 < b.x1 - pos.x) ? b.x0 - radius : b.x1 + radius;
        else pos.z = (pos.z - b.z0 < b.z1 - pos.z) ? b.z0 - radius : b.z1 + radius;
      }
    }
  }

  /* ============ DESTRUIÇÃO DA CIDADE — módulo fundo, interface pequena ============
     Registro de tudo que é urbano (walls/platforms marcados city:true, corpos
     CANNON registrados pelo game.js) + versão destruída construída JÁ NO BOOT
     (invisível). destroy()/restore() trocam visual e colisão do mundo inteiro
     de forma atômica: jogador, bala (rayHit), telhados e física dos veículos. */
  const cityRuins = new THREE.Group();
  cityRuins.name = 'cidadeDestruida';
  cityRuins.visible = false;
  const ruinWalls = [];   // colisores simplificados dos escombros (poucos)
  {
    // PRNG PRÓPRIO: as ruínas nascem no boot e NÃO podem consumir o RNG
    // seedado do mundo — senão tudo gerado depois delas muda de lugar
    // (mundos de versões antigas/novas divergiriam e o QA quebra)
    let _rs = 0xC1DADE;
    const _rr = () => (_rs = (_rs * 1664525 + 1013904223) >>> 0) / 4294967296;
    const rand = (a = 1, b) => (b === undefined ? _rr() * a : a + _rr() * (b - a));
    const cx = CITY.x, cz = CITY.z, gy = heightAt(cx, cz);
    const mRuina = csmMat(new THREE.MeshStandardMaterial({ color: 0x2e2c2a, roughness: 0.95 }));
    const mQueim = csmMat(new THREE.MeshStandardMaterial({ color: 0x191715, roughness: 1 }));
    const mViga = new THREE.MeshStandardMaterial({ color: 0x4a3f34, roughness: 0.7, metalness: 0.5 });
    const mFogo = new THREE.MeshStandardMaterial({ color: 0x200800, emissive: 0xff7a2e, emissiveIntensity: 3 });
    // chão urbano escurecido + "rachaduras" (faixas escuras finas)
    const chao = new THREE.Mesh(new THREE.CircleGeometry(88, 40),
      new THREE.MeshStandardMaterial({ color: 0x14120f, roughness: 1, transparent: true, opacity: 0.85 }));
    chao.rotation.x = -Math.PI / 2;
    chao.position.set(cx, gy + 0.05, cz);
    cityRuins.add(chao);
    for (let i = 0; i < 10; i++) {
      const r = new THREE.Mesh(new THREE.PlaneGeometry(rand(14, 40), rand(0.5, 1.2)),
        new THREE.MeshBasicMaterial({ color: 0x050505 }));
      r.rotation.x = -Math.PI / 2;
      r.rotation.z = rand(TAU);
      r.position.set(cx + rand(-70, 70), gy + 0.07, cz + rand(-70, 70));
      cityRuins.add(r);
    }
    // stubs dos prédios: metade inferior, inclinados e chamuscados + vigas
    const lots = [[-34, -28, 11, 22], [-16, -34, 12, 16], [4, -30, 10, 26], [38, -26, 13, 18],
      [-40, -2, 10, 14], [-38, 44, 12, 20], [-14, 42, 11, 24], [8, 44, 12, 15],
      [40, 8, 11, 19], [42, 42, 13, 28], [-44, 18, 9, 12], [16, -8, 9, 13]];
    let li = 0;
    for (const [ox, oz, w, hOrig] of lots) {
      const h = hOrig * rand(0.28, 0.45);
      const stub = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.95), li % 2 ? mRuina : mQueim);
      stub.position.set(cx + ox, gy + h / 2 - 0.4, cz + oz);
      stub.rotation.z = rand(-0.09, 0.09);
      stub.rotation.x = rand(-0.07, 0.07);
      stub.castShadow = true;
      cityRuins.add(stub);
      for (let v = 0; v < 2; v++) {
        const viga = new THREE.Mesh(new THREE.BoxGeometry(0.28, hOrig * rand(0.4, 0.7), 0.28), mViga);
        viga.position.set(cx + ox + rand(-w / 2, w / 2), gy + viga.geometry.parameters.height / 2 - 0.3,
          cz + oz + rand(-w / 2, w / 2));
        viga.rotation.z = rand(-0.35, 0.35);
        cityRuins.add(viga);
      }
      // colisor simplificado só nos 6 primeiros stubs: BAIXO (1,6m) — dá pra
      // pular por cima; balas passam por cima; só barra quem anda reto nele
      if (li < 6) ruinWalls.push({ x0: cx + ox - w / 2, x1: cx + ox + w / 2,
        y0: gy - 0.4, y1: gy + 1.6, z0: cz + oz - w / 2, z1: cz + oz + w / 2, cityRuin: true });
      li++;
    }
    // Torre Nexus severamente danificada: toco alto e torto
    const toco = new THREE.Mesh(new THREE.BoxGeometry(13, 14, 13), mQueim);
    toco.position.set(cx, gy + 6.6, cz);
    toco.rotation.z = 0.12;
    cityRuins.add(toco);
    ruinWalls.push({ x0: cx - 6.5, x1: cx + 6.5, y0: gy - 0.4, y1: gy + 13, z0: cz - 6.5, z1: cz + 6.5, cityRuin: true });
    // entulho instanciado (decorativo, sem física — barato)
    const debGeo = new THREE.BoxGeometry(1, 0.7, 1);
    const deb = new THREE.InstancedMesh(debGeo, mRuina, 120);
    const dm = new THREE.Object3D();
    for (let i = 0; i < 120; i++) {
      const a = rand(TAU), r = rand(4, 84);
      dm.position.set(cx + Math.cos(a) * r, gy + rand(0, 0.5), cz + Math.sin(a) * r);
      dm.rotation.set(rand(TAU), rand(TAU), rand(TAU));
      dm.scale.setScalar(rand(0.4, 1.8));
      dm.updateMatrix();
      deb.setMatrixAt(i, dm.matrix);
    }
    deb.castShadow = true;
    cityRuins.add(deb);
    // focos de fogo (cones emissive) + 2 luzes dinâmicas SÓ quando visível
    for (const [fx, fz] of [[-30, -24], [18, 30], [40, 6]]) {
      const fogo = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.6, 6), mFogo);
      fogo.position.set(cx + fx, gy + 0.8, cz + fz);
      cityRuins.add(fogo);
    }
    cityRuins.add(new THREE.PointLight(0xff7a2e, 1.6, 40, 1.4).translateX(cx - 30).translateY(gy + 3).translateZ(cz - 24));
    cityRuins.add(new THREE.PointLight(0xff9a4e, 1.2, 34, 1.4).translateX(cx + 40).translateY(gy + 3).translateZ(cz + 6));
    scene.add(cityRuins);
  }

  const city = {
    center: { x: CITY.x, z: CITY.z },
    radius: 95,
    _state: 'intact',
    _bodies: [],          // corpos CANNON das paredes urbanas (registrados pelo game.js)
    _world: null,
    _savedWalls: [], _savedPlatforms: [],
    containsPoint(x, z) { return Math.hypot(x - CITY.x, z - CITY.z) <= this.radius; },
    getState() { return this._state; },
    setState(st) { if (st === 'destroyed') this.destroy(); else if (st === 'intact') this.restore(); },
    registerBody(b) { this._bodies.push(b); },
    bindPhysics(world) { this._world = world; },
    destroy() {
      if (this._state === 'destroyed') return;
      this._state = 'destroyed';
      cityMesh.visible = false;
      cityRuins.visible = true;
      // colisão: paredes/plataformas urbanas saem dos arrays COMPARTILHADOS
      this._savedWalls = walls.filter(w => w.city);
      this._savedPlatforms = platforms.filter(p => p.city);
      for (let i = walls.length - 1; i >= 0; i--) if (walls[i].city) walls.splice(i, 1);
      for (let i = platforms.length - 1; i >= 0; i--) if (platforms[i].city) platforms.splice(i, 1);
      for (const rw of ruinWalls) walls.push(rw); // escombros: poucos colisores baixos
      if (this._world) for (const b of this._bodies) this._world.removeBody(b);
    },
    restore() {
      if (this._state === 'intact') return;
      this._state = 'intact';
      cityMesh.visible = true;
      cityRuins.visible = false;
      for (let i = walls.length - 1; i >= 0; i--) if (walls[i].cityRuin) walls.splice(i, 1);
      for (const w of this._savedWalls) walls.push(w);
      for (const p of this._savedPlatforms) platforms.push(p);
      this._savedWalls = []; this._savedPlatforms = [];
      if (this._world) for (const b of this._bodies) this._world.addBody(b);
    },
  };

  return { sites, walls, rayHit, segBlocked, collide, FORT_POS, flames, smokeSpots, flags, city,
    cityMat, carSpots, enemyCamps, chestSpots, baseSites, heliSpot, bazookaSpot, towerTopY };
}
