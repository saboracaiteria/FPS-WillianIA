/* ================================================================
   DESTRUIÇÃO DA CIDADE — cliente (timeline cinematográfica, câmera,
   mísseis, efeitos e troca do mundo). Fonte de verdade: timestamps
   ABSOLUTOS do servidor (sync) + relógio compensado por latência.
   Interface mínima pro resto do jogo:
     window.__CityDestruction = { sync(cd), tick(dt), active }
   O core só conhece state.cinematic e chama tick(dt) uma vez por frame.
   Plano: docs/plans/city-destruction-event.md
   ================================================================ */
(function () {
  'use strict';

  const poll = setInterval(() => {
    if (!window.__MP || !window.__game || !window.CityDestructionProtocol) return;
    clearInterval(poll);
    boot(window.__MP, window.__game, window.CityDestructionProtocol);
  }, 150);

  function boot(MP, G, P) {
    const THREE = MP.THREE;
    const PH = P.PHASES;
    const CITY = P.CITY_CENTER;
    const lerp = (a, b, t) => a + (b - a) * t;
    const ease = t => t * t * (3 - 2 * t); // smoothstep
    const clamp01 = t => Math.max(0, Math.min(1, t));

    let cd = null;            // estado oficial do evento
    let done = null;          // eventId já concluído neste cliente
    let running = false;
    let ev = null;            // buildCityEvent(seed, quality)
    let rig = null;           // câmera salva pra devolver
    let grp = null;           // grupo dos mísseis/ogivas
    let missiles = [];        // { m, from, to }
    let warheads = [];        // { m, from, to }
    let impactApplied = false;
    let impactTimer = null;
    let boom = null;          // explosão do impacto (fireballs/anéis/luz)
    let trailAcc = 0, smokeAcc = 0, shakeT = 0;
    let releasePlayed = false;

    const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _look = new THREE.Vector3();

    /* relógio: offset do servidor (com meia-RTT) vem do estado multiplayer;
       no solo o offset é 0 e os timestamps são locais */
    const clockNow = () => {
      const S = window.__BR_debug && window.__BR_debug.S;
      return Date.now() + (S ? (S.clockOffset || 0) + (S.halfRtt || 0) : 0);
    };
    const qualityName = () => {
      const r = MP.renderer.getPixelRatio();
      return r >= 2 ? 'high' : r >= 1.5 ? 'medium' : 'low';
    };

    /* ---------- clarão de tela (barato e sincronizado) ---------- */
    const flash = document.createElement('div');
    flash.style.cssText = 'position:fixed;inset:0;background:#fff;opacity:0;' +
      'pointer-events:none;z-index:60;transition:opacity .12s';
    document.body.appendChild(flash);

    /* ---------- assinatura "By RenatoDReis" (CanvasTexture no casco) ---------- */
    function signatureTexture() {
      const cv = document.createElement('canvas');
      cv.width = 512; cv.height = 128;
      const c2 = cv.getContext('2d');
      c2.fillStyle = '#232830'; c2.fillRect(0, 0, 512, 128);
      c2.strokeStyle = '#4a5260'; c2.lineWidth = 6; c2.strokeRect(5, 5, 502, 118);
      c2.font = 'bold 56px system-ui, sans-serif';
      c2.textAlign = 'center'; c2.textBaseline = 'middle';
      c2.fillStyle = '#ffd76a';
      c2.fillText('By RenatoDReis', 256, 66);
      return new THREE.CanvasTexture(cv);
    }

    /* ---------- construção dos mísseis (por evento, descartados no fim) ---------- */
    const mBody = new THREE.MeshStandardMaterial({ color: 0x8a919c, metalness: 0.7, roughness: 0.35 });
    const mNose = new THREE.MeshStandardMaterial({ color: 0xc23b2e, roughness: 0.5 });
    const mFlame = new THREE.MeshBasicMaterial({ color: 0xffb03c, transparent: true, opacity: 0.9 });
    const mWarhead = new THREE.MeshStandardMaterial({ color: 0x2a2f38, metalness: 0.6, roughness: 0.4,
      emissive: 0xff5a1e, emissiveIntensity: 0.6 });

    function buildMissile(signed) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 6.2, 10), mBody);
      body.rotation.x = Math.PI / 2; g.add(body);
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.6, 10), mNose);
      nose.rotation.x = Math.PI / 2; nose.position.z = 3.8; g.add(nose);
      for (let i = 0; i < 4; i++) { // aletas
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.1, 1.2), mBody);
        const a = i * Math.PI / 2;
        fin.position.set(Math.cos(a) * 0.6, Math.sin(a) * 0.6, -2.6);
        fin.rotation.z = a;
        g.add(fin);
      }
      const flame2 = new THREE.Mesh(new THREE.ConeGeometry(0.42, 2.2, 8), mFlame);
      flame2.rotation.x = -Math.PI / 2; flame2.position.z = -4.2; g.add(flame2);
      if (signed) {
        // inscrição presa ao casco: 2 placas (uma por lado), texto legível dos dois
        const tex = signatureTexture();
        const plate = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.1),
          new THREE.MeshBasicMaterial({ map: tex }));
        plate.position.set(0.62, 0, 0.4);
        plate.rotation.y = Math.PI / 2;
        g.add(plate);
        const plate2 = plate.clone();
        plate2.position.x = -0.62;
        plate2.rotation.y = -Math.PI / 2;
        g.add(plate2);
        g.userData.signed = true;
      }
      return g;
    }

    function buildEventMeshes() {
      grp = new THREE.Group();
      grp.name = 'cityMissiles';
      missiles = [];
      warheads = [];
      ev.missiles.forEach((sp, i) => {
        const m = buildMissile(i === ev.signedIndex);
        const from = new THREE.Vector3(sp.from.x, sp.from.y, sp.from.z);
        // mergulho termina num ponto ~36m acima do alvo (as ogivas fecham o resto)
        const to = new THREE.Vector3(sp.to.x, 36 + MP.heightAt(sp.to.x, sp.to.z), sp.to.z);
        m.position.copy(from);
        m.lookAt(to);
        grp.add(m);
        missiles.push({ m, from, to, delay: sp.delay });
      });
      for (const w2 of ev.warheads) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), mWarhead);
        m.visible = false;
        grp.add(m);
        warheads.push({ m, from: new THREE.Vector3(), to: new THREE.Vector3(w2.x, MP.heightAt(w2.x, w2.z) + 0.5, w2.z) });
      }
      MP.scene.add(grp);
    }
    function disposeEventMeshes() {
      if (!grp) return;
      MP.scene.remove(grp);
      grp.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
        for (const m of mats) { if (m.map) m.map.dispose(); if (m !== mBody && m !== mNose && m !== mFlame && m !== mWarhead) m.dispose(); }
      });
      grp = null; missiles = []; warheads = [];
    }

    /* ---------- começo/fim da cinemática ---------- */
    function startCinematic() {
      running = true;
      impactApplied = G.Structures.city.getState() === 'destroyed';
      releasePlayed = false;
      MP.state.cinematic = true;
      G.mouse.shooting = G.mouse.clicked = G.mouse.aiming = false;
      rig = { pos: MP.camera.position.clone(), quat: MP.camera.quaternion.clone(), fov: MP.camera.fov,
        vis: MP.camera.children.map(c => c.visible) };
      MP.camera.children.forEach(c => { c.visible = false; }); // arma/viewmodel fora da cena
      ev = P.buildCityEvent(cd.seed, qualityName());
      buildEventMeshes();
      MP.centerMsg('⚠ MÍSSEIS SE APROXIMANDO DA CIDADE', 3000);
      try { MP.SFX.init(); MP.SFX.missileIncoming(); } catch (e) { /* áudio bloqueado */ }
      // rede de segurança: se o rAF estiver lento (máquina fraca / aba de fundo),
      // a cidade ainda troca NO HORÁRIO — timer absoluto até o impacto
      clearTimeout(impactTimer);
      impactTimer = setTimeout(() => {
        if (running && !impactApplied) applyImpact();
      }, Math.max(0, cd.impactAt - clockNow()));
    }
    function endCinematic() {
      running = false;
      done = cd.eventId;
      clearTimeout(impactTimer);
      disposeBoom();
      disposeEventMeshes();
      MP.state.cinematic = false;
      MP.camera.fov = rig ? rig.fov : 75;
      MP.camera.updateProjectionMatrix();
      if (rig && rig.vis) MP.camera.children.forEach((c, i) => { c.visible = rig.vis[i] !== false; });
      if (rig && !MP.player.dead) { // sobrevivente: câmera exatamente onde estava
        MP.camera.position.copy(rig.pos);
        MP.camera.quaternion.copy(rig.quat);
      }
      // dirigindo/voando/espectador: as câmeras do jogo reassumem no próximo tick
      rig = null;
    }
    function applyImpact() {
      impactApplied = true;
      G.Structures.city.destroy();
      flash.style.opacity = '0.95';
      setTimeout(() => { flash.style.opacity = '0'; }, 160);
      shakeT = 1.4;
      try { MP.SFX.cityImpact(); setTimeout(() => { try { MP.SFX.distantRumble(); } catch (e) {} }, 1300); } catch (e) {}
      // EXPLOSÃO: bola de fogo + anel de choque por ponto de impacto + clarão
      // na cidade — animados por relógio no tickCinematic (boomFx)
      boom = new THREE.Group();
      boom.name = 'cityBoom';
      for (const p2 of ev.impacts) {
        const gy = MP.heightAt(p2.x, p2.z);
        const fb = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8),
          new THREE.MeshBasicMaterial({ color: 0xffa03a, transparent: true, opacity: 0.95 }));
        fb.position.set(p2.x, gy + 4, p2.z);
        fb.userData.boom = 'fogo';
        boom.add(fb);
        const anel = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.35, 28),
          new THREE.MeshBasicMaterial({ color: 0xffd2a0, transparent: true, opacity: 0.8,
            side: THREE.DoubleSide, depthWrite: false }));
        anel.rotation.x = -Math.PI / 2;
        anel.position.set(p2.x, gy + 0.5, p2.z);
        anel.userData.boom = 'anel';
        boom.add(anel);
        _v.set(p2.x, gy + 1.5, p2.z);
        MP.FX.burst(_v, _w.set(0, 1, 0), 'spark');
        MP.FX.burst(_v, _w.set(0, 1, 0), 'dirt');
      }
      const luz = new THREE.PointLight(0xff8a3c, 7, 320, 1.4);
      luz.position.set(CITY.x, MP.heightAt(CITY.x, CITY.z) + 18, CITY.z);
      luz.userData.boom = 'luz';
      boom.add(luz);
      MP.scene.add(boom);
    }
    function tickBoom(el) {
      if (!boom) return;
      const bt = el - PH.impact; // segundos desde o impacto (relógio, não fps)
      if (bt > 2.2) { disposeBoom(); return; }
      for (const o of boom.children) {
        if (o.userData.boom === 'fogo') {
          const k = clamp01(bt / 0.9);
          o.scale.setScalar(2 + 30 * ease(k));
          o.material.opacity = 0.95 * (1 - k);
          o.visible = k < 1;
        } else if (o.userData.boom === 'anel') {
          const k = clamp01(bt / 1.3);
          o.scale.setScalar(1 + 44 * ease(k));
          o.material.opacity = 0.8 * (1 - k);
          o.visible = k < 1;
        } else if (o.userData.boom === 'luz') {
          o.intensity = 7 * Math.max(0, 1 - bt / 1.8);
        }
      }
    }
    function disposeBoom() {
      if (!boom) return;
      MP.scene.remove(boom);
      boom.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      boom = null;
    }

    /* ---------- timeline por frame ---------- */
    function tickCinematic(dt) {
      const el = (clockNow() - cd.cinematicStartedAt) / 1000;
      if (el >= PH.impact && !impactApplied) applyImpact();
      if (el >= PH.aftermath[1]) { endCinematic(); return; }
      tickBoom(el);

      /* mísseis: chegam ao ponto de mergulho exatamente no impacto */
      const mt = ease(clamp01(el / PH.impact));
      for (const ms of missiles) {
        const k = clamp01(mt * 1.06 - ms.delay * 0.04); // defasagem visual leve
        ms.m.position.lerpVectors(ms.from, ms.to, k);
        ms.m.position.y += Math.sin(k * Math.PI) * 26; // arco balístico
        _look.lerpVectors(ms.from, ms.to, Math.min(1, k + 0.02));
        _look.y += Math.sin(Math.min(1, k + 0.02) * Math.PI) * 26;
        ms.m.lookAt(_look);
        ms.m.visible = el < PH.impact;
      }
      // trilhas de fumaça (limitadas)
      trailAcc += dt;
      if (trailAcc > 0.08 && el < PH.impact) {
        trailAcc = 0;
        for (let i = 0; i < Math.min(missiles.length, 8); i++) {
          const ms = missiles[i];
          MP.FX.spawnParticle(ms.m.position, _w.set(0, 0.4, 0), 0xcfd6df, 0.5, 0.9, -0.2);
        }
      }
      /* ogivas: fase MIRV */
      if (el >= PH.mirv[0]) {
        if (!releasePlayed) { releasePlayed = true; try { MP.SFX.warheadRelease(); } catch (e) {} }
        const wt = ease(clamp01((el - PH.mirv[0]) / (PH.impact - PH.mirv[0])));
        warheads.forEach((wh, i) => {
          const src = missiles[i % missiles.length];
          if (!wh.m.visible) { wh.from.copy(src.m.position); wh.m.visible = true; }
          wh.m.position.lerpVectors(wh.from, wh.to, wt);
          wh.m.visible = el < PH.impact;
        });
      }

      /* câmera cinematográfica (nunca chama controls.unlock) */
      const cam = MP.camera;
      const head = _w.set(MP.player.pos.x, MP.player.pos.y + 1.62, MP.player.pos.z);
      let fov = 75;
      if (el < PH.skyPan[1]) {                      // 0–3: sobe pro céu
        const k = ease(clamp01((el - PH.skyPan[0]) / (PH.skyPan[1] - PH.skyPan[0])));
        _v.set(head.x, head.y + 55 * k, head.z + 8 * k);
        cam.position.lerp(_v, Math.min(1, 6 * dt + k * 0.2));
        _look.set(CITY.x, 220, CITY.z);
        cam.lookAt(_look);
      } else if (el < PH.missileClose[1]) {         // 3–5,5: close no assinado
        const s = missiles[ev.signedIndex] || missiles[0];
        _v.copy(s.m.position).add(_look.set(6, 2.2, -4));
        cam.position.lerp(_v, Math.min(1, 8 * dt));
        cam.lookAt(s.m.position);
        fov = 52;
      } else if (el < PH.mirv[1]) {                 // 5,5–8,5: plano aberto + mirv
        const k = clamp01((el - PH.wide[0]) / (PH.impact - PH.wide[0]));
        _v.set(CITY.x + 120 - k * 25, 150 - k * 30, CITY.z + 160 - k * 30);
        cam.position.lerp(_v, Math.min(1, 5 * dt));
        _look.set(CITY.x, MP.heightAt(CITY.x, CITY.z) + 12, CITY.z);
        cam.lookAt(_look);
        fov = 66;
      } else {                                      // 8,5–12: pós-impacto e retorno
        const k = ease(clamp01((el - 9.6) / (PH.aftermath[1] - 9.6)));
        if (rig && !MP.player.dead && k > 0) {
          cam.position.lerpVectors(_v.set(CITY.x + 95, 120, CITY.z + 130), rig.pos, k);
          if (k > 0.85) cam.quaternion.slerp(rig.quat, (k - 0.85) / 0.15);
          else { _look.set(CITY.x, MP.heightAt(CITY.x, CITY.z) + 10, CITY.z); cam.lookAt(_look); }
        } else {
          _v.set(CITY.x + 95, 120, CITY.z + 130);
          cam.position.lerp(_v, Math.min(1, 4 * dt));
          _look.set(CITY.x, MP.heightAt(CITY.x, CITY.z) + 10, CITY.z);
          cam.lookAt(_look);
        }
        // fumaça densa diminuindo
        smokeAcc += dt;
        const rate = lerp(0.05, 0.3, k);
        if (smokeAcc > rate) {
          smokeAcc = 0;
          const p2 = ev.impacts[(Math.random() * ev.impacts.length) | 0];
          _v.set(p2.x, MP.heightAt(p2.x, p2.z) + 2, p2.z);
          MP.FX.spawnParticle(_v, _look.set((Math.random() - 0.5) * 2, 3 + Math.random() * 2, (Math.random() - 0.5) * 2),
            0x3a3632, 1.6, 2.4, -1.2);
        }
      }
      /* tremor pós-impacto */
      if (shakeT > 0) {
        shakeT -= dt;
        const a = shakeT * 0.5;
        cam.position.x += (Math.random() - 0.5) * a;
        cam.position.y += (Math.random() - 0.5) * a;
        cam.position.z += (Math.random() - 0.5) * a;
      }
      if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
    }

    /* ---------- API pública ---------- */
    window.__CityDestruction = {
      get active() { return running; },
      sync(next) {
        if (!next || !next.eventId) { cd = null; return; }
        cd = { ...(cd || {}), ...next };
        // confirmação/estado final vindos do servidor (late join, reconexão)
        if (cd.state === 'destroyed' && !running && done !== cd.eventId) {
          if (clockNow() >= (cd.impactAt || 0) + 3500) { // janela da cinemática já era
            if (G.Structures.city.getState() !== 'destroyed') G.Structures.city.destroy();
            done = cd.eventId;
          }
        }
      },
      tick(dt) {
        if (!cd || !cd.eventId || done === cd.eventId) return;
        if (!MP.state.started) return;
        if (running) { tickCinematic(dt); return; }
        const now = clockNow();
        if (now >= cd.cinematicStartedAt && now < cd.impactAt + 3500) {
          startCinematic();
          tickCinematic(dt); // já dentro da janela: aplica câmera/impacto neste frame
        } else if (now >= cd.impactAt + 3500) { // entrou tarde demais: só o estado final
          if (G.Structures.city.getState() !== 'destroyed') G.Structures.city.destroy();
          done = cd.eventId;
        }
      },
    };

    /* ---------- MODO SOLO: evento local, sem depender de servidor ---------- */
    if (!MP.socket) {
      const soloPoll = setInterval(() => {
        if (!MP.state.started) return;
        clearInterval(soloPoll);
        if (cd) return; // já existe evento sincronizado — não atropela
        const t0 = Date.now();
        window.__CityDestruction.sync({
          eventId: 'solo-' + t0,
          seed: (Math.random() * 0xFFFFFFFF) >>> 0,
          state: 'intact',
          cinematicStartedAt: t0 + P.DELAY_DEFAULT,
          impactAt: t0 + P.DELAY_DEFAULT + P.IMPACT_DELAY_DEFAULT,
        });
      }, 500);
    }
  }
})();
