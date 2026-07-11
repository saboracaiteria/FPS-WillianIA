/* ================================================================
   BOTS DE PARTIDA — conecta N bots num servidor JÁ RODANDO e espera
   o anfitrião (você) iniciar. Eles caem da nave, andam pela zona e
   trocam tiro entre si (e com você!).
   Uso: node scripts/bots.js [n=8] [url=http://localhost:3000]
   Ctrl+C derruba todos.
   ================================================================ */
'use strict';
const path = require('node:path');
const { io } = require('socket.io-client');
const { zoneAt } = require(path.join(__dirname, '..', 'server.js'));

const N = Math.max(1, parseInt(process.argv[2], 10) || 8);
const URL = process.argv[3] || 'http://localhost:3000';
const NICKS = ['Zumbi', 'Falcao', 'Vaga-Lume', 'Trovao', 'Golem Jr', 'Coiote', 'Visitante', 'Sombra',
  'Pantera', 'Cacto', 'Urubu', 'Lagarto', 'Tempestade', 'Neve', 'Fumaca', 'Raio'];

const shipPos = (t, plan) => {
  const sp = plan.ship;
  const k = Math.min(Math.max(t / sp.flyTime, 0), 1.18);
  return [sp.from[0] + (sp.to[0] - sp.from[0]) * k, sp.alt, sp.from[1] + (sp.to[1] - sp.from[1]) * k];
};

let plan = null, t0 = 0;
const bots = [];

for (let i = 0; i < N; i++) {
  const s = io(URL, { transports: ['websocket'] });
  const b = {
    i, s, id: null, alive: false, hp: 100, phase: 'LOBBY',
    x: 0, y: 0, z: 0, wp: null, lastShot: 0, diedSent: false,
    jumpAt: 0, mira: 0.4 + Math.random() * 0.5, // "pontaria" varia por bot
  };
  s.on('init', d => { b.id = d.id; s.emit('hello', { nick: NICKS[i % NICKS.length] + (i >= NICKS.length ? i : '') }); });
  s.on('matchStart', d => {
    plan = d.plan; t0 = d.t0;
    b.alive = true; b.hp = 100; b.phase = 'SHIP'; b.diedSent = false;
    b.jumpAt = d.plan.ship.flyTime * (0.25 + 0.65 * Math.random());
    console.log(`[bot ${i}] partida começou — pulando aos ${b.jumpAt.toFixed(0)}s`);
  });
  s.on('youWereHit', d => {
    if (!b.alive || b.diedSent) return;
    b.hp -= d.dmg;
    if (b.hp <= 0) {
      b.diedSent = true; b.alive = false;
      s.emit('deathDrop', { pos: [b.x, b.y, b.z], items: [{ type: 'ammo', amount: 60 }, { type: 'armor', amount: 50 }] });
      s.emit('died', { killerId: d.shooterId, weapon: d.weapon });
      console.log(`[bot ${i}] morreu`);
    }
  });
  s.on('playerKilled', d => { if (d.victimId === b.id) { b.alive = false; b.diedSent = true; } });
  s.on('nextMatch', () => { b.phase = 'LOBBY'; b.alive = false; });
  bots.push(b);
}

setInterval(() => {
  if (!plan) return;
  const t = (Date.now() - t0) / 1000;
  const zone = zoneAt(Math.max(t, 0), plan);
  for (const b of bots) {
    if (!b.alive) continue;
    if (b.phase === 'SHIP') {
      [b.x, b.y, b.z] = shipPos(t, plan);
      if (t >= b.jumpAt) b.phase = 'FALL';
      b.s.volatile.emit('state', { pos: [b.x, b.y, b.z], rotY: 0, ship: true, car: -1 });
    } else if (b.phase === 'FALL') {
      b.y = Math.max(4, b.y - 4.2);
      if (b.y <= 4) b.phase = 'PLAY';
      b.s.volatile.emit('state', { pos: [b.x, b.y, b.z], rotY: 0, chute: true, car: -1 });
    } else {
      if (!b.wp || Math.hypot(b.x - b.wp[0], b.z - b.wp[1]) < 3) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * Math.max(10, zone.r * 0.75);
        b.wp = [zone.x + Math.cos(a) * r, zone.z + Math.sin(a) * r];
      }
      const dx = b.wp[0] - b.x, dz = b.wp[1] - b.z, d = Math.hypot(dx, dz) || 1;
      b.x += (dx / d) * 0.45; b.z += (dz / d) * 0.45;
      b.s.volatile.emit('state', { pos: [b.x, b.y, b.z], rotY: Math.atan2(dx, dz), car: -1 });
      if (t - b.lastShot > 0.9 + Math.random()) {
        b.lastShot = t;
        const alvos = bots.filter(o => o.alive && o !== b);
        const alvo = alvos[Math.floor(Math.random() * alvos.length)];
        // "erra" conforme a pontaria — só uma fração das rajadas acerta
        if (alvo && Math.random() < b.mira)
          for (let k = 0; k < 2; k++)
            b.s.emit('shotHit', { targetId: alvo.id, dmg: 14, weapon: 'FUZIL', fromPos: [b.x, b.y + 1.5, b.z] });
      }
    }
  }
}, 100);

/* watchdog: servidor caiu → bots saem sozinhos (sem processos órfãos) */
setTimeout(() => {
  setInterval(() => {
    if (bots.every(x => x.s.disconnected)) {
      console.log('[bots] servidor fora do ar — encerrando');
      process.exit(0);
    }
  }, 4000);
}, 12000);

console.log(`${N} bots conectando em ${URL} — inicie a partida pelo lobby (você é o anfitrião).`);
console.log('Obs.: bots atiram entre si; quem atirar NELES tira vida deles de verdade.');
