/* ================================================================
   CLIENTE BATTLE ROYALE — parte 1: interface (CSS, HUD, lobby, chat).
   A lógica de partida mora em br-game.js (carregado daqui).
   Sem servidor, nada disso liga e o jogo segue 100% solo.
   ================================================================ */
(function () {
  'use strict';

  /* carrega a parte 2 (lógica da partida) */
  const s2 = document.createElement('script');
  s2.src = 'br-game.js';
  document.body.appendChild(s2);

  const poll = setInterval(() => {
    if (!window.__MP) return;
    if (window.__MP.socket && window.__MP_init) {
      if (!window.__BR_game) return; // espera br-game.js carregar
      clearInterval(poll);
      boot(window.__MP, window.__game, window.__MP_init);
    } else {
      clearInterval(poll);
      console.log('[BR] sem servidor — jogo solo');
    }
  }, 120);

  function boot(MP, G, INIT) {
    const socket = MP.socket;

    /* ---------- helpers ---------- */
    const esc = s => String(s == null ? '' : s).replace(/[<>&"']/g, c =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
    function seededRng(seed) {
      let s = seed >>> 0;
      return () => {
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    /* ---------- estado compartilhado com a parte 2 ---------- */
    let nick = (localStorage.getItem('br_nick') || '').trim().slice(0, 14)
      || 'Recruta' + (100 + Math.floor(Math.random() * 900));
    let myColors;
    try { myColors = JSON.parse(localStorage.getItem('br_colors')); } catch (e) { myColors = null; }
    if (!Array.isArray(myColors) || myColors.length !== 4)
      myColors = ['#4da6ff', '#2b3a4d', '#8a5a2b', '#ffd76a'];

    const S = {
      phase: 'LOBBY',           // LOBBY | COUNTDOWN | SHIP | FALL | PLAY | SPECT | ENDED
      plan: INIT.plan || null,
      matchNum: INIT.matchNum || 0,
      hostId: INIT.hostId,
      myKills: 0, aliveCount: 0, myPlacement: 0,
      lastHit: null,            // { shooterId, shooterNick, weapon, t }
      chuteOpen: false, jumped: false,
      lateJoin: INIT.phase === 'PLAYING' || INIT.phase === 'ENDED',
      clockOffset: INIT.serverNow - Date.now(),
      t0: INIT.t0 || 0,
      nick, myColors,
      chatOpen: false,
    };
    S.now = () => Date.now() + S.clockOffset;
    S.matchT = () => (S.now() - S.t0) / 1000;

    /* ---------- CSS ---------- */
    const css = document.createElement('style');
    css.textContent = `
      .brPanel { position: fixed; inset: 0; z-index: 300; display: flex; align-items: center; justify-content: center;
        background: rgba(5,9,14,.88); backdrop-filter: blur(6px); color: #e8f1f8; font-family: system-ui, sans-serif; }
      .brCard { background: rgba(14,20,28,.95); border: 1px solid rgba(255,255,255,.14); border-radius: 14px;
        padding: 26px 32px; min-width: 560px; max-width: 800px; max-height: 88vh; overflow: auto; }
      .brTitle { font-size: 26px; font-weight: 800; letter-spacing: 6px; color: #ffd76a; text-align: center; }
      .brSub { text-align: center; opacity: .7; font-size: 12px; letter-spacing: 3px; margin: 4px 0 14px; }
      .brRow { display: flex; gap: 20px; align-items: flex-start; }
      .brCol { flex: 1; min-width: 0; }
      .brH { font-size: 11px; letter-spacing: 3px; opacity: .65; margin: 12px 0 6px; }
      .brBtn { display: block; width: 100%; margin-top: 16px; padding: 12px; text-align: center; cursor: pointer;
        background: #ffd76a; color: #1a1408; font-weight: 800; letter-spacing: 3px; border-radius: 8px; border: 0; font-size: 15px; }
      .brBtn:disabled { background: #3a4250; color: #8a94a3; cursor: default; }
      .brInput { width: 100%; padding: 8px 10px; background: rgba(255,255,255,.08); color: #fff;
        border: 1px solid rgba(255,255,255,.18); border-radius: 6px; font-size: 14px; box-sizing: border-box; }
      .brPlayers div { padding: 3px 0; font-size: 13px; display: flex; align-items: center; gap: 8px; }
      .brDot { width: 12px; height: 12px; border-radius: 3px; display: inline-block; flex: none; }
      .brCount { font-size: 62px; font-weight: 800; color: #ffd76a; text-align: center; margin: 4px 0; }
      .brTable { width: 100%; border-collapse: collapse; font-size: 12.5px; }
      .brTable td, .brTable th { padding: 4px 8px; text-align: left; border-bottom: 1px solid rgba(255,255,255,.07); }
      .brTable th { opacity: .6; font-size: 10px; letter-spacing: 2px; }
      #brTop { position: fixed; left: 50%; top: 14px; transform: translateX(-50%); z-index: 40; display: none;
        gap: 10px; pointer-events: none; font-family: system-ui, sans-serif; }
      #brTop .pill { background: rgba(8,12,18,.62); border: 1px solid rgba(255,255,255,.14); border-radius: 20px;
        padding: 6px 16px; color: #e8f1f8; font-size: 13px; font-weight: 600; white-space: nowrap; backdrop-filter: blur(4px); }
      #brTop .pill b { color: #ffd76a; }
      #brTop .pill.warn { border-color: #ff7043; color: #ffb59e; }
      #brZoneMap { position: fixed; left: 22px; top: 202px; z-index: 40; border-radius: 10px; display: none;
        border: 1px solid rgba(255,255,255,.16); background: rgba(8,12,18,.55); pointer-events: none; }
      #brRoster { position: fixed; right: 12px; top: 60px; z-index: 40; background: rgba(8,12,18,.55); display: none;
        border: 1px solid rgba(255,255,255,.12); border-radius: 8px; padding: 6px 10px; min-width: 132px;
        font: 11.5px/1.7 system-ui, sans-serif; color: #dfe9f2; pointer-events: none; max-height: 130px; overflow: hidden; }
      #brRoster .me { color: #7fd4ff; }
      #brChat { position: fixed; left: 26px; bottom: 118px; z-index: 45; width: 330px;
        font: 12.5px/1.45 system-ui, sans-serif; pointer-events: none; }
      #brChatLog div { background: rgba(8,12,18,.55); border-radius: 6px; padding: 3px 9px; margin-top: 3px;
        color: #e8f1f8; max-width: 100%; width: fit-content; word-break: break-word; }
      #brChatLog .sys { color: #9fd8ff; font-style: italic; }
      #brChatLog b { color: #ffd76a; }
      #brChatInput { display: none; margin-top: 5px; pointer-events: auto; }
      #brBossBar { position: fixed; left: 50%; top: 54px; transform: translateX(-50%); z-index: 40; width: 300px;
        display: none; pointer-events: none; font-family: system-ui, sans-serif; }
      #brBossBar .lbl { text-align: center; font-size: 10px; letter-spacing: 3px; color: #ffb59e; margin-bottom: 3px;
        text-shadow: 0 1px 4px #000; }
      #brBossBar .bar { height: 9px; border-radius: 5px; background: rgba(0,0,0,.55); border: 1px solid rgba(255,120,80,.5); overflow: hidden; }
      #brBossBar .fill { height: 100%; background: linear-gradient(90deg,#ff5f3c,#ffb03c); width: 100%; }
      #brSpect { position: fixed; left: 50%; bottom: 13%; transform: translateX(-50%); z-index: 45;
        background: rgba(8,12,18,.7); border: 1px solid rgba(255,255,255,.16); border-radius: 10px;
        padding: 9px 22px; color: #e8f1f8; font: 14px system-ui, sans-serif; display: none; text-align: center; }
      #brSpect b { color: #7fd4ff; }
      #brHint { position: fixed; left: 50%; top: 62%; transform: translateX(-50%); z-index: 45; color: #fff;
        font: 600 15px system-ui, sans-serif; text-shadow: 0 2px 8px #000; display: none; text-align: center;
        background: rgba(8,12,18,.5); padding: 8px 18px; border-radius: 8px; }
      #brToast { position: fixed; right: 30px; bottom: 190px; z-index: 45; display: flex; flex-direction: column;
        gap: 5px; align-items: flex-end; font: 600 13px system-ui, sans-serif; pointer-events: none; }
      #brToast div { background: rgba(8,12,18,.7); border-radius: 6px; padding: 5px 12px; border: 1px solid; }
      .brFadeOut { animation: brFade 5s forwards; }
      @keyframes brFade { 0%,75% { opacity: 1; } 100% { opacity: 0; } }
      .rar-comum { color: #cfd8e3; border-color: #cfd8e3; }
      .rar-incomum { color: #7ee081; border-color: #7ee081; }
      .rar-raro { color: #5ab0ff; border-color: #5ab0ff; }
      .rar-épico { color: #c37eff; border-color: #c37eff; }
      .rar-lendário { color: #ffb03c; border-color: #ffb03c; }
    `;
    document.head.appendChild(css);

    /* ---------- DOM do HUD BR ---------- */
    const div = (id, parent) => { const d = document.createElement('div'); if (id) d.id = id; (parent || document.body).appendChild(d); return d; };
    const topBar = div('brTop');
    topBar.innerHTML = `<div class="pill" id="brAlive">—</div><div class="pill" id="brZonePill">—</div>`;
    const zoneMapC = document.createElement('canvas');
    zoneMapC.id = 'brZoneMap'; zoneMapC.width = 160; zoneMapC.height = 160;
    document.body.appendChild(zoneMapC);
    const rosterBox = div('brRoster');
    const chatBox = div('brChat');
    chatBox.innerHTML = `<div id="brChatLog"></div><input id="brChatInput" class="brInput" maxlength="120"
      placeholder="Enter envia · Esc fecha">`;
    const bossBar = div('brBossBar');
    bossBar.innerHTML = `<div class="lbl">⛰ GOLEM DA FORTALEZA</div><div class="bar"><div class="fill" id="brBossFill"></div></div>`;
    const spectBar = div('brSpect');
    const hintBox = div('brHint');
    const toastBox = div('brToast');

    const UI = {
      topBar, zoneMapC, rosterBox, bossBar, spectBar, hintBox,
      pillAlive: document.getElementById('brAlive'),
      pillZone: document.getElementById('brZonePill'),
      bossFill: document.getElementById('brBossFill'),
      chatLog: document.getElementById('brChatLog'),
      chatInput: document.getElementById('brChatInput'),
      showHud(on) {
        topBar.style.display = on ? 'flex' : 'none';
        zoneMapC.style.display = on ? 'block' : 'none';
        rosterBox.style.display = on ? 'block' : 'none';
      },
      toast(html, rarity) {
        const d = document.createElement('div');
        d.className = 'brFadeOut rar-' + (rarity || 'comum');
        d.innerHTML = html;
        toastBox.appendChild(d);
        setTimeout(() => d.remove(), 5200);
        while (toastBox.children.length > 5) toastBox.firstChild.remove();
      },
      hint(html, ms) {
        hintBox.innerHTML = html || '';
        hintBox.style.display = html ? 'block' : 'none';
        if (html && ms) setTimeout(() => { hintBox.style.display = 'none'; }, ms);
      },
      addChat(nickName, msg, sys) {
        const d = document.createElement('div');
        if (sys) { d.className = 'sys'; d.textContent = msg; }
        else d.innerHTML = `<b>${esc(nickName)}</b> ${esc(msg)}`;
        d.classList.add('brFadeOut');
        d.style.animationDuration = '11s';
        UI.chatLog.appendChild(d);
        setTimeout(() => d.remove(), 11200);
        while (UI.chatLog.children.length > 7) UI.chatLog.firstChild.remove();
      },
    };

    /* esconde HUD solo que não faz sentido no BR */
    for (const id of ['mission', 'score']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
    const deathSub = document.getElementById('deathSub');
    if (deathSub) deathSub.textContent = 'calculando colocação...';

    /* ---------- LOBBY ---------- */
    const lobby = div('brLobby');
    lobby.className = 'brPanel';
    lobby.style.display = 'none';

    function lobbyHtml(extra) {
      return `<div class="brCard">
        <div class="brTitle">☄ QUEDA LIVRE</div>
        <div class="brSub">BATTLE ROYALE · PARTIDA #${S.matchNum + 1} · mapa novo a cada rodada</div>
        ${extra || ''}
        <div class="brRow">
          <div class="brCol">
            <div class="brH">SEU NICK</div>
            <input id="brNick" class="brInput" maxlength="14" value="${esc(S.nick)}">
            <div class="brH">CORES DO PERSONAGEM</div>
            <div style="display:flex;gap:8px">
              ${['corpo', 'roupa', 'detalhe', 'visor'].map((l, i) =>
                `<label style="font-size:10px;text-align:center;opacity:.8">${l}<br>
                 <input type="color" class="brCol4" data-i="${i}" value="${S.myColors[i]}"
                   style="width:44px;height:34px;border:0;background:none;cursor:pointer"></label>`).join('')}
            </div>
            <div class="brH">NA SALA</div>
            <div class="brPlayers" id="brLobbyList">—</div>
            <button class="brBtn" id="brStartBtn" disabled>AGUARDANDO O ANFITRIÃO...</button>
            <div class="brH">ANFITRIÃO</div>
            <div style="display:flex;gap:6px">
              <input id="brHostCode" class="brInput" type="password" maxlength="12" placeholder="código do anfitrião"
                autocomplete="new-password" spellcheck="false" style="flex:1">
              <button class="brBtn" id="brHostBtn" style="width:auto;margin-top:0;padding:8px 14px;font-size:12px">OK</button>
            </div>
            <div id="brHostMsg" style="font-size:11px;opacity:.75;margin-top:4px"></div>
            <button class="brBtn" id="brCfgBtn"
              style="background:#3a4250;color:#e8f1f8;margin-top:10px">⚙ GRÁFICOS &amp; ÁUDIO</button>
            <div id="brCfgHolder"></div>
          </div>
          <div class="brCol">
            <div class="brH">🏆 RANKING GLOBAL</div>
            <table class="brTable" id="brGlobalTable"></table>
            <div class="brH">COMO FUNCIONA</div>
            <div style="font-size:12px;opacity:.8;line-height:1.6">
              Todos caem da <b>nave</b> no mesmo mapa. Você começa só com a <b>faca</b> —
              abra <b>baús</b> pra achar armas (comum → lendária), derrote o <b>GOLEM</b>
              pro loot lendário, fuja do <b>gás</b> e seja o último vivo. 🏆
            </div>
          </div>
        </div>
      </div>`;
    }
    function renderGlobal(top) {
      const t = document.getElementById('brGlobalTable');
      if (!t) return;
      t.innerHTML = '<tr><th>#</th><th>nick</th><th>pts</th><th>V</th><th>K</th></tr>' +
        (top && top.length ? top.map((r, i) =>
          `<tr><td>${i + 1}</td><td>${esc(r.nick)}</td><td>${r.points}</td><td>${r.wins}</td><td>${r.kills}</td></tr>`).join('')
          : '<tr><td colspan="5" style="opacity:.5">ainda sem partidas</td></tr>');
    }
    let lastRosterList = [];
    function refreshLobbyRoster() {
      const el = document.getElementById('brLobbyList');
      if (el) el.innerHTML = lastRosterList.map(p =>
        `<div><span class="brDot" style="background:${esc((p.colors || ['#888'])[0])}"></span>
         ${esc(p.nick)}${p.id === S.hostId ? ' 👑' : ''}${p.spectator ? ' <i style="opacity:.5">(espectador)</i>' : ''}</div>`).join('')
        || '<div style="opacity:.5">só você por enquanto — chama a galera!</div>';
      const btn = document.getElementById('brStartBtn');
      const isHost = INIT.id === S.hostId;
      if (btn) {
        btn.disabled = !isHost;
        btn.textContent = isHost ? '▶ COMEÇAR PARTIDA'
          : (S.hostId ? 'AGUARDANDO O ANFITRIÃO...' : 'SEM ANFITRIÃO — use o código abaixo');
      }
      const hm = document.getElementById('brHostMsg');
      if (hm && isHost) hm.textContent = '👑 você é o anfitrião — só você inicia a partida';
    }
    /* vira anfitrião com o código impresso no console do servidor;
       fica salvo no navegador e é re-enviado a cada reload (nextMatch recarrega a página) */
    function claimHost(code, silent) {
      code = String(code || '').trim();
      if (!code) return;
      socket.timeout(3000).emit('claimHost', { code }, (err, res) => {
        const hm = document.getElementById('brHostMsg');
        if (!err && res && res.ok) {
          try { localStorage.setItem('br_hostcode', code); } catch (e) {}
          if (hm) hm.textContent = '👑 você é o anfitrião — só você inicia a partida';
        } else {
          try { localStorage.removeItem('br_hostcode'); } catch (e) {}
          if (hm && !silent) hm.textContent = '✖ código errado';
        }
      });
    }
    function wireLobby() {
      const nickEl = document.getElementById('brNick');
      if (nickEl) nickEl.addEventListener('input', () => {
        S.nick = nickEl.value.trim().slice(0, 14) || S.nick;
        localStorage.setItem('br_nick', S.nick);
        socket.emit('hello', { nick: S.nick, colors: S.myColors });
      });
      for (const inp of lobby.querySelectorAll('.brCol4')) {
        inp.addEventListener('input', () => {
          S.myColors[+inp.dataset.i] = inp.value;
          localStorage.setItem('br_colors', JSON.stringify(S.myColors));
          socket.emit('hello', { nick: S.nick, colors: S.myColors });
        });
      }
      const btn = document.getElementById('brStartBtn');
      if (btn) btn.addEventListener('click', () => socket.emit('requestStart'));
      const hIn = document.getElementById('brHostCode'), hBtn = document.getElementById('brHostBtn');
      if (hBtn) hBtn.addEventListener('click', () => claimHost(hIn.value));
      if (hIn) hIn.addEventListener('keydown', e => { if (e.key === 'Enter') claimHost(hIn.value); });
      // configurações de gráfico/áudio do jogo, acessíveis direto do lobby:
      // o painel #settings do menu base é "emprestado" pro card e devolvido no VOLTAR
      const cfgBtn = document.getElementById('brCfgBtn'), holder = document.getElementById('brCfgHolder');
      const stEl = document.getElementById('settings');
      if (cfgBtn && stEl) {
        cfgBtn.addEventListener('click', () => { holder.appendChild(stEl); stEl.classList.add('open'); });
        const back = document.getElementById('btnBack');
        if (back && !window.__BR_cfgBackWired) {
          window.__BR_cfgBackWired = true;
          back.addEventListener('click', () => {
            if (stEl.parentElement && stEl.parentElement.id === 'brCfgHolder') {
              stEl.classList.remove('open');
              const panel = document.getElementById('panel');
              if (panel) panel.appendChild(stEl);
            }
          });
        }
      }
      renderGlobal(window.__BR_lastGlobalTop || INIT.globalTop);
      refreshLobbyRoster();
    }
    const LOBBY = {
      show(extra) { lobby.innerHTML = lobbyHtml(extra); lobby.style.display = 'flex'; wireLobby(); },
      hide() { lobby.style.display = 'none'; },
      setRoster(list) { lastRosterList = list; refreshLobbyRoster(); },
      renderGlobal,
      countdown(n) {
        const card = lobby.querySelector('.brCard');
        if (!card) return;
        let c = document.getElementById('brCountBig');
        if (!c) { c = document.createElement('div'); c.id = 'brCountBig'; c.className = 'brCount'; card.insertBefore(c, card.children[2]); }
        c.textContent = n > 0 ? n : 'VAI!';
      },
      overlay(html) { // telas de morte/vitória usam o mesmo painel
        lobby.innerHTML = `<div class="brCard">${html}</div>`;
        lobby.style.display = 'flex';
      },
    };

    socket.emit('hello', { nick: S.nick, colors: S.myColors });

    /* ---------- ping (mostrado ao lado do FPS quando habilitado) ---------- */
    setInterval(() => {
      const t0 = performance.now();
      socket.timeout(4000).emit('pingx', err => {
        if (!err) window.__MP_ping = Math.round(performance.now() - t0);
      });
    }, 2000);

    /* ---------- reivindica anfitrião: código salvo ou ?host=CODIGO na URL ---------- */
    const urlCode = new URLSearchParams(location.search).get('host');
    const savedCode = (() => { try { return localStorage.getItem('br_hostcode'); } catch (e) { return null; } })();
    if (urlCode || savedCode) claimHost(urlCode || savedCode, true);

    /* entrega tudo pra parte 2 (lógica da partida) */
    window.__BR_game.start({ MP, G, INIT, socket, S, UI, LOBBY, esc, seededRng });
  }
})();
