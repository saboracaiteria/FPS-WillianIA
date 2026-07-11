/* ================================================================
   CLIENTE BATTLE ROYALE — parte 2: lógica da partida.
   Avatares voxel, nave alienígena, paraquedas, zona de gás, baús,
   balística de projétil, boss sincronizado, espectador e vitória.
   Carregado pelo multiplayer-client.js; conversa com o jogo só por
   window.__MP / window.__game (nada do jogo é modificado aqui).
   ================================================================ */
(function () {
  'use strict';

  function start(ctx) {
    const { MP, G, INIT, socket, S, UI, LOBBY, esc, seededRng } = ctx;
    const THREE = MP.THREE;
    const LIM = MP.CFG.WORLD_SIZE / 2;
    const A = G.arsenal;
    const KNIFE = 5; // índice da faca no arsenal

    /* encaminha estado do evento da cidade (o script pode bootar depois) */
    function sendCity(c) {
      if (window.__CityDestruction) window.__CityDestruction.sync(c);
      else setTimeout(() => sendCity(c), 200);
    }
    if (INIT.cityDestruction && INIT.cityDestruction.eventId) sendCity(INIT.cityDestruction);
    socket.on('cityDestruction', c => sendCity(c));

    /* =============== avatares voxel dos outros jogadores =============== */
    const remotes = new Map();
    window.__MP_remotePlayers = []; // varrido pelo fire() do jogo (inclui o boss)

    function nickSprite(name, cssColor) {
      const cv = document.createElement('canvas');
      cv.width = 256; cv.height = 64;
      const c2 = cv.getContext('2d');
      c2.font = 'bold 32px system-ui, sans-serif';
      c2.textAlign = 'center'; c2.textBaseline = 'middle';
      c2.shadowColor = 'rgba(0,0,0,.9)'; c2.shadowBlur = 8;
      c2.fillStyle = cssColor;
      c2.fillText(name.slice(0, 14), 128, 32);
      const tex = new THREE.CanvasTexture(cv);
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      spr.scale.set(2.6, 0.65, 1);
      spr.position.y = 2.35;
      return spr;
    }

    /* boneco voxel low-poly: cabeça, tronco, braços, pernas + visor */
    function buildVoxelBody(colors) {
      const [cBody, cCloth, cDetail, cVisor] = (colors || ['#4da6ff', '#2b3a4d', '#8a5a2b', '#ffd76a'])
        .map(c => new THREE.Color(c));
      const mBody = new THREE.MeshStandardMaterial({ color: cBody, roughness: 0.65 });
      const mCloth = new THREE.MeshStandardMaterial({ color: cCloth, roughness: 0.8 });
      const mDetail = new THREE.MeshStandardMaterial({ color: cDetail, roughness: 0.7 });
      const mVisor = new THREE.MeshStandardMaterial({ color: cVisor, emissive: cVisor, emissiveIntensity: 0.7, roughness: 0.3 });
      const g = new THREE.Group();
      const box = (m, w, h, d, x, y, z, parent) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
        b.position.set(x, y, z); (parent || g).add(b); return b;
      };
      const legL = new THREE.Group(), legR = new THREE.Group();
      legL.position.set(-0.15, 0.78, 0); legR.position.set(0.15, 0.78, 0);
      box(mCloth, 0.22, 0.78, 0.26, 0, -0.39, 0, legL);
      box(mCloth, 0.22, 0.78, 0.26, 0, -0.39, 0, legR);
      box(mDetail, 0.24, 0.14, 0.3, 0, -0.72, 0.02, legL); // bota
      box(mDetail, 0.24, 0.14, 0.3, 0, -0.72, 0.02, legR);
      g.add(legL, legR);
      box(mBody, 0.56, 0.62, 0.32, 0, 1.1, 0);            // tronco
      box(mCloth, 0.58, 0.24, 0.34, 0, 0.92, 0);          // cinto/roupa
      const armL = new THREE.Group(), armR = new THREE.Group();
      armL.position.set(-0.38, 1.36, 0); armR.position.set(0.38, 1.36, 0);
      box(mBody, 0.16, 0.6, 0.2, 0, -0.26, 0, armL);
      box(mBody, 0.16, 0.6, 0.2, 0, -0.26, 0, armR);
      g.add(armL, armR);
      box(mBody, 0.4, 0.38, 0.38, 0, 1.66, 0);            // cabeça
      box(mVisor, 0.3, 0.09, 0.06, 0, 1.7, -0.21);        // visor
      box(mDetail, 0.44, 0.08, 0.42, 0, 1.87, 0);         // "capacete"
      // paraquedas (escondido por padrão)
      const chute = new THREE.Group();
      const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.7, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: cBody, roughness: 0.9, side: THREE.DoubleSide }));
      canopy.position.y = 4.4; chute.add(canopy);
      const lineMat = new THREE.LineBasicMaterial({ color: 0x222222 });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const geo = new THREE.BufferGeometry().setFromPoints(
          [new THREE.Vector3(sx * 0.3, 1.8, sz * 0.15), new THREE.Vector3(sx * 1.2, 4.2, sz * 0.8)]);
        chute.add(new THREE.Line(geo, lineMat));
      }
      chute.visible = false;
      g.add(chute);
      return { g, legL, legR, armL, armR, chute, mats: [mBody, mCloth, mDetail] };
    }

    function makeRemote(id, nk, colors, pos) {
      const body = buildVoxelBody(colors);
      const group = body.g;
      group.add(nickSprite(nk || '???', '#ffffff'));
      if (Array.isArray(pos)) group.position.set(pos[0], pos[1], pos[2]);
      MP.scene.add(group);
      const rp = {
        id, nick: nk || '???', alive: true, isBoss: false,
        group, body, targetPos: group.position.clone(), yaw: 0, targetYaw: 0,
        chute: false, ship: false, car: -1, heli: false, hitT: 0, deadT: 0, lastPos: group.position.clone(), speed: 0, walkPh: 0,
        sphCache: [
          { c: new THREE.Vector3(), r: 0.28, part: 'head' },
          { c: new THREE.Vector3(), r: 0.42, part: 'body' },
          { c: new THREE.Vector3(), r: 0.34, part: 'body' }, // pernas (dano reduzido via hitPos.y)
        ],
        hitSpheres() {
          const p = this.group.position;
          this.sphCache[0].c.set(p.x, p.y + 1.66, p.z);
          this.sphCache[1].c.set(p.x, p.y + 1.1, p.z);
          this.sphCache[2].c.set(p.x, p.y + 0.42, p.z);
          return this.sphCache;
        },
        damage(dmg, hitPos) {
          if (hitPos && hitPos.y < this.group.position.y + 0.78) dmg *= 0.8; // perna dói menos
          queueHit(this.id, Math.round(dmg));
          this.hitT = 0.3;
          return false; // morte confirmada pelo dono/servidor
        },
      };
      remotes.set(id, rp);
      window.__MP_remotePlayers.push(rp);
      return rp;
    }
    /* GPU: geometrias/materiais/texturas são POR avatar — sem dispose, cada
       jogador que entra e sai da sala vazava memória de vídeo pra sempre */
    function disposeGroup(g) {
      g.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
        for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
      });
    }
    function removeRemote(id) {
      const rp = remotes.get(id);
      if (!rp) return;
      MP.scene.remove(rp.group);
      disposeGroup(rp.group);
      remotes.delete(id);
      const i = window.__MP_remotePlayers.indexOf(rp);
      if (i >= 0) window.__MP_remotePlayers.splice(i, 1);
    }

    /* acertos agregados por alvo (escopeta = 1 mensagem, não 8) */
    const pendingHits = new Map();
    let hitFlush = false;
    function queueHit(targetId, dmg) {
      pendingHits.set(targetId, (pendingHits.get(targetId) || 0) + dmg);
      if (hitFlush) return;
      hitFlush = true;
      queueMicrotask(() => {
        hitFlush = false;
        for (const [tid, total] of pendingHits) {
          socket.emit('shotHit', {
            targetId: tid, dmg: Math.min(total, 95), weapon: G.gun ? G.gun.name : '???',
            fromPos: [MP.player.pos.x, MP.player.pos.y + 1.5, MP.player.pos.z],
          });
        }
        pendingHits.clear();
      });
    }

    /* =============== balística (projéteis com queda) =============== */
    const bullets = [];
    const _bv = new THREE.Vector3(), _bp = new THREE.Vector3();
    const _yAxis = new THREE.Vector3(0, 1, 0);
    window.__BR_takenCars = new Set();

    /* dano de área (granada/bazuca) nos jogadores remotos e no boss —
       sem isto explosivo era inútil no BR (só feria bots do modo solo) */
    window.__BR_splash = function (p, radius, maxDmg) {
      for (const rp of window.__MP_remotePlayers) {
        if (!rp.alive) continue;
        const d = rp.group.position.distanceTo(p);
        if (d < radius) {
          const dmg = Math.round(maxDmg * (1 - d / radius) + 20);
          MP.DmgNums.spawn(rp.group.position, dmg, false);
          rp.damage(dmg, rp.group.position);
        }
      }
    };
    window.__BR_ballistics = function (origin, dir, gun) {
      bullets.push({
        p: origin.clone(), v: dir.clone().multiplyScalar(gun.projSpeed),
        drop: gun.projDrop || 6, life: 1.7, dmg: gun.dmg, laser: !!gun.laser,
      });
    };
    function segSphere(p0, seg, segLen, c, r) { // distância ao longo do segmento ou -1
      _bv.copy(c).sub(p0);
      const proj = _bv.dot(seg);
      if (proj < -r || proj > segLen + r) return -1;
      const d2 = _bv.lengthSq() - proj * proj;
      if (d2 > r * r) return -1;
      return Math.max(0, proj - Math.sqrt(r * r - d2));
    }
    function stepBullets(dt) {
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.life -= dt;
        b.v.y -= b.drop * dt;
        const segLen = b.v.length() * dt;
        _bp.copy(b.v).normalize();
        // alvos: jogadores remotos + boss
        let bestD = Infinity, bestRp = null, bestPart = null;
        for (const rp of window.__MP_remotePlayers) {
          if (!rp.alive) continue;
          if (rp.group.position.distanceToSquared(b.p) > 320 * 320) continue;
          for (const s of rp.hitSpheres()) {
            const d = segSphere(b.p, _bp, segLen, s.c, s.r);
            if (d >= 0 && d < bestD) { bestD = d; bestRp = rp; bestPart = s.part; }
          }
        }
        const blockD = MP.rayBlockedAt(b.p, _bp, Math.min(segLen, bestD));
        const col = b.laser ? 0x52ffe6 : 0xffe9a8;
        if (blockD < Math.min(segLen, bestD)) { // terreno/parede
          _bv.copy(b.p).addScaledVector(_bp, blockD);
          MP.FX.spawnTracer(b.p, _bv, col);
          MP.FX.burst(_bv, _bp.clone().negate(), 'dirt');
          bullets.splice(i, 1);
          continue;
        }
        if (bestRp && bestD <= segLen) { // acertou alguém
          _bv.copy(b.p).addScaledVector(_bp, bestD);
          MP.FX.spawnTracer(b.p, _bv, col);
          const head = bestPart === 'head' || bestPart === 'core';
          let dmg = b.dmg * (head ? 1.75 : 1);
          MP.FX.burst(_bv, _bp.clone().negate(), bestRp.isBoss ? 'spark' : 'blood');
          MP.DmgNums.spawn(_bv, Math.round(dmg), head);
          MP.showHitmarker(false);
          if (head) MP.SFX.headshot(); else MP.SFX.hit();
          bestRp.damage(dmg, _bv);
          bullets.splice(i, 1);
          continue;
        }
        _bv.copy(b.p).addScaledVector(_bp, segLen);
        MP.FX.spawnTracer(b.p, _bv, col);
        b.p.copy(_bv);
        if (b.life <= 0 || b.p.y < -60) bullets.splice(i, 1);
      }
    }

    /* =============== faca (melee) =============== */
    window.__BR_melee = function (origin, dir, dmg) {
      let bestD = Infinity, bestRp = null;
      for (const rp of window.__MP_remotePlayers) {
        if (!rp.alive) continue;
        if (rp.group.position.distanceToSquared(origin) > 5.2 * 5.2) continue;
        for (const s of rp.hitSpheres()) {
          const d = segSphere(origin, dir, 2.6, s.c, s.r + 0.25);
          if (d >= 0 && d < bestD) { bestD = d; bestRp = rp; }
        }
      }
      if (bestRp) {
        _bv.copy(origin).addScaledVector(dir, bestD);
        MP.FX.burst(_bv, dir.clone().negate(), bestRp.isBoss ? 'spark' : 'blood');
        MP.DmgNums.spawn(_bv, Math.round(dmg), false);
        MP.showHitmarker(false);
        MP.SFX.hit();
        bestRp.damage(dmg, _bv);
      }
    };

    /* =============== nave alienígena =============== */
    let ship = null;
    function buildShip() {
      const g = new THREE.Group();
      const mHull = new THREE.MeshStandardMaterial({ color: 0x39424f, metalness: 0.75, roughness: 0.35 });
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(9, 12, 2.4, 24), mHull);
      g.add(disc);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(4.6, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x2dd6c4, transparent: true, opacity: 0.5, roughness: 0.15, metalness: 0.4 }));
      dome.position.y = 1.1; g.add(dome);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(10.2, 0.5, 8, 32),
        new THREE.MeshStandardMaterial({ color: 0x0a2e28, emissive: 0x2dd6c4, emissiveIntensity: 2.2 }));
      ring.rotation.x = Math.PI / 2; g.add(ring);
      const mLite = new THREE.MeshStandardMaterial({ color: 0x201000, emissive: 0xffb03c, emissiveIntensity: 3 });
      for (let i = 0; i < 8; i++) {
        const l = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), mLite);
        const a = i / 8 * Math.PI * 2;
        l.position.set(Math.cos(a) * 11, -0.9, Math.sin(a) * 11);
        g.add(l);
      }
      const beam = new THREE.PointLight(0x2dd6c4, 3.2, 60, 1.6);
      beam.position.y = -4; g.add(beam);
      /* ---- CABINE INTERNA: os jogadores viajam DENTRO da nave ----
         parede/teto escuros (BackSide: visíveis só por dentro) e um piso
         anelar com JANELA de vidro no centro — dá pra olhar o mapa lá embaixo
         (o casco por baixo é face frontal → invisível de dentro, sem furo real) */
      const mWall = new THREE.MeshStandardMaterial({ color: 0x161d27, roughness: 0.85, metalness: 0.35, side: THREE.BackSide });
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 2.4, 24, 1, true), mWall);
      wall.position.y = 0.2; g.add(wall);
      const teto = new THREE.Mesh(new THREE.CircleGeometry(8, 24),
        new THREE.MeshStandardMaterial({ color: 0x0e1a22, roughness: 0.9, side: THREE.DoubleSide }));
      teto.rotation.x = Math.PI / 2; teto.position.y = 1.35; g.add(teto);
      const piso = new THREE.Mesh(new THREE.RingGeometry(3.1, 8, 32),
        new THREE.MeshStandardMaterial({ color: 0x232c38, roughness: 0.7, metalness: 0.25, side: THREE.DoubleSide }));
      piso.rotation.x = -Math.PI / 2; piso.position.y = -0.95; g.add(piso);
      const janela = new THREE.Mesh(new THREE.CircleGeometry(3.1, 32),
        new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }));
      janela.name = 'cabineJanela';
      janela.rotation.x = -Math.PI / 2; janela.position.y = -0.97; g.add(janela);
      const aro = new THREE.Mesh(new THREE.TorusGeometry(3.15, 0.09, 8, 40),
        new THREE.MeshStandardMaterial({ color: 0x0a2e28, emissive: 0x2dd6c4, emissiveIntensity: 1.8 }));
      aro.rotation.x = Math.PI / 2; aro.position.y = -0.9; g.add(aro);
      const luzTeto = new THREE.PointLight(0x6fe8d8, 1.7, 20, 1.4);
      luzTeto.position.y = 1.1; g.add(luzTeto);
      const luzJanela = new THREE.PointLight(0x9fd8ff, 0.8, 12, 1.6);
      luzJanela.position.y = -0.5; g.add(luzJanela);
      MP.scene.add(g);
      return { g, ring };
    }
    function shipPos(out, tm) {
      const sp = S.plan.ship;
      const k = Math.min(Math.max(tm / sp.flyTime, 0), 1.18);
      out.set(
        sp.from[0] + (sp.to[0] - sp.from[0]) * k,
        sp.alt + Math.sin(tm * 1.7) * 1.2,
        sp.from[1] + (sp.to[1] - sp.from[1]) * k,
      );
      return k;
    }
    // assento: desloca cada jogador um pouquinho dentro da nave
    let seat = 0;
    for (let i = 0; i < INIT.id.length; i++) seat = (seat * 31 + INIT.id.charCodeAt(i)) | 0;
    const seatOx = ((seat >>> 4) % 7 - 3) * 0.9, seatOz = ((seat >>> 8) % 7 - 3) * 0.9;

    /* =============== queda + paraquedas =============== */
    let fallVy = 0;
    const _mv = new THREE.Vector3(), _fw = new THREE.Vector3(), _rt = new THREE.Vector3();
    function fallStep(dt) {
      const P = MP.player;
      const maxFall = S.chuteOpen ? 8.5 : 46;
      const acc = S.chuteOpen ? 26 : 34;
      fallVy = Math.max(fallVy - acc * dt, -maxFall);
      if (S.chuteOpen && fallVy < -8.5) fallVy += (Math.min(-8.5 - fallVy, 60 * dt)); // freia ao abrir
      // deriva horizontal com WASD na direção da câmera
      MP.camera.getWorldDirection(_fw); _fw.y = 0; _fw.normalize();
      _rt.set(-_fw.z, 0, _fw.x);
      _mv.set(0, 0, 0);
      const K = G.keys;
      if (K.KeyW) _mv.add(_fw);
      if (K.KeyS) _mv.sub(_fw);
      if (K.KeyD) _mv.add(_rt);
      if (K.KeyA) _mv.sub(_rt);
      if (_mv.lengthSq() > 0) _mv.normalize().multiplyScalar(S.chuteOpen ? 10.5 : 13);
      P.pos.x += _mv.x * dt;
      P.pos.z += _mv.z * dt;
      P.pos.y += fallVy * dt;
      P.pos.x = Math.max(-LIM + 8, Math.min(LIM - 8, P.pos.x));
      P.pos.z = Math.max(-LIM + 8, Math.min(LIM - 8, P.pos.z));
      const gy = MP.groundAt(P.pos.x, P.pos.z, P.pos.y);
      if (!S.chuteOpen && P.pos.y - gy < 120) {
        S.chuteOpen = true;
        UI.hint('🪂 paraquedas aberto — WASD pra planar', 2500);
      }
      if (P.pos.y <= gy + 0.4) { // pousou
        P.pos.y = gy + 0.2;
        P.vel.set(0, 0, 0);
        S.chuteOpen = false;
        S.phase = 'PLAY';
        window.__BR_freeze = false;
        UI.hint('');
        MP.centerMsg('Boa sorte. Ache um baú!', 2200);
      }
    }
    function jumpFromShip() {
      if (S.phase !== 'SHIP') return;
      S.phase = 'FALL';
      S.jumped = true;
      fallVy = -4;
      UI.hint('🌀 caindo — [ESPAÇO] abre o paraquedas antes', 3000);
    }

    /* =============== céu sincronizado: dia/noite e clima iguais pra todos ===============
       cada cliente rodava o próprio relógio (pausa, aba oculta e slow-mo da morte
       descolavam tudo) — aqui o horário é função pura do relógio da PARTIDA,
       e o clima é sorteado por (seed ^ época), determinístico em todo cliente */
    const DAY_LEN = 480, DAY_SPD = 0.62 / DAY_LEN, NIGHT_SPD = 1.9 / DAY_LEN; // espelho do Env
    function todAt(t) {
      let tod = 0.33, rem = Math.max(0, t);
      for (let guard = 0; rem > 0 && guard < 96; guard++) {
        const day = tod >= 0.25 && tod < 0.75;
        const spd = day ? DAY_SPD : NIGHT_SPD;
        const edge = day ? 0.75 : (tod < 0.25 ? 0.25 : 1.25);
        const toEdge = (edge - tod) / spd;
        if (toEdge > rem) { tod += rem * spd; break; }
        tod = edge >= 1 ? edge - 1 : edge;
        rem -= toEdge;
      }
      return tod % 1;
    }
    let skyAcc = 9; // força a 1ª sincronização de clima logo de cara
    function skySync(dt) {
      if (!S.plan || !MP.state.started) return;
      const ciclo = S.flags && S.flags.ciclo;
      G.Env.tod = ciclo === 'dia' ? 0.45 : ciclo === 'noite' ? 0.95 : todAt(S.matchT());
      skyAcc += dt;
      if (skyAcc > 1) {
        skyAcc = 0;
        const epoch = Math.floor(Math.max(0, S.matchT()) / 75); // clima muda a cada ~75s
        const r = seededRng((INIT.worldSeed ^ Math.imul(epoch + 1, 2654435761)) >>> 0)();
        const w = r < 0.52 ? 'limpo' : r < 0.8 ? 'chuva' : 'neve';
        if (G.Env.weather !== w) G.Env.weather = w;
      }
    }

    /* =============== zona de gás =============== */
    let zoneWall = null;
    const zc = { x: 0, z: 0, r: 9999, nx: 0, nz: 0, nr: 9999, dps: 0, label: '', closesIn: 0, shrinking: false, started: false };
    function buildZoneWall() {
      const geo = new THREE.CylinderGeometry(1, 1, 300, 72, 1, true);
      const mat = new THREE.MeshBasicMaterial({ color: 0x37e0ff, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false });
      zoneWall = new THREE.Mesh(geo, mat);
      zoneWall.position.y = 130;
      MP.scene.add(zoneWall);
    }
    function updateZone() {
      if (!S.plan) return;
      const t = S.matchT();
      const ph = S.plan.zone;
      const first = ph[0];
      zc.started = t > first.tWaitEnd - 999; // sempre true depois do plano existir
      let cur = null, shrinking = false, k = 0;
      for (const p of ph) {
        if (t < p.tWaitEnd) { cur = p; break; }
        if (t < p.tShrinkEnd) { cur = p; shrinking = true; k = (t - p.tWaitEnd) / (p.tShrinkEnd - p.tWaitEnd); break; }
      }
      if (!cur) { // depois da última fase: círculo final parado
        const last = ph[ph.length - 1];
        zc.x = last.nx; zc.z = last.nz; zc.r = last.r1;
        zc.nx = last.nx; zc.nz = last.nz; zc.nr = last.r1;
        zc.dps = last.dps + 3;
        zc.label = '☠ ZONA FINAL';
        zc.shrinking = false;
        return;
      }
      if (shrinking) {
        zc.x = cur.cx + (cur.nx - cur.cx) * k;
        zc.z = cur.cz + (cur.nz - cur.cz) * k;
        zc.r = cur.r0 + (cur.r1 - cur.r0) * k;
        zc.label = '⚠ ZONA FECHANDO';
      } else {
        zc.x = cur.cx; zc.z = cur.cz; zc.r = cur.r0;
        zc.closesIn = Math.max(0, cur.tWaitEnd - t);
        const m = Math.floor(zc.closesIn / 60), s = Math.floor(zc.closesIn % 60);
        zc.label = `⭘ zona fecha em ${m}:${String(s).padStart(2, '0')}`;
      }
      zc.nx = cur.nx; zc.nz = cur.nz; zc.nr = cur.r1;
      zc.dps = cur.dps;
      zc.shrinking = shrinking;
    }
    function drawZoneMap() {
      const c2 = UI.zoneMapC.getContext('2d');
      const Ssz = UI.zoneMapC.width;
      const W = (v) => (v + LIM) / (2 * LIM) * Ssz;
      const P = MP.player.pos;
      const fora = S.plan && Math.hypot(P.x - zc.x, P.z - zc.z) > zc.r;
      c2.clearRect(0, 0, Ssz, Ssz);
      // fundo: avermelha quando VOCÊ está fora da safe
      c2.fillStyle = fora && S.phase === 'PLAY' ? 'rgba(70,18,14,.9)' : 'rgba(20,30,26,.85)';
      c2.fillRect(0, 0, Ssz, Ssz);
      if (S.plan) {
        // área SAFE preenchida (clara) + borda branca
        c2.fillStyle = 'rgba(160,255,190,.14)';
        c2.beginPath(); c2.arc(W(zc.x), W(zc.z), zc.r / (2 * LIM) * Ssz, 0, Math.PI * 2); c2.fill();
        c2.strokeStyle = 'rgba(255,255,255,.9)'; c2.lineWidth = 1.6;
        c2.beginPath(); c2.arc(W(zc.x), W(zc.z), zc.r / (2 * LIM) * Ssz, 0, Math.PI * 2); c2.stroke();
        c2.strokeStyle = 'rgba(126,224,129,.95)'; c2.lineWidth = 1.3;
        c2.beginPath(); c2.arc(W(zc.nx), W(zc.nz), zc.nr / (2 * LIM) * Ssz, 0, Math.PI * 2); c2.stroke();
        if (S.phase === 'SHIP' || S.phase === 'FALL') { // rota da nave
          c2.strokeStyle = 'rgba(45,214,196,.7)';
          c2.setLineDash([3, 3]);
          c2.beginPath();
          c2.moveTo(W(S.plan.ship.from[0]), W(S.plan.ship.from[1]));
          c2.lineTo(W(S.plan.ship.to[0]), W(S.plan.ship.to[1]));
          c2.stroke();
          c2.setLineDash([]);
        }
        if (fora) { // seta VOCÊ → safe (caminho mais curto)
          const ang = Math.atan2(zc.z - P.z, zc.x - P.x);
          const px = W(P.x), pz = W(P.z);
          const bx = W(zc.x + Math.cos(ang + Math.PI) * zc.r), bz = W(zc.z + Math.sin(ang + Math.PI) * zc.r);
          c2.strokeStyle = 'rgba(255,90,70,.95)'; c2.lineWidth = 2;
          c2.setLineDash([4, 3]);
          c2.beginPath(); c2.moveTo(px, pz); c2.lineTo(bx, bz); c2.stroke();
          c2.setLineDash([]);
        }
      }
      if (boss && boss.alive) {
        c2.fillStyle = '#ffb03c';
        c2.fillRect(W(boss.group.position.x) - 2.5, W(boss.group.position.z) - 2.5, 5, 5);
      }
      // VOCÊ: triângulo apontando pra onde a câmera olha, com contorno
      _eul.setFromQuaternion(MP.camera.quaternion);
      const yaw = -_eul.y; // canvas: +z pra baixo
      c2.save();
      c2.translate(W(P.x), W(P.z));
      c2.rotate(yaw);
      c2.fillStyle = fora ? '#ff5f4a' : '#7fffb0';
      c2.strokeStyle = 'rgba(0,0,0,.8)'; c2.lineWidth = 1.5;
      c2.beginPath(); c2.moveTo(0, -6.5); c2.lineTo(4.5, 5); c2.lineTo(0, 2.4); c2.lineTo(-4.5, 5); c2.closePath();
      c2.fill(); c2.stroke();
      c2.restore();
    }

    /* =============== baús =============== */
    const crates = [];
    function buildCrates() {
      const rng = seededRng(INIT.worldSeed ^ 0xC0FFEE);
      const mkMat = (base, band) => [
        new THREE.MeshStandardMaterial({ color: base, roughness: 0.7 }),
        new THREE.MeshStandardMaterial({ color: 0x0e2a26, emissive: band, emissiveIntensity: 1.8, roughness: 0.4 }),
      ];
      function addCrate(key, x, z) {
        const y = MP.heightAt(x, z);
        if (y < MP.WATER_LEVEL + 1.2) return false;
        const [mBox, mBand] = mkMat(0x5b4630, 0x2dd6c4);
        const g = new THREE.Group();
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.55, 0.65), mBox);
        base.position.y = 0.28; g.add(base);
        const lid = new THREE.Mesh(new THREE.BoxGeometry(1, 0.22, 0.7), mBox);
        lid.position.set(0, 0.62, 0); g.add(lid);
        const band = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.1, 0.72), mBand);
        band.position.y = 0.5; g.add(band);
        g.position.set(x, y, z);
        g.rotation.y = rng() * Math.PI * 2;
        MP.scene.add(g);
        crates.push({ key, g, lid, band, opened: false, x, z });
        return true;
      }
      // espalhados pelo mapa
      let placed = 0, tries = 0;
      while (placed < 34 && tries < 400) {
        tries++;
        const x = (rng() * 2 - 1) * (LIM - 70), z = (rng() * 2 - 1) * (LIM - 70);
        if (MP.slopeAt(x, z) > 0.5) continue;
        if (addCrate('c' + placed, x, z)) placed++;
      }
      // garantidos nos pontos de interesse (cidade, base, cabanas…)
      let si = 0;
      for (const s of (G.Structures.sites || [])) {
        addCrate('s' + si++, s.x + 2.2, s.z + 1.4);
        if (rng() < 0.4) addCrate('s' + si++, s.x - 2.4, s.z - 1.8);
      }
      for (const key of INIT.openedChests || []) markOpened(key);
    }
    function markOpened(key) {
      const c = crates.find(c => c.key === key);
      if (c && !c.opened) {
        c.opened = true;
        c.lid.rotation.x = -1.15;
        c.lid.position.z = -0.28;
        c.band.material.emissiveIntensity = 0.15;
      }
    }
    function nearestCrate() {
      const P = MP.player.pos;
      let best = null, bd = 2.4 * 2.4;
      for (const c of crates) {
        if (c.opened) continue;
        const dx = P.x - c.x, dz = P.z - c.z;
        const d = dx * dx + dz * dz;
        if (d < bd && Math.abs(P.y - c.g.position.y) < 3) { bd = d; best = c; }
      }
      return best;
    }
    function applyItems(items, sourceLabel) {
      const inv = G.inventory, P = MP.player;
      for (const it of items) {
        if (it.type === 'weapon' && A[it.weapon]) {
          const w = A[it.weapon];
          if (w.locked) { w.locked = false; w.mag = w.magSize; }
          w.reserve += it.ammo || 0;
          MP.updateSlotsHUD();
          UI.toast(`🔫 ${esc(w.name)} · ${esc(it.rarity || 'comum')}`, it.rarity);
          if (G.gun && G.gun.melee) G.switchWeapon(it.weapon);
        } else if (it.type === 'ammo') {
          const w = (G.gun && !G.gun.melee) ? G.gun : A.find(w => !w.locked && !w.melee);
          if (w) { w.reserve += it.amount || 30; UI.toast(`📦 +${it.amount || 30} munição`, 'comum'); }
        } else if (it.type === 'med') {
          if (inv.medkits < inv.medkitsMax) inv.medkits++;
          else P.healPool += 30;
          UI.toast('✚ kit médico', 'incomum');
        } else if (it.type === 'armor') {
          P.armor = Math.min(P.armorMax, P.armor + (it.amount || 50));
          MP.updateArmorHUD();
          UI.toast(`🛡 +${it.amount || 50} armadura`, 'raro');
        } else if (it.type === 'nade') {
          if (inv.nades < inv.nadesMax) inv.nades++;
          UI.toast('● granada', 'comum');
        }
      }
      MP.updateAmmoHUD(); MP.updateInvHUD();
      MP.SFX.pickup();
      if (sourceLabel) MP.centerMsg(sourceLabel, 900);
    }
    function tryOpenCrate() {
      const c = nearestCrate();
      if (!c) return;
      socket.timeout(3000).emit('openChest', { key: c.key }, (err, res) => {
        if (err || !res || !res.ok) { if (res && res.opened) markOpened(c.key); return; }
        markOpened(c.key);
        applyItems(res.items, 'baú aberto');
      });
    }

    /* =============== drops de morte =============== */
    const drops = new Map();
    function spawnDrop(id, pos) {
      const g = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x223, emissive: 0x5ab0ff, emissiveIntensity: 1.4 }));
      box.position.y = 0.3; g.add(box);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.4, 26, 8, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x5ab0ff, transparent: true, opacity: 0.35, depthWrite: false }));
      beam.position.y = 13; g.add(beam);
      // groundAt respeita andares/telhados — morrer no 3º andar deixa o loot LÁ
      const y = MP.groundAt(pos[0], pos[2], (pos[1] || 0) + 1);
      g.position.set(pos[0], y, pos[2]);
      MP.scene.add(g);
      drops.set(id, { g, box });
    }
    function removeDrop(id) {
      const d = drops.get(id);
      if (d) { MP.scene.remove(d.g); disposeGroup(d.g); drops.delete(id); }
    }
    for (const d of INIT.drops || []) spawnDrop(d.id, d.pos);

    /* =============== BOSS — golem sincronizado =============== */
    let boss = null;
    let bossHp = INIT.bossHp || 0, bossMaxHp = INIT.bossMaxHp || 1;
    let bossDeadFlag = !!INIT.bossDead; // resetado a cada matchStart
    let bossDeadAnim = 0, lastAoE = 0;
    function buildBoss() {
      if (bossDeadFlag) return;
      const mRock = new THREE.MeshStandardMaterial({ color: 0x4a4f58, roughness: 0.85 });
      const mMoss = new THREE.MeshStandardMaterial({ color: 0x3e6b34, roughness: 0.9 });
      const mCore = new THREE.MeshStandardMaterial({ color: 0x200800, emissive: 0xff7a2e, emissiveIntensity: 3 });
      const g = new THREE.Group();
      const box = (m, w, h, d, x, y, z, parent) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
        b.position.set(x, y, z); (parent || g).add(b); return b;
      };
      const legL = new THREE.Group(), legR = new THREE.Group();
      legL.position.set(-0.7, 2.1, 0); legR.position.set(0.7, 2.1, 0);
      box(mRock, 0.9, 2.1, 1.1, 0, -1.05, 0, legL);
      box(mRock, 0.9, 2.1, 1.1, 0, -1.05, 0, legR);
      g.add(legL, legR);
      box(mRock, 2.6, 2.2, 1.6, 0, 3.1, 0);           // tronco
      box(mMoss, 2.7, 0.5, 1.7, 0, 4.1, 0);           // ombros musgo
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 9), mCore);
      core.position.set(0, 3.1, -0.85); g.add(core);  // núcleo (ponto fraco)
      const armL = new THREE.Group(), armR = new THREE.Group();
      armL.position.set(-1.7, 3.9, 0); armR.position.set(1.7, 3.9, 0);
      box(mRock, 0.8, 2.6, 1, 0, -1.3, 0, armL);
      box(mRock, 0.8, 2.6, 1, 0, -1.3, 0, armR);
      g.add(armL, armR);
      box(mRock, 1.3, 1.1, 1.2, 0, 4.9, 0);           // cabeça
      box(mCore.clone(), 0.7, 0.16, 0.1, 0, 5, -0.62); // olhos
      MP.scene.add(g);
      boss = {
        id: '__boss', nick: 'GOLEM', alive: !INIT.bossDead, isBoss: true,
        group: g, legL, legR, armL, armR, core, slamT: 0,
        sphCache: [
          { c: new THREE.Vector3(), r: 0.75, part: 'head' },
          { c: new THREE.Vector3(), r: 0.55, part: 'core' },
          { c: new THREE.Vector3(), r: 1.5, part: 'body' },
          { c: new THREE.Vector3(), r: 0.9, part: 'body' },
        ],
        hitSpheres() {
          const p = this.group.position, fw = this.fw || { x: 0, z: -1 };
          this.sphCache[0].c.set(p.x, p.y + 4.9, p.z);
          this.sphCache[1].c.set(p.x + fw.x * 0.9, p.y + 3.1, p.z + fw.z * 0.9);
          this.sphCache[2].c.set(p.x, p.y + 3.1, p.z);
          this.sphCache[3].c.set(p.x, p.y + 1.1, p.z);
          return this.sphCache;
        },
        damage(dmg, hitPos) {
          socket.emit('bossHit', { dmg: Math.round(dmg) });
          bossHp = Math.max(0, bossHp - dmg); // predição local
          return false;
        },
      };
      window.__MP_remotePlayers.push(boss);
    }
    function bossStep(dt) {
      if (!boss) return;
      const F = G.Structures.FORT_POS;
      if (!boss.alive) { // afundando
        if (bossDeadAnim < 1) {
          bossDeadAnim += dt * 0.4;
          boss.group.position.y -= dt * 4;
          boss.group.rotation.x += dt * 0.15;
          if (bossDeadAnim >= 1) boss.group.visible = false;
        }
        UI.bossBar.style.display = 'none';
        return;
      }
      const t = S.matchT();
      const a = t * 0.055;
      const bx = F.x + Math.cos(a) * 26, bz = F.z + Math.sin(a) * 26;
      const by = MP.heightAt(bx, bz);
      boss.group.position.set(bx, by, bz);
      const fwx = -Math.sin(a), fwz = Math.cos(a); // tangente do círculo
      boss.fw = { x: fwx, z: fwz };
      boss.group.rotation.y = Math.atan2(fwx, fwz);
      const ph = t * 2.2;
      boss.legL.rotation.x = Math.sin(ph) * 0.45;
      boss.legR.rotation.x = -Math.sin(ph) * 0.45;
      boss.armL.rotation.x = -Math.sin(ph) * 0.3;
      boss.armR.rotation.x = Math.sin(ph) * 0.3;
      if (boss.slamT > 0) { boss.slamT -= dt; boss.armL.rotation.x = boss.armR.rotation.x = -2 + boss.slamT * 4; }
      boss.core.material.emissiveIntensity = 2.4 + Math.sin(t * 5) * 0.8;
      // ataque de área
      const P = MP.player.pos;
      const d = Math.hypot(P.x - bx, P.z - bz);
      if (S.phase === 'PLAY' && !MP.player.dead && d < 8 && t - lastAoE > 2.2) {
        lastAoE = t;
        boss.slamT = 0.5;
        MP.playerDamage(16, boss.group.position);
      }
      // barra de vida
      const near = d < 75;
      UI.bossBar.style.display = near ? 'block' : 'none';
      if (near) UI.bossFill.style.width = (bossHp / bossMaxHp * 100) + '%';
    }

    /* continua abaixo: espectador, morte, vitória, eventos, loops */
    require2();

    /* =============== espectador =============== */
    let spectIdx = 0;
    function aliveTargets() {
      return [...remotes.values()].filter(r => r.alive && !r.isBoss);
    }
    function enterSpectator() {
      S.phase = 'SPECT';
      window.__BR_freeze = true;
      const P = MP.player;
      P.dead = false;
      P.health = P.maxHealth;
      P.invulnUntil = Infinity;
      MP.updateHealthHUD();
      const ds = document.getElementById('deathScreen');
      if (ds) ds.classList.remove('show');
      MP.setTimeScale(1);
      LOBBY.hide();
      UI.spectBar.style.display = 'block';
      updateSpectBar();
    }
    function updateSpectBar() {
      const list = aliveTargets();
      const cur = list.length ? list[spectIdx % list.length] : null;
      UI.spectBar.innerHTML = cur
        ? `👁 ESPECTANDO <b>${esc(cur.nick)}</b> · [ESPAÇO] troca · ${list.length} vivos`
        : '👁 ESPECTADOR · aguardando o fim da partida';
    }
    function spectStep() {
      const list = aliveTargets();
      const P = MP.player;
      if (!list.length) { // ninguém pra assistir: paira sobre a zona
        P.pos.set(zc.x, Math.max(MP.heightAt(zc.x, zc.z) + 40, 40), zc.z + zc.r * 0.4);
        return;
      }
      const cur = list[spectIdx % list.length];
      MP.camera.getWorldDirection(_fw);
      P.pos.copy(cur.group.position);
      P.pos.y += 1.1;
      P.pos.addScaledVector(_fw, -5.5);
      const gy = MP.heightAt(P.pos.x, P.pos.z);
      if (P.pos.y < gy + 0.6) P.pos.y = gy + 0.6;
    }

    /* =============== morte → recap → espectador =============== */
    let myDeathInfo = null; // preenchido pelo playerKilled (victim == eu)
    let forceDeath = false; // servidor me matou (zona/AFK): aplica na primeira chance
    window.__MP_respawn = function () { // chamado pelo jogo 3.6s após a morte
      MP.setTimeScale(1);
      // morreu dirigindo/voando: sai do veículo, senão a câmera fica presa no carro no espectador
      try { if (G.state.driving || G.state.flying) G.tryToggleCar(); } catch (e) {}
      const killer = S.lastHit && Date.now() - S.lastHit.t < 9000 ? S.lastHit : null;
      // solta o loot no chão pros outros: armas + munição + colete + kit
      const items = [];
      for (let i = 0; i < 5; i++) if (!A[i].locked)
        items.push({ type: 'weapon', weapon: i, ammo: A[i].mag + A[i].reserve, rarity: 'raro' });
      items.push({ type: 'ammo', amount: 60 });
      items.push({ type: 'armor', amount: 50 });
      if (G.inventory.medkits > 0) items.push({ type: 'med' });
      socket.emit('deathDrop', { pos: [MP.player.pos.x, MP.player.pos.y, MP.player.pos.z], items });
      socket.timeout(3000).emit('died',
        { killerId: killer ? killer.shooterId : null, weapon: killer ? killer.weapon : null, byZone: !killer },
        (err, res) => { if (!err && res && res.placement) S.myPlacement = res.placement; showRecap(); });
      setTimeout(showRecap, 1500); // garantia caso o ack não venha
    };
    // o jogo checa esta flag na morte: sem ela, cairia no location.reload() do solo
    // e a morte nunca seria reportada ao servidor (kill perdida + fantasma na partida)
    window.__MP_active = true;
    let recapShown = false;
    function showRecap() {
      if (recapShown || S.phase === 'ENDED') return;
      recapShown = true;
      const di = myDeathInfo;
      const who = di && di.killerNick
        ? `eliminado por <b style="color:#ffd76a">${esc(di.killerNick)}</b> com <b>${esc(di.weapon)}</b> (${di.killerKills} kills)`
        : (di && di.byZone ? 'o <b style="color:#7ee081">GÁS</b> te pegou' : 'você caiu em combate');
      LOBBY.overlay(`
        <div class="brTitle" style="color:#ff6b57">☠ VOCÊ FOI ELIMINADO</div>
        <div class="brSub">PARTIDA #${S.matchNum}</div>
        <div style="text-align:center;font-size:17px;margin:14px 0">${who}</div>
        <div style="text-align:center;font-size:15px;opacity:.85">
          colocação <b style="color:#ffd76a">#${S.myPlacement || '—'}</b> · suas kills: <b>${S.myKills}</b></div>
        <div style="text-align:center;font-size:12px;opacity:.6;margin-top:14px">entrando como espectador...</div>`);
      setTimeout(() => { if (S.phase !== 'ENDED') enterSpectator(); }, 4200);
    }

    /* =============== começo de partida =============== */
    function disableSoloAI() {
      try {
        for (const e of G.Enemies.list) { e.alive = false; if (e.group) e.group.visible = false; }
        G.Boss.state.alive = false; G.Boss.pos().set(0, -900, 0);
        G.Alien.state.alive = false; G.Alien.pos().set(0, -900, 0);
      } catch (err) { console.warn('[BR] disableSoloAI', err); }
    }
    function setupLoadout() {
      for (let i = 0; i < A.length; i++) {
        A[i].locked = i !== KNIFE;
        if (!A[i].melee) { A[i].reserve = 0; A[i].mag = A[i].magSize; }
      }
      // balística BR (projéteis com queda) — fuzil, DMR e plasma
      A[0].projSpeed = 200; A[0].projDrop = 6.5;
      A[2].projSpeed = 310; A[2].projDrop = 5;
      A[4].projSpeed = 120; A[4].projDrop = 1.5;
      G.switchWeapon(KNIFE);
      const inv = G.inventory;
      inv.medkits = 0; inv.nades = 0; inv.meat = 0;
      MP.player.armor = 0;
      MP.player.health = MP.player.maxHealth;
      MP.updateSlotsHUD(); MP.updateAmmoHUD(); MP.updateInvHUD();
      MP.updateHealthHUD(); MP.updateArmorHUD();
    }
    function beginMatch(asSpectator) {
      window.__BR_active = true;
      LOBBY.hide();
      if (!MP.state.started) G.forceStart();
      disableSoloAI();
      if (S.flags && !S.flags.animais) { // regra da sala: sem bichos
        try { for (const a of G.Animals.list) { a.alive = false; if (a.group) a.group.visible = false; } }
        catch (e) { /* módulo ausente: segue */ }
      }
      buildZoneWall();
      buildCrates();
      buildBoss();
      if (!ship) ship = buildShip();
      UI.showHud(true);
      if (asSpectator) {
        enterSpectator();
        MP.centerMsg('Partida em andamento — você entra na próxima!', 3200);
      } else {
        setupLoadout();
        S.phase = 'SHIP';
        S.jumped = false; S.chuteOpen = false;
        window.__BR_freeze = true;
        MP.player.invulnUntil = MP.state.gameTime + 6;
        UI.hint('🛸 NA NAVE — [ESPAÇO] pra pular quando quiser');
      }
      hintLock();
    }
    function hintLock() {
      if (!MP.state.pointerLocked) MP.centerMsg('clique na tela pra capturar o mouse', 2600);
    }
    document.addEventListener('click', e => {
      // autoplay do navegador deixa o AudioContext suspenso até um gesto —
      // sem isto a partida (iniciada via socket, sem clique) ficava MUDA
      try { MP.SFX.init(); MP.SFX.resume(); } catch (err) {}
      if (S.chatOpen || e.target.closest('.brPanel') || e.target.closest('#brChatInput')) return;
      if (window.__BR_active && MP.state.started && !MP.state.paused && !MP.state.pointerLocked) {
        try { document.body.requestPointerLock(); } catch (err) {}
      }
    });

    /* =============== eventos do servidor =============== */
    socket.on('countdown', d => {
      if (S.phase === 'LOBBY' || S.phase === 'COUNTDOWN') { S.phase = 'COUNTDOWN'; LOBBY.countdown(d.n); }
    });
    socket.on('matchStart', d => {
      S.plan = d.plan;
      S.flags = d.plan.flags || { golem: true, animais: true, ciclo: 'auto' };
      S.t0 = d.t0;
      S.clockOffset = d.serverNow - Date.now();
      S.matchNum = d.num;
      S.myKills = 0; S.myPlacement = 0; recapShown = false; myDeathInfo = null;
      bossDeadFlag = !S.flags.golem; // GOLEM desligado pela regra da sala: nem constrói
      window.__BR_zumbis = !!S.flags.zumbis;
      sendCity(d.plan.city ? { ...d.plan.city, state: 'intact' } : null);
      bossHp = bossMaxHp = d.plan.boss.hp;
      beginMatch(false);
    });
    socket.on('roster', d => {
      S.hostId = d.hostId;
      S.aliveCount = d.aliveCount;
      LOBBY.setRoster(d.players);
      const alive = d.players.filter(p => p.alive).sort((a, b) => b.kills - a.kills);
      UI.rosterBox.innerHTML = '<div style="opacity:.6;font-size:9.5px;letter-spacing:2px">VIVOS · KILLS</div>' +
        alive.slice(0, 5).map(p =>
          `<div class="${p.id === INIT.id ? 'me' : ''}">${esc(p.nick)} <b style="float:right">☠${p.kills}</b></div>`).join('');
      for (const p of d.players) { // marca avatares de mortos
        const rp = remotes.get(p.id);
        if (rp) rp.alive = p.alive;
      }
      updateSpectBar();
    });
    socket.on('playerUpdate', d => {
      if (d.id === INIT.id) return;
      if (!Array.isArray(d.pos) || !d.pos.every(Number.isFinite)) return; // NaN quebraria o lerp pra sempre
      let rp = remotes.get(d.id);
      if (!rp) rp = makeRemote(d.id, d.nick, d.colors, d.pos);
      rp.nick = d.nick || rp.nick;
      rp.targetPos.set(d.pos[0], d.pos[1], d.pos[2]);
      rp.targetYaw = d.rotY || 0;
      rp.ship = !!d.ship;
      rp.chute = !!d.chute;
      rp.car = typeof d.car === 'number' ? d.car : -1;
      rp.heli = !!d.heli;
    });
    socket.on('playerLeft', d => removeRemote(d.id));
    socket.on('youWereHit', d => {
      S.lastHit = { shooterId: d.shooterId, shooterNick: d.shooterNick, weapon: d.weapon, t: Date.now() };
      const f = d.fromPos;
      MP.playerDamage(d.dmg, { x: f[0], y: f[1], z: f[2] });
    });
    socket.on('playerKilled', d => {
      const feed = d.byCity
        ? `☄ <b>${esc(d.victimNick)}</b> morreu no ataque de mísseis à cidade`
        : d.byZone
          ? `☣ <b>${esc(d.victimNick)}</b> morreu pro gás`
          : `<b>${esc(d.killerNick || '???')}</b> ▸ ${esc(d.victimNick)} <i style="opacity:.6">${esc(d.weapon)}</i>`;
      MP.addKillFeed(feed);
      if (d.victimId === INIT.id) {
        myDeathInfo = d;
        S.myPlacement = d.placement || S.myPlacement;
        if (d.byCity) { // morto pelo ataque de mísseis: mensagem oficial da vítima
          const ds = document.getElementById('deathSub');
          if (ds) ds.textContent = 'Você morreu atingido pelo ataque de mísseis próximo à cidade!';
        }
        // servidor me eliminou (zona/AFK/mísseis) mas meu cliente ainda me acha vivo:
        // força a morte local, senão viro fantasma jogando numa partida onde já morri
        if (!MP.player.dead && (S.phase === 'PLAY' || S.phase === 'FALL' || S.phase === 'SHIP')) forceDeath = true;
      }
      if (d.killerId === INIT.id) {
        S.myKills = d.killerKills;
        UI.toast(`☠ você eliminou <b>${esc(d.victimNick)}</b>!`, 'épico');
        MP.SFX.kill();
      }
      const rp = remotes.get(d.victimId);
      if (rp) { rp.alive = false; rp.deadT = 0.001; }
      updateSpectBar();
    });
    socket.on('chestOpened', d => markOpened(d.key));
    socket.on('dropSpawn', d => spawnDrop(d.id, d.pos));
    socket.on('dropTaken', d => removeDrop(d.id));
    socket.on('bossHp', d => { bossHp = d.hp; bossMaxHp = d.max; });
    socket.on('bossDead', d => {
      bossHp = 0;
      bossDeadFlag = true;
      if (boss) {
        boss.alive = false;
        const p = boss.group.position;
        MP.FX.burst(p.clone().setY(p.y + 3), new THREE.Vector3(0, 1, 0), 'spark');
        // baú lendário no lugar
        setTimeout(() => {
          const y = MP.heightAt(p.x, p.z);
          const mBox = new THREE.MeshStandardMaterial({ color: 0x5b4630, roughness: 0.7 });
          const mBand = new THREE.MeshStandardMaterial({ color: 0x2a1500, emissive: 0xffb03c, emissiveIntensity: 2.5 });
          const grp = new THREE.Group();
          const base = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 0.8), mBox); base.position.y = 0.35; grp.add(base);
          const lid = new THREE.Mesh(new THREE.BoxGeometry(1.26, 0.26, 0.86), mBox); lid.position.y = 0.78; grp.add(lid);
          const band = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.12, 0.88), mBand); band.position.y = 0.62; grp.add(band);
          grp.position.set(p.x, y, p.z);
          MP.scene.add(grp);
          crates.push({ key: 'boss', g: grp, lid, band, opened: false, x: p.x, z: p.z });
        }, 2200);
      }
      MP.addKillFeed(`⛰ <b>${esc(d.by)}</b> derrotou o GOLEM`);
    });
    socket.on('chat', d => UI.addChat(d.nick, d.msg, d.sys));
    socket.on('matchEnd', d => {
      S.phase = 'ENDED';
      window.__BR_lastGlobalTop = d.globalTop;
      UI.spectBar.style.display = 'none';
      UI.hint('');
      const won = d.winner && d.winner.id === INIT.id;
      // estatísticas pessoais no navegador (espelho do ranking)
      try {
        const st = JSON.parse(localStorage.getItem('br_stats') || '{"wins":0,"kills":0,"matches":0}');
        st.matches++; st.kills += S.myKills; if (won) st.wins++;
        localStorage.setItem('br_stats', JSON.stringify(st));
      } catch (e) {}
      const rows = d.ranking.map(r =>
        `<tr><td>#${r.placement}</td><td>${esc(r.nick)}</td><td>☠ ${r.kills}</td></tr>`).join('');
      LOBBY.overlay(`
        <div class="brTitle" style="${won ? '' : 'color:#e8f1f8'}">${won ? '🏆 VITÓRIA MAGISTRAL!' : '🏆 FIM DE PARTIDA'}</div>
        <div class="brSub">PARTIDA #${S.matchNum}</div>
        <div style="text-align:center;font-size:19px;margin:10px 0">
          vencedor: <b style="color:#ffd76a">${d.winner ? esc(d.winner.nick) : '—'}</b>
          ${d.winner ? `· ${d.winner.kills} kills` : ''}</div>
        <div class="brRow"><div class="brCol">
          <div class="brH">RANKING DA PARTIDA</div>
          <table class="brTable"><tr><th>#</th><th>nick</th><th>kills</th></tr>${rows}</table>
        </div><div class="brCol">
          <div class="brH">🏆 RANKING GLOBAL</div>
          <table class="brTable" id="brGlobalTable"></table>
        </div></div>
        <div style="text-align:center;margin-top:16px;font-size:13px;opacity:.75">
          próxima partida (mapa novo) em <b id="brNextIn">${d.nextIn}</b>s...</div>`);
      LOBBY.renderGlobal(d.globalTop);
      let n = d.nextIn;
      const iv = setInterval(() => {
        n--;
        const el = document.getElementById('brNextIn');
        if (el) el.textContent = n;
        if (n <= 0) clearInterval(iv);
      }, 1000);
    });
    socket.on('nextMatch', () => location.reload());

    /* =============== teclado / chat =============== */
    const chatInput = UI.chatInput;
    function openChat() {
      S.chatOpen = true;
      chatInput.style.display = 'block';
      chatInput.value = '';
      chatInput.focus();
    }
    function closeChat(send) {
      if (send && chatInput.value.trim()) socket.emit('chat', { msg: chatInput.value.trim() });
      S.chatOpen = false;
      chatInput.style.display = 'none';
      chatInput.blur();
    }
    window.addEventListener('keydown', e => { // roda DEPOIS do listener do jogo
      if (S.chatOpen) {
        G.keys[e.code] = false;               // não deixa o jogo andar/atirar digitando
        if (MP.justPressed) MP.justPressed.delete(e.code);
        if (e.code === 'Enter') closeChat(true);
        if (e.code === 'Escape') closeChat(false);
        return;
      }
      if (e.code === 'Enter' && window.__BR_active && MP.state.started) { openChat(); return; }
      if (e.code === 'Space') {
        if (S.phase === 'SHIP') jumpFromShip();
        else if (S.phase === 'FALL' && !S.chuteOpen) { S.chuteOpen = true; UI.hint('🪂 paraquedas aberto', 1800); }
        else if (S.phase === 'SPECT') { spectIdx++; updateSpectBar(); }
      }
      if (e.code === 'KeyE' && S.phase === 'PLAY' && !MP.player.dead && !MP.state.paused) tryOpenCrate();
      if (S.phase === 'PLAY') {
        if (e.code === 'Digit4') G.switchWeapon(3);
        if (e.code === 'Digit5') G.switchWeapon(4);
        if (e.code === 'Digit6') G.switchWeapon(KNIFE);
      }
    });

    /* posse de veículo arbitrada no servidor (mata a corrida do "mesmo carro") */
    let myCarClaim = -1;
    function claimCar(idx) {
      myCarClaim = idx;
      socket.timeout(2500).emit('enterCar', { idx }, (err, res) => {
        if (err || !res || !res.ok) {
          if (G.state.driving && myCarClaim === idx) {
            G.tryToggleCar();
            MP.centerMsg('Veículo ocupado!', 1500);
          }
          myCarClaim = -1;
        }
      });
    }
    socket.on('carTaken', d => { // outro levou o carro que estou tentando usar
      if (d.id !== INIT.id && G.state.driving && myCarClaim === d.idx) {
        G.tryToggleCar();
        MP.centerMsg('Veículo ocupado!', 1500);
        myCarClaim = -1;
      }
    });

    /* =============== envio do meu estado (10x/s) =============== */
    setInterval(() => {
      if (!window.__BR_active || !MP.state.started || MP.state.paused) return;
      if (S.phase === 'SPECT' || S.phase === 'ENDED' || MP.player.dead) return;
      let p = MP.player.pos, rotY, car = -1, heli = false;
      if (G.state.driving) { // dentro de carro: manda a pose do VEÍCULO, não a do boneco
        car = G.Car.vehicles.findIndex(v => v.group === G.Car.group);
        p = G.Car.group.position;
        _eul.setFromQuaternion(G.Car.group.quaternion);
        rotY = _eul.y;
      } else if (G.state.flying) { // no helicóptero: idem (antes o boneco ficava no chão)
        heli = true;
        p = G.Heli.group.position;
        rotY = G.Heli.group.rotation.y;
      } else {
        _eul.setFromQuaternion(MP.camera.quaternion);
        rotY = _eul.y;
      }
      // transições de posse (só em partida; no solo o servidor recusaria)
      if (S.phase === 'PLAY') {
        if (car >= 0 && myCarClaim !== car) claimCar(car);
        else if (car < 0 && myCarClaim >= 0) { socket.emit('leaveCar', { idx: myCarClaim }); myCarClaim = -1; }
      }
      socket.volatile.emit('state', {
        pos: [p.x, p.y, p.z], rotY, car, heli,
        ship: S.phase === 'SHIP', chute: S.phase === 'FALL' && S.chuteOpen,
      });
    }, 100);
    const _eul = new THREE.Euler(0, 0, 0, 'YXZ');

    /* watchdog do pulo automático: roda em setInterval porque o loop de frames
       congela em aba oculta — sem isto o jogador ficava eternamente "na nave" */
    setInterval(() => {
      if (S.phase === 'SHIP' && S.plan && S.matchT() >= S.plan.ship.flyTime) jumpFromShip();
    }, 500);

    /* =============== loop principal do BR =============== */
    const _shipV = new THREE.Vector3();
    let lastT = performance.now(), hudAcc = 0, dmgAcc = 0, promptAcc = 0;
    (function brTick() {
      requestAnimationFrame(brTick);
      const nowMs = performance.now();
      const dt = Math.min((nowMs - lastT) / 1000, 0.1);
      lastT = nowMs;
      if (!window.__BR_active) return;

      /* morte decretada pelo servidor: aplica assim que o jogo deixar */
      if (forceDeath && !MP.player.dead) {
        MP.player.invulnUntil = 0;
        window.__BR_freeze = false;
        MP.playerDamage(99999, null);
        if (MP.player.dead) forceDeath = false;
      }

      /* na nave/queda ninguém pode ser abatido (invulnerabilidade rolante) */
      if ((S.phase === 'SHIP' || S.phase === 'FALL') && !MP.player.dead && !forceDeath)
        MP.player.invulnUntil = MP.state.gameTime + 1;

      /* avatares: interpolação + animação de corrida + paraquedas + morte */
      const k = 1 - Math.exp(-12 * dt);
      window.__BR_takenCars.clear(); // carros ocupados por remotos (bloqueia tecla E neles)
      window.__BR_heliTaken = false;
      for (const rp of remotes.values()) {
        if (rp.alive && rp.car >= 0) window.__BR_takenCars.add(rp.car);
        if (rp.alive && rp.heli) window.__BR_heliTaken = true;
        if (rp.deadT > 0 && rp.deadT < 1.2) { // tombando
          rp.deadT += dt;
          rp.group.rotation.x = Math.min(rp.deadT * 2, Math.PI / 2);
          if (rp.deadT >= 1.2) rp.group.visible = false;
          continue;
        }
        // visível também na nave (todo mundo viaja no convés); some dentro de carro/heli
        rp.group.visible = rp.alive && rp.car < 0 && !rp.heli;
        rp.group.position.lerp(rp.targetPos, k);
        let dy = rp.targetYaw - rp.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        rp.yaw += dy * k;
        rp.group.rotation.y = rp.yaw;
        rp.speed = rp.lastPos.distanceTo(rp.group.position) / Math.max(dt, 0.001);
        rp.lastPos.copy(rp.group.position);
        rp.walkPh += dt * Math.min(rp.speed, 9) * 1.6;
        const sw = Math.sin(rp.walkPh) * Math.min(rp.speed / 5, 1) * 0.7;
        rp.body.legL.rotation.x = sw;
        rp.body.legR.rotation.x = -sw;
        rp.body.armL.rotation.x = -sw * 0.8;
        rp.body.armR.rotation.x = sw * 0.8;
        rp.body.chute.visible = rp.chute;
        if (rp.hitT > 0) {
          rp.hitT -= dt;
          for (const m of rp.body.mats) { m.emissive.setHex(0xff2222); m.emissiveIntensity = Math.max(0, rp.hitT * 3); }
        }
        // dirigindo: o carro correspondente segue o jogador remoto (antes ficava
        // um boneco flutuando e o carro parado no estacionamento)
        if (rp.car >= 0) {
          const v = G.Car.vehicles[rp.car];
          if (v && !(G.state.driving && v.group === G.Car.group)) {
            v.chassisBody.position.set(rp.group.position.x, rp.group.position.y, rp.group.position.z);
            v.chassisBody.velocity.set(0, 0, 0);
            v.chassisBody.angularVelocity.set(0, 0, 0);
            v.chassisBody.quaternion.setFromAxisAngle(_yAxis, rp.yaw);
          }
        }
        // voando: o helicóptero (único no mapa) segue o piloto remoto
        if (rp.heli && !G.state.flying) {
          G.Heli.group.position.copy(rp.group.position);
          G.Heli.group.rotation.set(0, rp.yaw, 0);
        }
      }

      /* corpo a corpo: não dá pra atravessar outro jogador vivo */
      if (S.phase === 'PLAY' && !MP.player.dead && !window.__BR_freeze) {
        const P = MP.player.pos;
        for (const rp of remotes.values()) {
          if (!rp.alive || rp.car >= 0) continue;
          const g = rp.group.position;
          if (Math.abs(P.y - g.y) > 2.2) continue;
          const dx = P.x - g.x, dz = P.z - g.z;
          const d = Math.hypot(dx, dz), min = 0.8;
          if (d < min && d > 1e-4) { P.x = g.x + dx / d * min; P.z = g.z + dz / d * min; }
        }
      }

      stepBullets(dt);
      skySync(dt);

      /* nave */
      if (ship && S.plan) {
        const tm = S.matchT();
        const kk = shipPos(_shipV, tm);
        ship.g.position.copy(_shipV);
        ship.g.visible = kk < 1.15;
        ship.ring.rotation.z += dt * 0.8;
        const sp = S.plan.ship;
        ship.g.rotation.y = Math.atan2(sp.to[0] - sp.from[0], sp.to[1] - sp.from[1]);
        if (S.phase === 'SHIP') {
          // DENTRO da cabine: pés no piso interno, todo mundo ao redor da janela
          MP.player.pos.set(_shipV.x + seatOx, _shipV.y - 0.95, _shipV.z + seatOz);
          MP.player.vel.set(0, 0, 0);
          if (tm >= sp.flyTime) jumpFromShip(); // fim da rota: todo mundo pula
          UI.hint(`🛸 NA NAVE — [ESPAÇO] pra pular · auto em ${Math.max(0, sp.flyTime - tm).toFixed(0)}s`);
        }
      }
      if (S.phase === 'FALL') fallStep(dt);
      if (S.phase === 'SPECT') {
        spectStep();
        MP.weaponRoot.visible = false;
      }

      /* zona */
      if (S.plan && (S.phase === 'PLAY' || S.phase === 'FALL' || S.phase === 'SHIP' || S.phase === 'SPECT')) {
        updateZone();
        if (zoneWall) {
          zoneWall.position.x = zc.x; zoneWall.position.z = zc.z;
          zoneWall.scale.set(zc.r, 1, zc.r);
          zoneWall.material.color.setHex(zc.shrinking ? 0xff7043 : 0x37e0ff);
          zoneWall.material.opacity = zc.shrinking ? 0.2 : 0.13;
        }
        dmgAcc += dt;
        if (dmgAcc > 0.5) {
          dmgAcc = 0;
          const P = MP.player.pos;
          const dz = Math.hypot(P.x - zc.x, P.z - zc.z);
          const fora = S.phase === 'PLAY' && !MP.player.dead && dz > zc.r && !MP.state.cinematic;
          UI.gasTint.style.opacity = fora ? '1' : '0'; // tela avermelha FORA da safe
          if (fora)
            MP.playerDamage(zc.dps * 0.5, null); // se alguém me feriu há pouco, a kill ainda é dele
        }
      }

      bossStep(dt);

      /* drops girando + coleta por proximidade */
      for (const [id, dr] of drops) {
        dr.box.rotation.y += dt * 2;
        if (S.phase === 'PLAY' && !MP.player.dead &&
            dr.g.position.distanceToSquared(MP.player.pos) < 2.2 * 2.2) {
          drops.delete(id); // otimista; servidor decide
          socket.timeout(2000).emit('takeDrop', { id }, (err, res) => {
            if (!err && res && res.ok) applyItems(res.items, 'loot recuperado');
          });
          MP.scene.remove(dr.g);
        }
      }

      /* prompt de baú + HUD (com folga, não a cada frame) */
      promptAcc += dt;
      if (promptAcc > 0.15) {
        promptAcc = 0;
        if (S.phase === 'PLAY' && !MP.player.dead) {
          const c = nearestCrate();
          if (c) UI.hint('<b style="color:#ffd76a">E</b> — ABRIR BAÚ');
          else if (UI.hintBox.innerHTML.includes('ABRIR BAÚ')) UI.hint('');
        }
      }
      hudAcc += dt;
      if (hudAcc > 0.25) {
        hudAcc = 0;
        UI.pillAlive.innerHTML = `👥 <b>${S.aliveCount}</b> vivos · ☠ <b>${S.myKills}</b>`;
        UI.pillZone.textContent = zc.label || '—';
        UI.pillZone.className = 'pill' + (zc.shrinking ? ' warn' : '');
        drawZoneMap();
      }
    })();

    /* =============== estado inicial (conforme a fase do servidor) =============== */
    function require2() {} // (âncora de organização; nada a fazer)

    for (const p of INIT.players || []) if (p.pos && p.alive) makeRemote(p.id, p.nick, p.colors, p.pos);

    /* hook de depuração/testes (inofensivo em produção) */
    window.__BR_debug = {
      S, zc, crates, remotes, drops,
      get ship() { return ship; },
      jump: jumpFromShip, spect: enterSpectator, openCrate: tryOpenCrate,
      get boss() { return boss; }, get bossHp() { return bossHp; },
      get bullets() { return bullets.length; },
    };

    if (INIT.phase === 'PLAYING') {
      beginMatch(true); // entrou no meio: espectador até a próxima
    } else if (INIT.phase === 'ENDED') {
      window.__BR_active = true;
      LOBBY.overlay(`<div class="brTitle">⏳ PARTIDA ACABANDO</div>
        <div style="text-align:center;margin-top:12px;opacity:.8">a próxima começa em instantes...</div>`);
    } else {
      LOBBY.show();
    }
  }

  window.__BR_game = { start };
})();
