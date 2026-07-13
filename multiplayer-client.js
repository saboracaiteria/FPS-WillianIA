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
  const arenaScript = document.createElement('script');
  arenaScript.src = 'arena-game.js';
  document.body.appendChild(arenaScript);

  const poll = setInterval(() => {
    if (!window.__MP) return;
    if (window.__TRAINING_active) {
      clearInterval(poll);
      if (window.__MP.socket) window.__MP.socket.disconnect();
      return;
    }
    if (window.__MP.socket && window.__MP_init) {
      if (!window.__BR_game || !window.__ARENA_game) return; // espera os dois modos online carregarem
      clearInterval(poll);
      boot(window.__MP, window.__game, window.__MP_init);
    } else {
      clearInterval(poll);
      console.log('[BR] sem servidor — jogo solo');
    }
  }, 120);

  function boot(MP, G, INIT) {
    const socket = MP.socket;
    /* Começa a baixar o avatar rigado ainda no lobby. A partida não fica
       bloqueada: br-game mantém o boneco procedural até esta Promise resolver. */
    const remoteCharacter = G.Chars && typeof G.Chars.character === 'function'
      ? G.Chars.character('/assets/models/Personagens/low_poly_helldiver_rig.glb', {
        height: 1.9, yaw: Math.PI, animations: 'mixamo-player',
      })
        .catch(err => {
          console.error('Avatar Helldiver online falhou - mantendo fallback procedural:', err);
          return null;
        })
      : Promise.resolve(null);

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
      flags: INIT.flags || { golem: true, animais: true, ciclo: 'auto' },
      myKills: 0, aliveCount: 0, myPlacement: 0,
      lastHit: null,            // { shooterId, shooterNick, weapon, t }
      chuteOpen: false, jumped: false,
      lateJoin: INIT.phase === 'PLAYING' || INIT.phase === 'ENDED',
      clockOffset: INIT.serverNow - Date.now(),
      clockSynced: false,
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
        background:radial-gradient(circle at 18% 18%,rgba(38,113,148,.27),transparent 36%),
          radial-gradient(circle at 84% 78%,rgba(196,139,42,.16),transparent 34%),
          linear-gradient(135deg,rgba(3,8,14,.96),rgba(8,15,24,.93));
        backdrop-filter: blur(8px); color: #e8f1f8; font-family: system-ui, sans-serif; }
      .brPanel:before { content:"";position:absolute;inset:0;pointer-events:none;opacity:.11;
        background-image:linear-gradient(rgba(104,198,242,.22) 1px,transparent 1px),linear-gradient(90deg,rgba(104,198,242,.22) 1px,transparent 1px);
        background-size:46px 46px;mask-image:linear-gradient(to bottom,black,transparent 76%); }
      .brCard { position:relative;background:linear-gradient(155deg,rgba(17,27,39,.98),rgba(8,14,22,.98));
        border: 1px solid rgba(129,205,239,.2); border-radius: 16px;padding: 27px 32px; min-width: 560px; max-width: 920px;
        max-height: 92vh; overflow: auto;box-shadow:0 34px 100px rgba(0,0,0,.55),inset 0 1px rgba(255,255,255,.04); }
      .brCard:before { content:"";position:absolute;left:7%;right:7%;top:0;height:2px;
        background:linear-gradient(90deg,transparent,#66d3ff,#ffd76a,transparent);box-shadow:0 0 18px #57c7f4; }
      .brTitle { text-shadow:0 0 24px rgba(255,215,106,.25); }
      .brServerStrip { display:flex;justify-content:center;gap:18px;align-items:center;margin:10px 0 2px;color:#a9bdcc;
        font-size:9px;letter-spacing:1.5px;text-transform:uppercase; }
      .brServerStrip b { color:#dff7ff;font-weight:700; }
      .brLiveDot { width:7px;height:7px;border-radius:50%;background:#68ef9b;box-shadow:0 0 12px #68ef9b;display:inline-block;margin-right:5px; }
      .brModes { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin:16px 0 20px; }
      .brMode { min-height:64px; padding:10px 8px; border-radius:9px; border:1px solid rgba(255,255,255,.12);
        background:linear-gradient(145deg,rgba(39,51,66,.92),rgba(19,27,38,.92)); color:#dce9f5; cursor:pointer;
        font:700 12px/1.25 system-ui,sans-serif; letter-spacing:1px; transition:.18s transform,.18s border-color,.18s background; }
      .brMode small { display:block; margin-top:4px; opacity:.58; font-size:9px; font-weight:500; letter-spacing:.4px; }
      .brMode:hover,.brMode.active { transform:translateY(-2px); border-color:#ffd76a;
        background:linear-gradient(145deg,rgba(92,72,29,.92),rgba(34,30,21,.95)); color:#fff4cc; }
      .brMode:nth-child(2):hover,.brMode:nth-child(2).active { border-color:#ff836f;background:linear-gradient(145deg,rgba(91,39,37,.94),rgba(35,20,23,.95)); }
      .brMode:nth-child(3):hover,.brMode:nth-child(3).active { border-color:#62c7ff;background:linear-gradient(145deg,rgba(31,75,97,.94),rgba(17,29,40,.95)); }
      .brMode:nth-child(4):hover { border-color:#67e3bc;background:linear-gradient(145deg,rgba(25,82,70,.94),rgba(14,35,32,.95)); }
      .arenaGrid { display:grid; grid-template-columns:minmax(290px,1.08fr) minmax(260px,.92fr); gap:18px; }
      .arenaPane { border:1px solid rgba(255,255,255,.1); background:rgba(5,10,17,.38); border-radius:10px; padding:14px; }
      .arenaRooms { display:flex; flex-direction:column; gap:7px; max-height:300px; overflow:auto; }
      .arenaRoom { display:grid; grid-template-columns:1fr auto; gap:4px 10px; padding:10px; border-radius:8px;
        border:1px solid rgba(255,255,255,.1); background:rgba(255,255,255,.04); cursor:pointer; }
      .arenaRoom:hover { border-color:#62c7ff; background:rgba(98,199,255,.08); }
      .arenaRoom strong { color:#fff; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .arenaRoom span,.arenaMeta { opacity:.68; font-size:10px; letter-spacing:.7px; }
      .arenaForm { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
      .arenaForm .wide { grid-column:1/-1; }
      .arenaForm label { font-size:9px; letter-spacing:1.4px; opacity:.72; }
      .arenaForm label .brInput { margin-top:4px; }
      .arenaStatus { min-height:18px; margin-top:8px; color:#ffcc80; font-size:11px; }
      .arenaRoster { margin:10px 0; display:grid; gap:5px; }
      .arenaRoster div { display:flex; justify-content:space-between; padding:7px 9px; border-radius:6px; background:rgba(255,255,255,.05); }
      @media (max-width:760px) {
        .brPanel { align-items:flex-start; }
        .brCard { min-width:0; width:100%; margin:8px; padding:18px 14px; max-height:calc(100vh - 16px); }
        .brModes { grid-template-columns:1fr 1fr; }
        .brRow,.arenaGrid { flex-direction:column; display:flex; }
      }
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
      select.brInput { background: #131a24; }
      .brInput option { background: #131a24; color: #e8f1f8; }
      #brFlags label { display: flex; align-items: center; gap: 8px; padding: 2px 0; }
      #brFlags input[type=checkbox] { accent-color: #ffd76a; width: 15px; height: 15px; }
      #brFlags select { width: auto; padding: 4px 8px; }
      .brKeys { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 16px;
        font-size: 11.5px; opacity: .9; line-height: 1.7; }
      .brKeys b { background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.16);
        border-radius: 4px; padding: 0 6px; font-weight: 700; }
      #gasTint { position: fixed; inset: 0; pointer-events: none; z-index: 35; opacity: 0;
        transition: opacity .6s; background: radial-gradient(ellipse at center,
        rgba(255,40,20,0) 42%, rgba(220,30,10,.38) 100%); }
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
    const gasTint = div('gasTint');
    const zoneMapC = document.createElement('canvas');
    zoneMapC.id = 'brZoneMap'; zoneMapC.width = 190; zoneMapC.height = 190;
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
      topBar, zoneMapC, rosterBox, bossBar, spectBar, hintBox, gasTint,
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
    let hubMode = 'BR';
    let arenaRooms = Array.isArray(INIT.arenaRooms) ? INIT.arenaRooms : [];
    let currentArenaRoom = null;

    function lobbyHtml(extra) {
      return `<div class="brCard">
        <div class="brTitle">☄ QUEDA LIVRE</div>
        <div class="brSub" id="brModeSubtitle">${hubMode === 'BR' ? `BATTLE ROYALE · PARTIDA #${S.matchNum + 1} · MAPA NOVO A CADA RODADA` :
          hubMode === 'DUEL' ? '1 CONTRA 1 · CRIE OU ENCONTRE UM DUELO' : 'MATA-MATA · RESPAWN, PLACAR E ACAO CONTINUA'}</div>
        <div class="brServerStrip"><span><i class="brLiveDot"></i>servidor conectado</span><span>regiao <b>Brasil</b></span><span>ping <b id="brLobbyPing">medindo...</b></span></div>
        <div class="brModes">
          <button class="brMode ${hubMode === 'BR' ? 'active' : ''}" data-hub-mode="BR">BATTLE ROYALE<small>ultimo sobrevivente</small></button>
          <button class="brMode ${hubMode === 'DUEL' ? 'active' : ''}" data-hub-mode="DUEL">1 CONTRA 1<small>duelo publico ou privado</small></button>
          <button class="brMode ${hubMode === 'DEATHMATCH' ? 'active' : ''}" data-hub-mode="DEATHMATCH">MATA-MATA<small>respawn e placar</small></button>
          <button class="brMode" data-hub-mode="TRAINING">CAMPO DE TIRO<small>treino instantaneo</small></button>
        </div>
        <div id="brContent" style="display:${hubMode === 'BR' ? 'block' : 'none'}">
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
            <button class="brBtn" id="brTrainingBtn"
              style="background:#174c5d;color:#dffaff;margin-top:10px">🎯 CAMPO DE TIRO &nbsp;·&nbsp; ENTRAR AGORA</button>
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
              Todos caem da <b>nave</b> no mesmo mapa. Você começa só com o <b>machado</b> —
              abra <b>baús</b> pra achar armas (comum → lendária), derrote o <b>GOLEM</b>
              pro loot lendário, fuja do <b>gás</b> e seja o último vivo. 🏆
            </div>
            <div class="brH">CONTROLES</div>
            <div class="brKeys">
              <span><b>WASD</b> mover</span><span><b>SHIFT</b> correr</span>
              <span><b>ESPAÇO</b> pular/paraquedas</span><span><b>CTRL</b> agachar/deslizar</span>
              <span><b>🖱</b> atirar · dir. mirar</span><span><b>R</b> recarregar</span>
              <span><b>1-8</b> armas (ou scroll)</span><span><b>G</b> granada</span>
              <span><b>Q</b> kit médico</span><span><b>F</b> comer carne</span>
              <span><b>E</b> veículo / baú</span><span><b>T</b> troca de mira</span>
              <span><b>TAB</b> inventário</span><span><b>ENTER</b> chat da sala</span>
            </div>
            <div class="brH">REGRAS DA SALA <span style="opacity:.5">(só o anfitrião altera)</span></div>
            <div id="brFlags" style="font-size:12.5px;line-height:1.9">
              <label><input type="checkbox" id="fgGolem"> GOLEM da fortaleza</label>
              <label><input type="checkbox" id="fgAnimais"> Animais no mapa</label>
              <label><input type="checkbox" id="fgZumbis"> Zumbis à noite ☠</label>
              <label><input type="checkbox" id="fgCidade"> Destruição automática da cidade ☄</label>
              <label>Bots na sala:
                <select id="fgBots" class="brInput">
                  <option value="0">nenhum</option>
                  <option value="2">2</option>
                  <option value="4">4</option>
                  <option value="8">8</option>
                </select></label>
              <label>Ciclo:
                <select id="fgCiclo" class="brInput">
                  <option value="auto">dia e noite</option>
                  <option value="dia">sempre dia</option>
                  <option value="noite">sempre noite</option>
                </select></label>
            </div>
          </div>
        </div>
        </div>
        <div id="arenaContent" style="display:${hubMode === 'BR' ? 'none' : 'block'}">
          <div class="arenaGrid">
            <div class="arenaPane">
              <div class="brH" style="margin-top:0">SALAS DISPONIVEIS <span id="arenaRoomCount"></span></div>
              <div class="arenaRooms" id="arenaRoomList"></div>
              <div class="brH">ENTRAR PELO CODIGO</div>
              <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:6px">
                <input id="arenaJoinCode" class="brInput" maxlength="6" placeholder="CODIGO">
                <input id="arenaJoinPass" class="brInput" type="password" maxlength="20" placeholder="senha, se houver">
                <button id="arenaJoinBtn" class="brBtn" style="width:auto;margin:0;padding:8px 13px">ENTRAR</button>
              </div>
              <button id="arenaRefreshBtn" class="brBtn" style="background:#263747;color:#dbeeff;margin-top:8px">ATUALIZAR SALAS</button>
            </div>
            <div class="arenaPane">
              <div id="arenaCreatePanel">
                <div class="brH" style="margin-top:0">CRIAR SUA SALA</div>
                <div class="arenaForm">
                  <label class="wide">NOME<input id="arenaName" class="brInput" maxlength="28" value="${hubMode === 'DUEL' ? 'Duelo de ' : 'Mata-Mata de '}${esc(S.nick)}"></label>
                  <label>MODO<select id="arenaMode" class="brInput"><option value="DUEL" ${hubMode === 'DUEL' ? 'selected' : ''}>1 contra 1</option><option value="DEATHMATCH" ${hubMode !== 'DUEL' ? 'selected' : ''}>Mata-Mata</option></select></label>
                  <label>MAX. JOGADORES<input id="arenaMax" class="brInput" type="number" min="2" max="16" value="${hubMode === 'DUEL' ? 2 : 8}"></label>
                  <label>MAPA<select id="arenaMap" class="brInput"><option value="CAMP">Campo aberto</option><option value="CITY">Distrito urbano</option><option value="WILDERNESS">Fronteira</option></select></label>
                  <label>LIMITE DE PONTOS<input id="arenaScore" class="brInput" type="number" min="3" max="50" value="${hubMode === 'DUEL' ? 5 : 15}"></label>
                  <label>TEMPO (MIN)<input id="arenaTime" class="brInput" type="number" min="3" max="30" value="10"></label>
                  <label>RESPAWN (S)<input id="arenaRespawn" class="brInput" type="number" min="1" max="10" value="4"></label>
                  <label class="wide" style="display:flex;align-items:center;gap:8px"><input id="arenaPrivate" type="checkbox"> SALA PRIVADA COM SENHA</label>
                  <label class="wide" id="arenaPasswordWrap" style="display:none">SENHA<input id="arenaPassword" class="brInput" type="password" minlength="4" maxlength="20"></label>
                </div>
                <button id="arenaCreateBtn" class="brBtn">+ CRIAR E ENTRAR</button>
              </div>
              <div id="arenaCurrent" style="display:none"></div>
              <div class="arenaStatus" id="arenaStatus"></div>
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
      // virar host depois do render precisa reabilitar as regras da sala
      if (window.__BR_syncFlagsUI) window.__BR_syncFlagsUI();
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
    function arenaStatus(message, error) {
      const el = document.getElementById('arenaStatus');
      if (!el) return;
      el.textContent = message || '';
      el.style.color = error ? '#ff8f88' : '#8fddff';
    }

    function renderArenaRooms() {
      const list = document.getElementById('arenaRoomList');
      const count = document.getElementById('arenaRoomCount');
      if (!list) return;
      const preferred = hubMode === 'DUEL' || hubMode === 'DEATHMATCH' ? hubMode : null;
      const rooms = arenaRooms.slice().sort((a, b) => {
        const ap = a.mode === preferred ? 0 : 1, bp = b.mode === preferred ? 0 : 1;
        return ap - bp || a.phase.localeCompare(b.phase) || a.name.localeCompare(b.name);
      });
      if (count) count.textContent = `(${rooms.length})`;
      list.innerHTML = rooms.length ? rooms.map(room => `<div class="arenaRoom" data-room-id="${esc(room.id)}">
        <strong>${room.locked ? '[PRIVADA] ' : ''}${esc(room.name)}</strong><b>${room.playerCount}/${room.maxPlayers}</b>
        <span>${room.mode === 'DUEL' ? '1v1' : 'MATA-MATA'} &middot; ${esc(room.mapLabel || room.map)} &middot; ${room.scoreLimit} pts</span>
        <span>${room.phase === 'LOBBY' ? 'ABERTA' : room.phase}</span></div>`).join('')
        : '<div style="padding:24px 10px;text-align:center;opacity:.55">Nenhuma sala ainda.<br>Crie a primeira e chame seus amigos.</div>';
      for (const row of list.querySelectorAll('[data-room-id]')) row.addEventListener('click', () => {
        const room = arenaRooms.find(item => item.id === row.dataset.roomId);
        if (!room) return;
        const code = document.getElementById('arenaJoinCode');
        if (code) code.value = room.id;
        if (room.locked) {
          arenaStatus('Esta sala pede senha. Digite-a e clique em ENTRAR.');
          const pass = document.getElementById('arenaJoinPass');
          if (pass) pass.focus();
        } else joinArenaRoom(room.id, '');
      });
    }

    function renderCurrentArena() {
      const current = document.getElementById('arenaCurrent');
      const create = document.getElementById('arenaCreatePanel');
      if (!current || !create) return;
      if (!currentArenaRoom) {
        current.style.display = 'none';
        create.style.display = 'block';
        return;
      }
      create.style.display = 'none';
      current.style.display = 'block';
      const room = currentArenaRoom;
      const meHost = room.hostId === INIT.id;
      const canStart = meHost && room.phase === 'LOBBY' && room.playerCount >= 2;
      current.innerHTML = `<div class="brH" style="margin-top:0">SUA SALA &middot; <b style="color:#ffd76a">${esc(room.id)}</b></div>
        <div style="font-size:20px;font-weight:800">${esc(room.name)}</div>
        <div class="arenaMeta">${room.mode === 'DUEL' ? '1 CONTRA 1' : 'MATA-MATA'} &middot; ${esc(room.mapLabel || room.map)} &middot;
          ${room.scoreLimit} pontos &middot; ${room.timeLimit} min &middot; respawn ${room.respawn}s ${room.locked ? '&middot; PRIVADA' : '&middot; PUBLICA'}</div>
        <div class="arenaRoster">${(room.players || []).map(player => `<div><span>${player.id === room.hostId ? '[DONO] ' : ''}${esc(player.nick)}${player.id === INIT.id ? ' (voce)' : ''}</span><b>${player.score || 0}</b></div>`).join('')}</div>
        <div class="arenaMeta">${room.phase === 'LOBBY' ? (room.playerCount < 2 ? 'Aguardando mais um jogador...' : 'Pronta para iniciar.') :
          room.phase === 'COUNTDOWN' ? 'Partida iniciando...' : room.phase === 'ENDED' ? 'Rodada encerrada.' : 'Partida em andamento.'}</div>
        <button id="arenaCurrentStart" class="brBtn" ${canStart ? '' : 'disabled'}>${meHost ? (room.playerCount < 2 ? 'AGUARDANDO JOGADORES...' : 'INICIAR PARTIDA') : 'AGUARDANDO O DONO DA SALA...'}</button>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <button id="arenaCopyCode" class="brBtn" style="background:#263747;color:#dbeeff;margin-top:8px">COPIAR CODIGO</button>
          <button id="arenaLeaveCurrent" class="brBtn" style="background:#522b31;color:#ffdfe2;margin-top:8px">SAIR DA SALA</button>
        </div>`;
      const start = document.getElementById('arenaCurrentStart');
      if (start) start.addEventListener('click', () => socket.timeout(4000).emit('arenaStart', {}, (err, result) => {
        if (err || !result || !result.ok) arenaStatus(result && result.error || 'Nao foi possivel iniciar.', true);
      }));
      const leave = document.getElementById('arenaLeaveCurrent');
      if (leave) leave.addEventListener('click', () => socket.emit('arenaLeave', {}));
      const copy = document.getElementById('arenaCopyCode');
      if (copy) copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(room.id); arenaStatus('Codigo copiado.'); }
        catch (e) { arenaStatus('Codigo da sala: ' + room.id); }
      });
    }

    function setArenaRoom(room) {
      currentArenaRoom = room || null;
      if (room) hubMode = room.mode;
      renderArenaRooms();
      renderCurrentArena();
    }

    function joinArenaRoom(id, password) {
      arenaStatus('Entrando na sala...');
      socket.timeout(4000).emit('arenaJoin', { id, password }, (err, result) => {
        if (err || !result || !result.ok) {
          arenaStatus(result && result.error || 'A sala nao respondeu.', true);
          return;
        }
        setArenaRoom(result.room);
        arenaStatus('Voce entrou. Aguarde o dono iniciar.');
      });
    }

    function switchHub(mode) {
      if (mode === 'TRAINING') {
        const enter = () => { if (G.startTraining) G.startTraining(true); };
        if (currentArenaRoom) socket.timeout(3000).emit('arenaLeave', {}, () => enter());
        else enter();
        return;
      }
      if (mode === 'BR' && currentArenaRoom) {
        socket.emit('arenaLeave', {});
        currentArenaRoom = null;
      }
      hubMode = mode;
      const br = document.getElementById('brContent'), arena = document.getElementById('arenaContent');
      if (br) br.style.display = mode === 'BR' ? 'block' : 'none';
      if (arena) arena.style.display = mode === 'BR' ? 'none' : 'block';
      const subtitle = document.getElementById('brModeSubtitle');
      if (subtitle) subtitle.textContent = mode === 'BR' ? `BATTLE ROYALE · PARTIDA #${S.matchNum + 1} · MAPA NOVO A CADA RODADA`
        : mode === 'DUEL' ? '1 CONTRA 1 · CRIE OU ENCONTRE UM DUELO' : 'MATA-MATA · RESPAWN, PLACAR E ACAO CONTINUA';
      for (const button of lobby.querySelectorAll('[data-hub-mode]'))
        button.classList.toggle('active', button.dataset.hubMode === mode);
      const modeInput = document.getElementById('arenaMode'), maxInput = document.getElementById('arenaMax');
      if (modeInput && mode !== 'BR') modeInput.value = mode;
      if (maxInput && mode !== 'BR') {
        maxInput.disabled = mode === 'DUEL';
        if (mode === 'DUEL') maxInput.value = '2';
        else if (+maxInput.value === 2) maxInput.value = '8';
      }
      if (mode !== 'BR') {
        const nameInput = document.getElementById('arenaName');
        const scoreInput = document.getElementById('arenaScore');
        if (nameInput && /^(Duelo|Mata-Mata) de /i.test(nameInput.value))
          nameInput.value = `${mode === 'DUEL' ? 'Duelo' : 'Mata-Mata'} de ${S.nick}`;
        if (scoreInput && (+scoreInput.value === 5 || +scoreInput.value === 15))
          scoreInput.value = mode === 'DUEL' ? '5' : '15';
      }
      renderArenaRooms();
      renderCurrentArena();
    }

    function wireArenaHub() {
      for (const button of lobby.querySelectorAll('[data-hub-mode]'))
        button.addEventListener('click', () => switchHub(button.dataset.hubMode));
      const privateInput = document.getElementById('arenaPrivate');
      if (privateInput) privateInput.addEventListener('change', () => {
        const wrap = document.getElementById('arenaPasswordWrap');
        if (wrap) wrap.style.display = privateInput.checked ? 'block' : 'none';
      });
      const modeInput = document.getElementById('arenaMode');
      if (modeInput) modeInput.addEventListener('change', () => switchHub(modeInput.value));
      const join = document.getElementById('arenaJoinBtn');
      if (join) join.addEventListener('click', () => joinArenaRoom(
        (document.getElementById('arenaJoinCode').value || '').trim().toUpperCase(),
        document.getElementById('arenaJoinPass').value || '',
      ));
      const refresh = document.getElementById('arenaRefreshBtn');
      if (refresh) refresh.addEventListener('click', () => socket.timeout(4000).emit('arenaList', {}, (err, result) => {
        if (!err && result && result.ok) { arenaRooms = result.rooms || []; renderArenaRooms(); arenaStatus('Lista atualizada.'); }
      }));
      const create = document.getElementById('arenaCreateBtn');
      if (create) create.addEventListener('click', () => {
        const config = {
          name: document.getElementById('arenaName').value,
          mode: document.getElementById('arenaMode').value,
          maxPlayers: +document.getElementById('arenaMax').value,
          map: document.getElementById('arenaMap').value,
          scoreLimit: +document.getElementById('arenaScore').value,
          timeLimit: +document.getElementById('arenaTime').value,
          respawn: +document.getElementById('arenaRespawn').value,
          private: document.getElementById('arenaPrivate').checked,
          password: document.getElementById('arenaPassword').value,
        };
        arenaStatus('Criando sala...');
        socket.timeout(4000).emit('arenaCreate', config, (err, result) => {
          if (err || !result || !result.ok) { arenaStatus(result && result.error || 'Falha ao criar a sala.', true); return; }
          setArenaRoom(result.room);
          arenaStatus('Sala criada. Compartilhe o codigo ' + result.room.id + '.');
        });
      });
      renderArenaRooms();
      renderCurrentArena();
    }

    function wireLobby() {
      wireArenaHub();
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
      const trainingBtn = document.getElementById('brTrainingBtn');
      if (trainingBtn) trainingBtn.addEventListener('click', () => {
        if (G.startTraining) G.startTraining(true);
      });
      const fg = { golem: document.getElementById('fgGolem'),
        animais: document.getElementById('fgAnimais'), zumbis: document.getElementById('fgZumbis'),
        cidade: document.getElementById('fgCidade'),
        bots: document.getElementById('fgBots'), ciclo: document.getElementById('fgCiclo') };
      const syncFlagsUI = () => {
        const isHost = INIT.id === S.hostId;
        if (fg.golem) { fg.golem.checked = S.flags.golem; fg.golem.disabled = !isHost; }
        if (fg.animais) { fg.animais.checked = S.flags.animais; fg.animais.disabled = !isHost; }
        if (fg.zumbis) { fg.zumbis.checked = !!S.flags.zumbis; fg.zumbis.disabled = !isHost; }
        if (fg.cidade) { fg.cidade.checked = S.flags.cidade !== false; fg.cidade.disabled = !isHost; }
        if (fg.bots) { fg.bots.value = String(S.flags.bots || 0); fg.bots.disabled = !isHost; }
        if (fg.ciclo) { fg.ciclo.value = S.flags.ciclo; fg.ciclo.disabled = !isHost; }
      };
      window.__BR_syncFlagsUI = syncFlagsUI;
      syncFlagsUI();
      const sendFlags = () => socket.emit('setFlags',
        { golem: fg.golem.checked, animais: fg.animais.checked, zumbis: fg.zumbis.checked,
          cidade: fg.cidade.checked, bots: +fg.bots.value, ciclo: fg.ciclo.value });
      for (const k of ['golem', 'animais', 'zumbis', 'cidade', 'bots', 'ciclo'])
        if (fg[k]) fg[k].addEventListener('change', sendFlags);
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
    /* o painel #settings do jogo é "emprestado" pro lobby; antes de qualquer
       innerHTML no lobby ele PRECISA voltar pro menu, senão é destruído junto */
    function rescueSettings() {
      const st = document.getElementById('settings');
      if (st && st.closest('#brLobby')) {
        st.classList.remove('open');
        const panel = document.getElementById('panel');
        if (panel) panel.appendChild(st);
      }
    }
    const soltarMouse = () => {
      // painel na tela exige mouse livre: sem isto, quem entrou com o jogo
      // rodando (pointer lock) ficava preso sem conseguir clicar/editar
      try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) {}
    };
    const LOBBY = {
      show(extra) { soltarMouse(); rescueSettings(); lobby.innerHTML = lobbyHtml(extra); lobby.style.display = 'flex'; wireLobby(); },
      hide() { rescueSettings(); lobby.style.display = 'none'; },
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
        soltarMouse();
        rescueSettings();
        lobby.innerHTML = `<div class="brCard">${html}</div>`;
        lobby.style.display = 'flex';
      },
    };

    socket.on('arenaRooms', rooms => {
      arenaRooms = Array.isArray(rooms) ? rooms : [];
      renderArenaRooms();
    });
    socket.on('arenaJoined', room => {
      setArenaRoom(room);
      arenaStatus('Conectado a sala ' + room.id + '.');
    });
    socket.on('arenaRoomState', room => {
      if (currentArenaRoom && room.id === currentArenaRoom.id) setArenaRoom(room);
    });
    socket.on('arenaLeft', () => {
      currentArenaRoom = null;
      renderCurrentArena();
      arenaStatus('Voce saiu da sala.');
    });
    socket.on('arenaCountdown', data => {
      arenaStatus(data.n > 0 ? `Partida comeca em ${data.n}...` : 'VAI!');
    });
    socket.on('arenaMatchStart', data => {
      if (window.__ARENA_active) return;
      currentArenaRoom = data.room;
      window.__ARENA_game.start({
        MP, G, INIT, socket, S, UI, LOBBY, esc, remoteCharacter, teardownOnline,
        room: data.room, spawn: data.spawn,
      });
    });

    socket.on('flags', f => {
      S.flags = f;
      if (window.__BR_syncFlagsUI) window.__BR_syncFlagsUI();
    });
    socket.emit('hello', { nick: S.nick, colors: S.myColors });

    /* reconexão do socket.io ganharia um id novo no servidor (avatar duplicado,
       identidade quebrada) — recarregar é o único caminho limpo */
    const onReconnect = () => {
      if (window.__QA_DISABLE_RELOAD) {
        // O harness bloqueia o reload de produção para não perder seus hooks.
        // Ainda assim, o servidor entrega um socket.id novo após reconnect.
        const syncQaIdentity = () => {
          INIT.id = socket.id;
          if (window.__MP_init) window.__MP_init.id = socket.id;
          refreshLobbyRoster();
        };
        if (socket.connected) syncQaIdentity();
        else socket.once('connect', syncQaIdentity);
        return;
      }
      if (!window.__TRAINING_active) location.reload();
    };
    socket.io.on('reconnect', onReconnect);

    /* ---------- ping (mostrado ao lado do FPS quando habilitado) ---------- */
    function syncClock() {
      const perfStart = performance.now();
      const wallStart = Date.now();
      socket.timeout(4000).emit('pingx', (err, payload) => {
        if (err) return;
        const wallEnd = Date.now();
        const rtt = performance.now() - perfStart;
        window.__MP_ping = Math.round(rtt);
        const lobbyPing = document.getElementById('brLobbyPing');
        if (lobbyPing) lobbyPing.textContent = Math.round(rtt) + ' ms';
        S.halfRtt = rtt / 2;
        if (payload && Number.isFinite(payload.serverNow)) {
          // NTP simples: relogio remoto menos o ponto medio local do RTT.
          const sample = payload.serverNow - (wallStart + wallEnd) / 2;
          if (!S.clockSynced || rtt < (S.bestClockRtt ?? Infinity) * 1.35) {
            S.clockOffset = sample;
            S.bestClockRtt = Math.min(rtt, S.bestClockRtt ?? Infinity);
            S.clockSynced = true;
          }
        }
      });
    }
    syncClock();
    const clockWarmups = [setTimeout(syncClock, 350), setTimeout(syncClock, 900)];
    const pingInterval = setInterval(syncClock, 2000);
    const teardownOnline = () => {
      for (const timer of clockWarmups) clearTimeout(timer);
      clearInterval(pingInterval);
      socket.io.off('reconnect', onReconnect);
    };

    /* ---------- reivindica anfitrião: código salvo ou ?host=CODIGO na URL ---------- */
    const urlCode = new URLSearchParams(location.search).get('host');
    const savedCode = (() => { try { return localStorage.getItem('br_hostcode'); } catch (e) { return null; } })();
    if (urlCode || savedCode) claimHost(urlCode || savedCode, true);

    /* entrega tudo pra parte 2 (lógica da partida) */
    window.__BR_game.start({
      MP, G, INIT, socket, S, UI, LOBBY, esc, seededRng, remoteCharacter,
      teardownOnline,
    });
  }
})();
