/* ================================================================
   Servidor BATTLE ROYALE — Express (estáticos) + Socket.io.
   Uma sala global com máquina de estados:
     LOBBY → (host inicia) → PLAYING (nave→queda→combate) → ENDED → LOBBY
   Cada partida usa uma seed nova (mapa/loot/zona/rota da nave mudam).
   O servidor é dono de: fase da partida, loot dos baús, HP do boss,
   kills/colocação, vencedor, chat e ranking global.
   ================================================================ */
'use strict';
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/multiplayer-client.js', (req, res) => res.sendFile(path.join(__dirname, 'multiplayer-client.js')));
app.get('/br-game.js', (req, res) => res.sendFile(path.join(__dirname, 'br-game.js')));
const server = http.createServer(app);
const io = new Server(server);

/* ---------------- utilidades ---------------- */
const clean = s => String(s == null ? '' : s).replace(/[<>&"']/g, '').trim();
// versão leve: preserva aspas (nomes de arma, chat) — o cliente escapa antes de renderizar
const cleanSoft = s => String(s == null ? '' : s).replace(/[<>&]/g, '').trim();
const cleanNick = n => clean(n).slice(0, 14) || 'Recruta';
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- ranking global (best-effort em disco) ----------------
   AVISO: no free tier do Render o disco é efêmero — o arquivo zera quando
   o serviço dorme/redeploya. Cada navegador também guarda as próprias
   estatísticas em localStorage como espelho. */
const RANK_FILE = path.join(__dirname, 'br-rank.json');
let globalRank = {};
try { globalRank = JSON.parse(fs.readFileSync(RANK_FILE, 'utf8')); } catch (e) { globalRank = {}; }
let rankDirty = false;
setInterval(() => {
  if (!rankDirty) return;
  rankDirty = false;
  fs.writeFile(RANK_FILE, JSON.stringify(globalRank), () => {});
}, 5000);
function rankEntry(nick) {
  const key = nick.toLowerCase();
  if (!globalRank[key]) globalRank[key] = { nick, points: 0, wins: 0, kills: 0, matches: 0, sumPlace: 0 };
  globalRank[key].nick = nick;
  return globalRank[key];
}
function topRank(n = 10) {
  return Object.values(globalRank)
    .sort((a, b) => b.points - a.points).slice(0, n)
    .map(r => ({ nick: r.nick, points: r.points, wins: r.wins, kills: r.kills,
      matches: r.matches, avgPlace: r.matches ? +(r.sumPlace / r.matches).toFixed(1) : 0 }));
}

/* ---------------- estado da sala/partida ---------------- */
const WORLD = 1100, LIM = WORLD / 2 - 60; // limites úteis do mapa
const players = new Map(); // id -> { nick, colors, kills, alive, spectator, placement, pos, lastChat, lastHits: [] }
let hostId = null;

const match = {
  phase: 'LOBBY',            // LOBBY | COUNTDOWN | PLAYING | ENDED
  seed: (Math.random() * 0xFFFFFFFF) >>> 0,
  num: 0,
  t0: 0,                     // Date.now() do início (nave decola)
  plan: null,                // { ship, zone, boss } enviado a todos
  aliveCount: 0,
  openedChests: new Set(),
  drops: new Map(),          // dropId -> { pos, items, taken }
  dropSeq: 0,
  bossHp: 0, bossMaxHp: 0, bossDead: false,
  countdownTimer: null, endTimer: null,
};

function buildPlan(seed) {
  const rng = mulberry32(seed ^ 0x9E3779B9);
  // nave: atravessa o mapa passando perto do centro
  const a = rng() * Math.PI * 2;
  const ship = {
    from: [Math.cos(a) * 620, Math.sin(a) * 620],
    to: [-Math.cos(a) * 620 + (rng() - 0.5) * 300, -Math.sin(a) * 620 + (rng() - 0.5) * 300],
    alt: 250, flyTime: 55,
  };
  // zona: 5 fases encolhendo; cada centro cabe dentro do círculo anterior
  const radii = [560, 340, 200, 110, 55, 24];
  const waits = [50, 45, 40, 35, 30];   // s parado antes de encolher
  const shrinks = [30, 28, 24, 20, 16]; // s encolhendo
  const dps = [1, 2, 4, 7, 12];
  let cx = (rng() - 0.5) * 300, cz = (rng() - 0.5) * 300;
  const phases = [];
  let t = ship.flyTime + 20; // gás só começa a contar depois da queda
  for (let i = 0; i < 5; i++) {
    const r0 = radii[i], r1 = radii[i + 1];
    const ang = rng() * Math.PI * 2, d = rng() * Math.max(0, r0 - r1) * 0.8;
    const nx = Math.max(-LIM, Math.min(LIM, cx + Math.cos(ang) * d));
    const nz = Math.max(-LIM, Math.min(LIM, cz + Math.sin(ang) * d));
    phases.push({ cx, cz, r0, nx, nz, r1, tWaitEnd: t + waits[i], tShrinkEnd: t + waits[i] + shrinks[i], dps: dps[i] });
    t += waits[i] + shrinks[i];
    cx = nx; cz = nz;
  }
  return { ship, zone: phases, boss: { hp: 3600 } };
}

/* loot dos baús — rolado no servidor (anti-trapaça leve) */
const WEAPON_TIERS = [ // idx do arsenal no jogo: 1=escopeta 0=fuzil 2=DMR 3=bazuca 4=plasma
  { rarity: 'incomum',  weapon: 1, ammo: 18 },
  { rarity: 'raro',     weapon: 0, ammo: 90 },
  { rarity: 'épico',    weapon: 2, ammo: 24 },
  { rarity: 'lendário', weapon: 3, ammo: 3 },
];
function rollChest(rng, luck = 0) {
  const items = [];
  const r = rng() + luck;
  if (r < 0.38) items.push({ type: 'ammo', amount: 40 + Math.floor(rng() * 50) });
  else if (r < 0.62) items.push({ type: 'weapon', ...WEAPON_TIERS[0] });
  else if (r < 0.82) items.push({ type: 'weapon', ...WEAPON_TIERS[1] });
  else if (r < 0.94) items.push({ type: 'weapon', ...WEAPON_TIERS[2] });
  else items.push({ type: 'weapon', ...WEAPON_TIERS[3] });
  if (rng() < 0.55) items.push({ type: 'med' });
  if (rng() < 0.3) items.push({ type: 'armor', amount: 50 });
  if (rng() < 0.22) items.push({ type: 'ammo', amount: 24 });
  return items;
}

/* ---------------- ciclo da partida ---------------- */
function roster() {
  return [...players.entries()].map(([id, p]) => ({
    id, nick: p.nick, colors: p.colors, kills: p.kills,
    alive: p.alive, spectator: p.spectator, pos: p.pos,
  }));
}
const sysChat = msg => io.emit('chat', { sys: true, msg });
const broadcastRoster = () => io.emit('roster', { phase: match.phase, players: roster(), aliveCount: match.aliveCount, hostId });

function startCountdown() {
  if (match.phase !== 'LOBBY') return;
  match.phase = 'COUNTDOWN';
  let n = 10;
  sysChat('Partida começando em 10s — se prepara!');
  io.emit('countdown', { n });
  match.countdownTimer = setInterval(() => {
    n--;
    io.emit('countdown', { n });
    if (n <= 0) { clearInterval(match.countdownTimer); startMatch(); }
  }, 1000);
  broadcastRoster();
}

function startMatch() {
  match.phase = 'PLAYING';
  match.num++;
  match.t0 = Date.now();
  match.plan = buildPlan(match.seed);
  match.openedChests.clear();
  match.drops.clear();
  match.dropSeq = 0;
  match.bossMaxHp = match.plan.boss.hp;
  match.bossHp = match.bossMaxHp;
  match.bossDead = false;
  match.aliveCount = 0;
  for (const p of players.values()) {
    if (p.spectator) continue; // quem entrou tarde continua espectador
    p.alive = true; p.kills = 0; p.placement = 0;
    match.aliveCount++;
  }
  io.emit('matchStart', { t0: match.t0, serverNow: Date.now(), plan: match.plan, num: match.num });
  broadcastRoster();
  sysChat(`Partida #${match.num} começou — ${match.aliveCount} na nave. Boa sorte!`);
  console.log(`[MATCH ${match.num}] começou com ${match.aliveCount} jogadores · seed ${match.seed}`);
}

function endMatch(winnerId) {
  if (match.phase !== 'PLAYING') return;
  match.phase = 'ENDED';
  const w = winnerId ? players.get(winnerId) : null;
  if (w) { w.placement = 1; }
  // ranking da partida: colocação crescente
  const ranking = [...players.values()]
    .filter(p => !p.spectator && p.placement > 0)
    .sort((a, b) => a.placement - b.placement)
    .map(p => ({ nick: p.nick, kills: p.kills, placement: p.placement }));
  // pontos globais
  const total = ranking.length;
  for (const p of players.values()) {
    if (p.spectator || !p.placement) continue;
    const e = rankEntry(p.nick);
    e.matches++; e.kills += p.kills; e.sumPlace += p.placement;
    e.points += 5 + p.kills * 25 + (p.placement === 1 ? 100 : 0) +
      (p.placement <= Math.ceil(total / 2) ? 20 : 0);
    if (p.placement === 1) e.wins++;
  }
  rankDirty = true;
  io.emit('matchEnd', {
    winner: w ? { id: winnerId, nick: w.nick, kills: w.kills } : null,
    ranking, globalTop: topRank(), nextIn: 14,
  });
  sysChat(w ? `🏆 ${w.nick} VENCEU a partida #${match.num} com ${w.kills} kills!` : 'Partida encerrada sem sobreviventes.');
  console.log(`[MATCH ${match.num}] vencedor: ${w ? w.nick : '(ninguém)'}`);
  match.endTimer = setTimeout(() => {
    match.seed = (Math.random() * 0xFFFFFFFF) >>> 0; // MAPA NOVO
    match.phase = 'LOBBY';
    for (const p of players.values()) { p.spectator = false; p.alive = false; p.placement = 0; }
    io.emit('nextMatch', {}); // clientes recarregam e voltam pro lobby com a seed nova
  }, 14000);
}

function checkVictory() {
  if (match.phase !== 'PLAYING') return;
  const alive = [...players.entries()].filter(([, p]) => !p.spectator && p.alive);
  match.aliveCount = alive.length;
  if (alive.length === 1) endMatch(alive[0][0]);
  else if (alive.length === 0) endMatch(null);
}

/* ---------------- conexões ---------------- */
io.on('connection', socket => {
  const isMidMatch = match.phase === 'PLAYING' || match.phase === 'ENDED';
  players.set(socket.id, {
    nick: 'Recruta', colors: null, kills: 0,
    alive: false, spectator: isMidMatch, placement: 0,
    pos: [0, 0, 0], lastChat: 0, hitWindow: [],
  });
  if (!hostId) hostId = socket.id;

  socket.emit('init', {
    id: socket.id,
    mode: 'br',
    worldSeed: match.seed,
    phase: match.phase,
    matchNum: match.num,
    t0: match.t0, serverNow: Date.now(),
    plan: match.phase === 'PLAYING' || match.phase === 'ENDED' ? match.plan : null,
    bossHp: match.bossHp, bossMaxHp: match.bossMaxHp, bossDead: match.bossDead,
    openedChests: [...match.openedChests],
    drops: [...match.drops.entries()].filter(([, d]) => !d.taken).map(([id, d]) => ({ id, pos: d.pos, items: d.items.length })),
    hostId,
    players: roster().filter(p => p.id !== socket.id),
    globalTop: topRank(),
  });
  broadcastRoster();
  console.log(`[+] ${socket.id} (${players.size} online, fase ${match.phase})`);

  socket.on('hello', d => {
    const p = players.get(socket.id); if (!p) return;
    p.nick = cleanNick(d && d.nick);
    if (d && Array.isArray(d.colors)) p.colors = d.colors.slice(0, 4).map(c => clean(c).slice(0, 9));
    broadcastRoster();
    sysChat(`${p.nick} entrou${p.spectator ? ' (espectador até a próxima partida)' : ''}`);
  });

  socket.on('requestStart', () => {
    if (socket.id === hostId && (match.phase === 'LOBBY')) startCountdown();
  });

  socket.on('state', d => {
    const p = players.get(socket.id);
    if (!p || !d || !Array.isArray(d.pos)) return;
    p.pos = d.pos.slice(0, 3).map(Number);
    socket.volatile.broadcast.emit('playerUpdate', {
      id: socket.id, pos: p.pos, rotY: +d.rotY || 0,
      ship: !!d.ship, chute: !!d.chute, nick: p.nick, colors: p.colors,
    });
  });

  socket.on('shotHit', d => {
    const p = players.get(socket.id);
    if (!p || !d || !players.has(d.targetId)) return;
    // anti-flood: no máx 12 acertos reportados por segundo por atirador
    const now = Date.now();
    p.hitWindow = p.hitWindow.filter(t => now - t < 1000);
    if (p.hitWindow.length >= 12) return;
    p.hitWindow.push(now);
    io.to(d.targetId).emit('youWereHit', {
      dmg: Math.min(Math.max(+d.dmg || 0, 0), 95),
      fromPos: Array.isArray(d.fromPos) ? d.fromPos : [0, 0, 0],
      shooterId: socket.id, shooterNick: p.nick,
      weapon: cleanSoft(d.weapon).slice(0, 24) || '???',
    });
  });

  socket.on('died', (d, cb) => {
    const victim = players.get(socket.id);
    if (!victim || !victim.alive) { if (typeof cb === 'function') cb({}); return; }
    victim.alive = false;
    victim.placement = match.aliveCount; // morreu agora = posição atual
    const killer = d && d.killerId ? players.get(d.killerId) : null;
    if (killer && d.killerId !== socket.id) killer.kills++;
    io.emit('playerKilled', {
      victimId: socket.id, victimNick: victim.nick,
      killerId: killer ? d.killerId : null, killerNick: killer ? killer.nick : null,
      killerKills: killer ? killer.kills : 0,
      weapon: cleanSoft(d && d.weapon).slice(0, 24) || (d && d.byZone ? 'ZONA' : '???'),
      byZone: !!(d && d.byZone),
      placement: victim.placement,
    });
    broadcastRoster();
    checkVictory();
    if (typeof cb === 'function') cb({ placement: victim.placement });
  });

  /* baús: primeiro a abrir leva; o servidor rola o loot */
  socket.on('openChest', (d, cb) => {
    if (typeof cb !== 'function') return;
    if (match.phase !== 'PLAYING' || !d || !d.key) return cb({ ok: false });
    const key = String(d.key).slice(0, 32);
    if (match.openedChests.has(key)) return cb({ ok: false, opened: true });
    match.openedChests.add(key);
    const rng = mulberry32((match.seed ^ [...key].reduce((a, c) => a * 31 + c.charCodeAt(0) | 0, 7)) >>> 0);
    const items = key === 'boss'
      ? [{ type: 'weapon', rarity: 'lendário', weapon: 4, ammo: 160 }, { type: 'armor', amount: 100 }, { type: 'med' }, { type: 'med' }]
      : rollChest(rng);
    socket.broadcast.emit('chestOpened', { key });
    cb({ ok: true, items });
  });

  /* drop de morte: espalha itens no chão, primeiro a pegar leva */
  socket.on('deathDrop', d => {
    if (!d || !Array.isArray(d.pos) || !Array.isArray(d.items)) return;
    const id = 'drop' + (++match.dropSeq);
    const items = d.items.slice(0, 6);
    match.drops.set(id, { pos: d.pos.slice(0, 3), items, taken: false });
    io.emit('dropSpawn', { id, pos: d.pos.slice(0, 3), items });
  });
  socket.on('takeDrop', (d, cb) => {
    if (typeof cb !== 'function') return;
    const drop = d && match.drops.get(d.id);
    if (!drop || drop.taken) return cb({ ok: false });
    drop.taken = true;
    io.emit('dropTaken', { id: d.id });
    cb({ ok: true, items: drop.items });
  });

  /* boss sincronizado: HP mora aqui */
  socket.on('bossHit', d => {
    if (match.phase !== 'PLAYING' || match.bossDead) return;
    const dmg = Math.min(Math.max(+((d || {}).dmg) || 0, 0), 150);
    match.bossHp = Math.max(0, match.bossHp - dmg);
    if (match.bossHp <= 0) {
      match.bossDead = true;
      const p = players.get(socket.id);
      io.emit('bossDead', { by: p ? p.nick : '???', tMatch: (Date.now() - match.t0) / 1000 });
      sysChat(`💀 O GOLEM caiu para ${p ? p.nick : '???'} — loot lendário no local!`);
    } else {
      io.volatile.emit('bossHp', { hp: match.bossHp, max: match.bossMaxHp });
    }
  });

  socket.on('chat', d => {
    const p = players.get(socket.id); if (!p) return;
    const now = Date.now();
    if (now - p.lastChat < 1200) return; // anti-spam
    const msg = cleanSoft(d && d.msg).slice(0, 120);
    if (!msg) return;
    p.lastChat = now;
    io.emit('chat', { nick: p.nick, msg });
  });

  socket.on('disconnect', () => {
    const p = players.get(socket.id);
    players.delete(socket.id);
    if (hostId === socket.id) hostId = players.keys().next().value || null;
    io.emit('playerLeft', { id: socket.id });
    if (p) sysChat(`${p.nick} saiu`);
    if (p && p.alive) { p.alive = false; checkVictory(); }
    broadcastRoster();
    console.log(`[-] ${socket.id} (${players.size} online)`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor BR no ar em http://localhost:${PORT} · seed inicial ${match.seed}`);
});
