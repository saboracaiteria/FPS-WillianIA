/* ================================================================
   Modos competitivos: 1v1 e Mata-Mata.
   O servidor e a fonte de verdade para vida, kills, placar e respawn.
   Este modulo cuida apenas da apresentacao, movimento e candidatos a hit.
   ================================================================ */
(function () {
  'use strict';

  function start(ctx) {
    const { MP, G, INIT, socket, UI, LOBBY, esc, remoteCharacter } = ctx;
    if (window.__ARENA_active) return;
    if (window.__BR_debug && !window.__BR_debug.disposed)
      window.__BR_debug.teardown({ keepSocket: true });

    const THREE = MP.THREE;
    const remotes = new Map();
    const intervals = [];
    const MAPS = {
      CAMP: { center: [0, 0], radius: 105 },
      CITY: { center: [-338, 132], radius: 115 },
      WILDERNESS: { center: [205, -175], radius: 115 },
    };
    let room = ctx.room;
    let active = true;
    let frameId = 0;
    let remaining = room.remaining || room.timeLimit * 60;
    let serverDead = false;
    let serverHealth = 100;
    let suicideSent = false;
    let boundary = null;
    let resultData = null;

    window.__ARENA_active = true;
    window.__BR_active = true; // reaproveita a trava que desliga a IA solo
    window.__BR_zumbis = false;
    window.__MP_active = true;
    window.__MP_remotePlayers = [];

    function el(id) { return document.getElementById(id); }
    function padTime(seconds) {
      const value = Math.max(0, Math.ceil(seconds || 0));
      return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
    }

    function installStyle() {
      if (el('arenaGameStyle')) return;
      const style = document.createElement('style');
      style.id = 'arenaGameStyle';
      style.textContent = `
        #arenaHud { position:fixed;left:50%;top:13px;transform:translateX(-50%);z-index:70;display:flex;gap:8px;
          color:#edf7ff;font:700 12px system-ui,sans-serif;pointer-events:none; }
        #arenaHud .arenaPill { min-width:110px;padding:7px 14px;border:1px solid rgba(116,210,255,.3);border-radius:20px;
          background:rgba(5,12,20,.72);backdrop-filter:blur(7px);text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.25); }
        #arenaHud b { color:#ffd76a; }
        #arenaScoreboard { position:fixed;right:14px;top:58px;z-index:70;width:210px;padding:10px;border-radius:10px;
          border:1px solid rgba(255,255,255,.12);background:rgba(5,12,20,.72);backdrop-filter:blur(7px);
          color:#e8f3fb;font:11px system-ui,sans-serif;pointer-events:none; }
        #arenaScoreboard .arenaScoreTitle { font-size:9px;letter-spacing:2px;opacity:.62;margin-bottom:6px; }
        #arenaScoreboard .arenaScoreRow { display:grid;grid-template-columns:1fr auto auto;gap:9px;padding:4px 5px;border-radius:5px; }
        #arenaScoreboard .arenaScoreRow.me { background:rgba(79,190,255,.13);color:#8fdcff; }
        #arenaScoreboard .arenaScoreRow.dead { opacity:.42; }
        #arenaScoreboard strong { color:#ffd76a;font-size:13px; }
        #arenaFeed { position:fixed;right:20px;bottom:170px;z-index:72;display:flex;flex-direction:column;align-items:flex-end;
          gap:5px;color:#fff;font:600 12px system-ui,sans-serif;pointer-events:none; }
        #arenaFeed div { padding:6px 10px;border-radius:6px;background:rgba(5,12,20,.72);border-left:2px solid #ff6d5f;
          animation:arenaFeedFade 5s forwards; }
        #arenaSpawnNotice { position:fixed;left:50%;top:27%;transform:translateX(-50%);z-index:74;padding:9px 18px;
          border-radius:8px;background:rgba(5,12,20,.75);color:#fff;font:700 14px system-ui,sans-serif;letter-spacing:1px;
          opacity:0;transition:opacity .2s;pointer-events:none; }
        #arenaResult { position:fixed;inset:0;z-index:390;display:none;align-items:center;justify-content:center;
          background:radial-gradient(circle at 50% 25%,rgba(31,68,91,.4),rgba(3,7,12,.94));backdrop-filter:blur(8px);
          color:#eaf5ff;font-family:system-ui,sans-serif; }
        #arenaResult .resultCard { width:min(580px,calc(100vw - 32px));max-height:90vh;overflow:auto;padding:28px;border-radius:16px;
          border:1px solid rgba(120,211,255,.25);background:linear-gradient(155deg,rgba(19,31,44,.98),rgba(8,14,22,.98));
          box-shadow:0 30px 90px rgba(0,0,0,.5); }
        #arenaResult h1 { margin:0;text-align:center;color:#ffd76a;font-size:28px;letter-spacing:5px; }
        #arenaResult .resultSub { text-align:center;opacity:.62;letter-spacing:2px;font-size:10px;margin:6px 0 18px; }
        #arenaResult table { width:100%;border-collapse:collapse;font-size:13px; }
        #arenaResult th,#arenaResult td { padding:8px;border-bottom:1px solid rgba(255,255,255,.08);text-align:left; }
        #arenaResult th { opacity:.55;font-size:9px;letter-spacing:2px; }
        #arenaResult .resultActions { display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:18px; }
        #arenaResult button { padding:12px;border:0;border-radius:8px;background:#ffd76a;color:#181208;font-weight:900;cursor:pointer; }
        #arenaResult button.secondary { background:#263747;color:#e6f4ff; }
        #arenaResult button:disabled { opacity:.35;cursor:default; }
        @keyframes arenaFeedFade { 0%,75%{opacity:1}100%{opacity:0} }
        @media(max-width:620px){#arenaScoreboard{top:auto;bottom:126px;right:7px;width:170px}#arenaHud{width:96%;justify-content:center}
          #arenaHud .arenaPill{min-width:0;padding:7px 9px;font-size:10px}#arenaResult .resultActions{grid-template-columns:1fr}}
      `;
      document.head.appendChild(style);
    }

    function installHud() {
      installStyle();
      const hud = document.createElement('div');
      hud.id = 'arenaHud';
      hud.innerHTML = '<div class="arenaPill" id="arenaModePill"></div><div class="arenaPill" id="arenaTimePill"></div><div class="arenaPill" id="arenaLimitPill"></div>';
      document.body.appendChild(hud);
      const board = document.createElement('div'); board.id = 'arenaScoreboard'; document.body.appendChild(board);
      const feed = document.createElement('div'); feed.id = 'arenaFeed'; document.body.appendChild(feed);
      const notice = document.createElement('div'); notice.id = 'arenaSpawnNotice'; document.body.appendChild(notice);
      const result = document.createElement('div'); result.id = 'arenaResult'; document.body.appendChild(result);
    }

    function feed(message) {
      const box = el('arenaFeed');
      if (!box) return;
      const item = document.createElement('div');
      item.innerHTML = message;
      box.appendChild(item);
      setTimeout(() => item.remove(), 5200);
      while (box.children.length > 5) box.firstChild.remove();
    }

    function notice(message, ms) {
      const box = el('arenaSpawnNotice');
      if (!box) return;
      box.textContent = message || '';
      box.style.opacity = message ? '1' : '0';
      if (message && ms) setTimeout(() => { if (box.textContent === message) box.style.opacity = '0'; }, ms);
    }

    function updateHud() {
      const mode = el('arenaModePill'), time = el('arenaTimePill'), limit = el('arenaLimitPill');
      if (mode) mode.innerHTML = room.mode === 'DUEL' ? '<b>1v1</b> DUELO' : '<b>MATA-MATA</b>';
      if (time) time.innerHTML = `TEMPO <b>${padTime(remaining)}</b>`;
      if (limit) limit.innerHTML = `META <b>${room.scoreLimit}</b> KILLS`;
      const board = el('arenaScoreboard');
      if (!board) return;
      const sorted = (room.players || []).slice().sort((a, b) => b.score - a.score || a.deaths - b.deaths);
      board.innerHTML = `<div class="arenaScoreTitle">${esc(room.name)} &middot; ${esc(room.id)}</div>` + sorted.map(player =>
        `<div class="arenaScoreRow ${player.id === INIT.id ? 'me' : ''} ${player.alive ? '' : 'dead'}"><span>${esc(player.nick)}</span><strong>${player.score}</strong><span>D ${player.deaths}</span></div>`).join('');
    }

    function nickSprite(name) {
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 64;
      const c = canvas.getContext('2d');
      c.font = 'bold 30px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.shadowColor = '#000'; c.shadowBlur = 8; c.fillStyle = '#fff'; c.fillText(String(name).slice(0, 14), 128, 32);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false }));
      sprite.position.y = 2.35; sprite.scale.set(2.6, 0.65, 1); return sprite;
    }

    function fallbackBody(colors) {
      const palette = (colors || ['#4da6ff', '#26384c', '#8a5a2b', '#ffd76a']).map(color => new THREE.Color(color));
      const mats = palette.map((color, i) => new THREE.MeshStandardMaterial({ color, roughness: i === 3 ? 0.35 : 0.72,
        emissive: i === 3 ? color : 0x000000, emissiveIntensity: i === 3 ? 0.55 : 0 }));
      const root = new THREE.Group(), visual = new THREE.Group(); root.add(visual);
      const box = (w, h, d, x, y, z, mat, parent) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[mat]);
        mesh.position.set(x, y, z); (parent || visual).add(mesh); return mesh;
      };
      const legL = new THREE.Group(), legR = new THREE.Group();
      legL.position.set(-.15, .78, 0); legR.position.set(.15, .78, 0);
      box(.22, .78, .26, 0, -.39, 0, 1, legL); box(.22, .78, .26, 0, -.39, 0, 1, legR);
      visual.add(legL, legR);
      box(.56, .64, .34, 0, 1.1, 0, 0); box(.42, .4, .4, 0, 1.67, 0, 0);
      box(.31, .1, .06, 0, 1.72, -.22, 3);
      const armL = new THREE.Group(), armR = new THREE.Group();
      armL.position.set(-.38, 1.38, 0); armR.position.set(.38, 1.38, 0);
      box(.16, .62, .2, 0, -.27, 0, 0, armL); box(.16, .62, .2, 0, -.27, 0, 0, armR);
      visual.add(armL, armR);
      return { root, visual, legL, legR, armL, armR };
    }

    function makeRemote(player) {
      if (!player || player.id === INIT.id || remotes.has(player.id)) return remotes.get(player && player.id);
      const body = fallbackBody(player.colors);
      const group = new THREE.Group(); group.add(body.root, nickSprite(player.nick || 'Jogador'));
      group.visible = false; MP.scene.add(group);
      const rp = {
        id: player.id, nick: player.nick, alive: player.alive !== false, group, body,
        targetPos: new THREE.Vector3(), targetYaw: 0, speed: 0, walk: 0,
        grounded: true, crouch: false, velY: 0, weapon: 0, shotSeq: 0, deadT: 0,
        rig: null, rigAnimator: null,
        spheres: [{ c: new THREE.Vector3(), r: .29, part: 'head' }, { c: new THREE.Vector3(), r: .43, part: 'body' }, { c: new THREE.Vector3(), r: .34, part: 'body' }],
        hitSpheres() {
          const p = this.group.position;
          this.spheres[0].c.set(p.x, p.y + 1.67, p.z);
          this.spheres[1].c.set(p.x, p.y + 1.08, p.z);
          this.spheres[2].c.set(p.x, p.y + .42, p.z);
          return this.spheres;
        },
        damage(damage, hit) {
          if (!this.alive) return false;
          if (hit && hit.y < this.group.position.y + .75) damage *= .8;
          queueHit(this.id, damage);
          return false;
        },
      };
      remotes.set(player.id, rp); window.__MP_remotePlayers.push(rp);
      if (remoteCharacter) Promise.resolve(remoteCharacter).then(mold => {
        if (!mold || !active || !remotes.has(player.id)) return;
        const rig = mold.build({ colors: player.colors });
        rp.rig = rig; rp.rigAnimator = rig.humanoidAnimator(); group.add(rig.root); body.visual.visible = false;
      }).catch(error => console.warn('[ARENA] avatar rigado indisponivel', error));
      return rp;
    }

    function removeRemote(id) {
      const rp = remotes.get(id); if (!rp) return;
      if (rp.rigAnimator) rp.rigAnimator.stop();
      if (rp.rig) rp.rig.dispose();
      MP.scene.remove(rp.group);
      rp.group.traverse(obj => {
        if (obj.geometry && !obj.userData.sharedCharacterGeometry) obj.geometry.dispose();
        const materials = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
        for (const material of materials) {
          if (obj.userData.sharedCharacterGeometry) continue;
          if (material.map) material.map.dispose();
          material.dispose();
        }
      });
      remotes.delete(id);
      const index = window.__MP_remotePlayers.indexOf(rp);
      if (index >= 0) window.__MP_remotePlayers.splice(index, 1);
    }

    const pendingHits = new Map();
    let hitFlush = false;
    function queueHit(id, damage) {
      pendingHits.set(id, (pendingHits.get(id) || 0) + damage);
      if (hitFlush) return;
      hitFlush = true;
      queueMicrotask(() => {
        hitFlush = false;
        for (const [targetId, total] of pendingHits) socket.emit('arenaHit', {
          targetId, dmg: Math.min(95, Math.round(total)), weapon: G.gun ? G.gun.name : 'ARMA',
        });
        pendingHits.clear();
      });
    }

    function installCombatHooks() {
      window.__BR_splash = (point, radius, maxDamage) => {
        for (const rp of remotes.values()) {
          if (!rp.alive || !rp.group.visible) continue;
          const distance = rp.group.position.distanceTo(point);
          if (distance < radius) queueHit(rp.id, maxDamage * (1 - distance / radius) + 20);
        }
      };
      window.__BR_melee = (origin, direction, damage) => {
        let best = null, bestDistance = Infinity;
        for (const rp of remotes.values()) {
          if (!rp.alive || !rp.group.visible) continue;
          const to = rp.group.position.clone().add(new THREE.Vector3(0, 1.1, 0)).sub(origin);
          const distance = to.length();
          if (distance > 3 || to.normalize().dot(direction) < .62 || distance >= bestDistance) continue;
          best = rp; bestDistance = distance;
        }
        if (best) {
          queueHit(best.id, damage);
          MP.showHitmarker(false); MP.SFX.hit();
        }
      };
      delete window.__BR_ballistics;
    }

    function disableSoloWorld() {
      try { for (const enemy of G.Enemies.list) { enemy.alive = false; if (enemy.group) enemy.group.visible = false; } } catch (e) {}
      try { G.Boss.state.alive = false; G.Boss.pos().set(0, -900, 0); } catch (e) {}
      try { G.Alien.state.alive = false; G.Alien.pos().set(0, -900, 0); } catch (e) {}
      try { for (const animal of G.Animals.list) { animal.alive = false; if (animal.group) animal.group.visible = false; } } catch (e) {}
    }

    function setupLoadout() {
      for (const gun of G.arsenal) {
        gun.locked = false;
        delete gun.projSpeed; delete gun.projDrop;
        if (!gun.melee) { gun.mag = gun.magSize; gun.reserve = Math.max(gun.reserve || 0, 999); }
      }
      G.inventory.medkits = 0; G.inventory.meat = 0; G.inventory.nades = 6;
      MP.player.armor = 0;
      G.switchWeapon(0);
      MP.updateSlotsHUD(); MP.updateAmmoHUD(); MP.updateInvHUD(); MP.updateArmorHUD();
    }

    function buildBoundary() {
      if (boundary) MP.scene.remove(boundary);
      const preset = MAPS[room.map] || MAPS.CAMP;
      boundary = new THREE.Group();
      const y = MP.heightAt(preset.center[0], preset.center[1]);
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(preset.radius, preset.radius, 16, 64, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x54c9ff, transparent: true, opacity: .055, side: THREE.DoubleSide, depthWrite: false }));
      wall.position.set(preset.center[0], y + 8, preset.center[1]); boundary.add(wall);
      for (const dy of [1, 9, 16]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(preset.radius, .16, 5, 96),
          new THREE.MeshBasicMaterial({ color: 0x55d7ff, transparent: true, opacity: dy === 1 ? .48 : .18 }));
        ring.rotation.x = Math.PI / 2; ring.position.set(preset.center[0], y + dy, preset.center[1]); boundary.add(ring);
      }
      MP.scene.add(boundary);
    }

    function respawn(spawn, invulnerableMs) {
      serverDead = false; suicideSent = false;
      serverHealth = 100;
      const player = MP.player;
      player.dead = false; player.health = player.maxHealth; player.armor = 0; player.vel.set(0, 0, 0);
      const x = spawn[0], z = spawn[2];
      player.pos.set(x, MP.groundAt(x, z, 400) + .05, z);
      player.invulnUntil = MP.state.gameTime + Math.max(0, invulnerableMs || 1400) / 1000;
      MP.setTimeScale(1); MP.updateHealthHUD(); MP.updateArmorHUD();
      const death = el('deathScreen'); if (death) death.classList.remove('show');
      const deathSub = el('deathSub'); if (deathSub) deathSub.textContent = 'aguardando respawn do servidor...';
      notice('PROTECAO DE SPAWN', Math.max(900, invulnerableMs || 1400));
    }

    function syncRoom(next) {
      if (!next || next.id !== room.id) return;
      room = next;
      remaining = next.remaining == null ? remaining : next.remaining;
      const present = new Set();
      for (const player of room.players || []) {
        if (player.id === INIT.id) continue;
        present.add(player.id);
        const rp = makeRemote(player);
        if (rp) {
          const respawned = !rp.alive && !!player.alive;
          rp.nick = player.nick;
          rp.alive = !!player.alive;
          if (respawned) {
            rp.deadT = 0;
            rp.group.rotation.x = 0;
            if (rp.rigAnimator?.reset) rp.rigAnimator.reset();
          }
          if (!rp.alive && rp.deadT <= 0) rp.group.visible = false;
        }
      }
      for (const id of [...remotes.keys()]) if (!present.has(id)) removeRemote(id);
      updateHud();
      updateResultState();
    }

    function showResult(data) {
      resultData = data;
      try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) {}
      const result = el('arenaResult'); if (!result) return;
      result.style.display = 'flex';
      const winner = data.winner;
      result.innerHTML = `<div class="resultCard"><h1>${winner && winner.id === INIT.id ? 'VITORIA' : 'FIM DE JOGO'}</h1>
        <div class="resultSub">${esc(room.name)} &middot; ${data.reason === 'time' ? 'TEMPO ESGOTADO' : 'LIMITE DE PONTOS'}</div>
        <table><tr><th>#</th><th>JOGADOR</th><th>KILLS</th><th>MORTES</th></tr>${(data.ranking || []).map((player, index) =>
          `<tr><td>${index + 1}</td><td>${esc(player.nick)}${player.id === INIT.id ? ' (voce)' : ''}</td><td><b>${player.score}</b></td><td>${player.deaths}</td></tr>`).join('')}</table>
        <div id="arenaResultWait" style="text-align:center;opacity:.62;font-size:11px;margin-top:12px">Nova rodada disponivel em ${data.nextIn}s</div>
        <div class="resultActions"><button id="arenaRematch" disabled>NOVA RODADA</button><button id="arenaExit" class="secondary">VOLTAR AOS MODOS</button></div></div>`;
      el('arenaRematch').addEventListener('click', () => socket.emit('arenaStart', {}));
      el('arenaExit').addEventListener('click', () => socket.timeout(2500).emit('arenaLeave', {}, () => location.reload()));
    }

    function updateResultState() {
      if (!resultData || !el('arenaResult') || el('arenaResult').style.display !== 'flex') return;
      const rematch = el('arenaRematch'), wait = el('arenaResultWait');
      const host = room.hostId === INIT.id;
      if (rematch) {
        rematch.disabled = !host || room.phase !== 'LOBBY' || room.playerCount < 2;
        rematch.textContent = host ? (room.playerCount < 2 ? 'AGUARDANDO ADVERSARIO' : 'NOVA RODADA') : 'AGUARDANDO O DONO';
      }
      if (wait && room.phase === 'LOBBY') wait.textContent = host ? 'Sala pronta para outra rodada.' : 'O dono da sala pode iniciar outra rodada.';
    }

    function beginRound(data) {
      room = data.room;
      resultData = null;
      const result = el('arenaResult'); if (result) result.style.display = 'none';
      remaining = room.timeLimit * 60;
      for (const rp of remotes.values()) {
        rp.alive = true;
        rp.deadT = 0;
        rp.group.rotation.x = 0;
        rp.group.visible = false;
        if (rp.rigAnimator?.reset) rp.rigAnimator.reset();
      }
      respawn(data.spawn, 1400);
      buildBoundary(); updateHud();
      notice(room.mode === 'DUEL' ? 'DUELO INICIADO' : 'MATA-MATA INICIADO', 1800);
    }

    installHud();
    LOBBY.hide(); UI.showHud(false); UI.hint('');
    if (!MP.state.started) G.forceStart();
    disableSoloWorld(); setupLoadout(); installCombatHooks(); buildBoundary();
    for (const player of room.players || []) makeRemote(player);
    respawn(ctx.spawn, 1400); updateHud();

    socket.on('arenaRoomState', syncRoom);
    socket.on('arenaPlayerUpdate', data => {
      if (!data || data.id === INIT.id) return;
      let rp = remotes.get(data.id);
      if (!rp) rp = makeRemote(data);
      if (!rp || !Array.isArray(data.pos)) return;
      rp.targetPos.set(data.pos[0], data.pos[1], data.pos[2]);
      rp.targetYaw = data.rotY || 0;
      if (!rp.alive && data.alive !== false) {
        rp.deadT = 0;
        rp.group.rotation.x = 0;
        if (rp.rigAnimator?.reset) rp.rigAnimator.reset();
      }
      rp.alive = data.alive !== false;
      rp.group.visible = rp.alive;
      rp.grounded = data.grounded !== false;
      rp.crouch = !!data.crouch;
      rp.velY = Number.isFinite(data.velY) ? data.velY : 0;
      rp.weapon = Number.isInteger(data.weapon) ? data.weapon : 0;
      rp.shotSeq = Number.isInteger(data.shotSeq) ? data.shotSeq : rp.shotSeq;
    });
    socket.on('arenaDamaged', data => {
      if (!data) return;
      serverHealth = Math.max(0, data.health);
      MP.player.armor = 0;
      MP.player.invulnUntil = 0;
      MP.playerDamage(data.dmg, data.fromPos ? { x: data.fromPos[0], y: data.fromPos[1], z: data.fromPos[2] } : null);
      MP.player.health = serverHealth; MP.updateHealthHUD();
    });
    socket.on('arenaHitConfirmed', () => { MP.showHitmarker(false); MP.SFX.hit(); });
    socket.on('arenaKilled', data => {
      if (!data) return;
      const rp = remotes.get(data.victimId);
      if (rp) { rp.alive = false; rp.deadT = 0.001; rp.group.visible = true; }
      if (data.victimId === INIT.id) {
        serverDead = true; suicideSent = true;
        serverHealth = 0;
        if (!MP.player.dead) { MP.player.invulnUntil = 0; MP.playerDamage(99999, null); }
        const deathSub = el('deathSub'); if (deathSub) deathSub.textContent = `respawn em ${data.respawnIn}s`;
      }
      feed(data.killerNick
        ? `<b>${esc(data.killerNick)}</b> eliminou ${esc(data.victimNick)} <span style="opacity:.55">${esc(data.weapon)}</span>`
        : `${esc(data.victimNick)} caiu fora da arena`);
    });
    socket.on('arenaRespawn', data => respawn(data.spawn, data.invulnerableMs));
    socket.on('arenaTime', data => { remaining = data.remaining; updateHud(); });
    socket.on('arenaMatchEnd', showResult);
    socket.on('arenaMatchStart', beginRound);
    socket.on('arenaCountdown', data => notice(data.n > 0 ? String(data.n) : 'VAI!', 900));
    socket.on('arenaChat', data => feed(`<b>${esc(data.nick)}</b> ${esc(data.msg)}`));
    socket.on('disconnect', () => {
      showResult({ reason: 'connection', ranking: room.players || [], winner: null, nextIn: 0 });
      const wait = el('arenaResultWait'); if (wait) wait.textContent = 'Conexao perdida. Volte ao menu para reconectar.';
    });

    intervals.push(setInterval(() => {
      if (!active || room.phase !== 'PLAYING' || MP.player.dead) return;
      let position = MP.player.pos, rotY = MP.camera.rotation.y;
      if (G.state.driving) { position = G.Car.group.position; rotY = G.Car.group.rotation.y; }
      else if (G.state.flying) { position = G.Heli.group.position; rotY = G.Heli.group.rotation.y; }
      socket.volatile.emit('arenaState', {
        pos: [position.x, position.y, position.z], rotY,
        grounded: MP.player.onGround,
        crouch: MP.player.crouchT > 0.45,
        velY: MP.player.vel.y,
        weapon: G.gun?.pistol ? 2 : G.gun?.pellets > 1 ? 1 : G.gun?.melee ? 3 : 0,
        shotSeq: MP.player.shotSeq,
      });
    }, 100));

    let previous = performance.now();
    function frame(now) {
      if (!active) return;
      const dt = Math.min(.05, Math.max(.001, (now - previous) / 1000)); previous = now;
      for (const rp of remotes.values()) {
        if (!rp.group.visible) continue;
        if (rp.deadT > 0) {
          rp.deadT += dt;
          if (rp.rigAnimator) {
            rp.group.rotation.x = 0;
            rp.rigAnimator.update(dt, 0, now / 1000, {
              dead: true, grounded: true, weapon: rp.weapon, shotSeq: rp.shotSeq,
            });
            if (rp.deadT >= 2.75) rp.group.visible = false;
          } else {
            rp.group.rotation.x = Math.min(rp.deadT * 2, Math.PI / 2);
            if (rp.deadT >= 1.2) rp.group.visible = false;
          }
          continue;
        }
        const oldX = rp.group.position.x, oldZ = rp.group.position.z;
        const blend = 1 - Math.exp(-14 * dt);
        rp.group.position.lerp(rp.targetPos, blend);
        let delta = rp.targetYaw - rp.group.rotation.y;
        delta = Math.atan2(Math.sin(delta), Math.cos(delta));
        rp.group.rotation.y += delta * blend;
        rp.speed = Math.hypot(rp.group.position.x - oldX, rp.group.position.z - oldZ) / dt;
        rp.walk += dt * Math.min(12, rp.speed * 2.4);
        if (rp.rigAnimator) rp.rigAnimator.update(dt, rp.speed, now / 1000, {
          grounded: rp.grounded,
          crouch: rp.crouch,
          velY: rp.velY,
          weapon: rp.weapon,
          shotSeq: rp.shotSeq,
        });
        else {
          const swing = Math.sin(rp.walk) * Math.min(.75, rp.speed * .08);
          rp.body.legL.rotation.x = swing; rp.body.legR.rotation.x = -swing;
          rp.body.armL.rotation.x = -swing * .65; rp.body.armR.rotation.x = swing * .65;
        }
      }
      if (room.phase === 'PLAYING' && !MP.player.dead) {
        if (Math.abs(MP.player.health - serverHealth) > .05) {
          MP.player.health = serverHealth;
          MP.updateHealthHUD();
        }
        if (MP.player.armor > 0) { MP.player.armor = 0; MP.updateArmorHUD(); }
        if (G.state.driving || G.state.flying) {
          try { G.tryToggleCar(); } catch (e) {}
          notice('VEICULOS DESATIVADOS NESTE MODO', 1100);
        }
        const preset = MAPS[room.map] || MAPS.CAMP;
        const dx = MP.player.pos.x - preset.center[0], dz = MP.player.pos.z - preset.center[1];
        const distance = Math.hypot(dx, dz);
        if (distance > preset.radius - 1) {
          const scale = (preset.radius - 1) / distance;
          MP.player.pos.x = preset.center[0] + dx * scale;
          MP.player.pos.z = preset.center[1] + dz * scale;
          notice('LIMITE DA ARENA', 650);
        }
      }
      if (MP.player.dead && !serverDead && !suicideSent && room.phase === 'PLAYING') {
        suicideSent = true; socket.emit('arenaSuicide', { weapon: 'QUEDA' });
      }
      frameId = requestAnimationFrame(frame);
    }
    frameId = requestAnimationFrame(frame);

    window.__MP_respawn = () => {
      if (MP.player.dead && !serverDead && !suicideSent) {
        suicideSent = true; socket.emit('arenaSuicide', { weapon: 'QUEDA' });
      }
    };

    function teardown() {
      if (!active) return;
      active = false; window.__ARENA_active = false; window.__BR_active = false;
      cancelAnimationFrame(frameId); for (const timer of intervals) clearInterval(timer);
      for (const id of [...remotes.keys()]) removeRemote(id);
      if (boundary) { MP.scene.remove(boundary); boundary.traverse(obj => { if (obj.geometry) obj.geometry.dispose(); if (obj.material) obj.material.dispose(); }); }
      for (const id of ['arenaHud', 'arenaScoreboard', 'arenaFeed', 'arenaSpawnNotice', 'arenaResult']) { const node = el(id); if (node) node.remove(); }
      socket.removeAllListeners();
    }

    window.__ARENA_debug = { get room() { return room; }, remotes, teardown, respawn, get active() { return active; } };
  }

  window.__ARENA_game = { start };
})();
