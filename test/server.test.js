/* ================================================================
   QA — suite BDD do servidor Battle Royale (node --test).
   Cada teste sobe um servidor NOVO em porta própria com knobs de
   teste (COUNTDOWN_S=1, FLY_TIME=2, BR_FAST=1) pra rodar rápido.
   Rode com: npm test
   ================================================================ */
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { io } = require('socket.io-client');

const SERVER = path.join(__dirname, '..', 'server.js');
let nextPort = 21000 + (process.pid % 500) * 10;

function spawnServer(env = {}) {
  const port = nextPort++;
  const proc = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env, PORT: String(port), HOST_CODE: 'QA123',
      COUNTDOWN_S: '1', NEXT_IN_S: '60', ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('servidor não subiu')), 5000);
    proc.stdout.on('data', d => {
      if (String(d).includes('Servidor BR no ar')) {
        clearTimeout(to);
        res({ port, proc, stop: () => proc.kill() });
      }
    });
    proc.on('exit', c => rej(new Error('servidor morreu cedo, código ' + c)));
  });
}

const connect = port => {
  const s = io(`http://localhost:${port}`, { transports: ['websocket'] });
  return new Promise(res => s.once('init', init => res({ s, init })));
};
const once = (sock, ev) => new Promise(res => sock.once(ev, res));
const ack = (sock, ev, data) => new Promise((res, rej) =>
  sock.timeout(3000).emit(ev, data, (err, d) => (err ? rej(err) : res(d))));
const sleep = ms => new Promise(r => setTimeout(r, ms));
// coletor: registra ANTES de agir, evita corrida de eventos no mesmo tick
const collect = (sock, ev) => { const arr = []; sock.on(ev, d => arr.push(d)); return arr; };

/* sobe servidor + n clientes, host = cliente 0, e começa a partida */
async function playing(t, n, env = {}) {
  const srv = await spawnServer(env);
  t.after(() => srv.stop());
  const clients = [];
  for (let i = 0; i < n; i++) {
    const c = await connect(srv.port);
    c.s.emit('hello', { nick: 'QA' + i });
    clients.push(c);
    t.after(() => c.s.close());
  }
  const started = clients.map(c => once(c.s, 'matchStart'));
  await ack(clients[0].s, 'claimHost', { code: 'QA123' });
  clients[0].s.emit('requestStart');
  const ms = await Promise.all(started);
  return { srv, clients, plan: ms[0].plan };
}

/* =============== LOBBY E ANFITRIÃO =============== */
describe('Lobby e anfitrião', () => {
  it('dado um jogador novo, quando conecta, então recebe init do lobby sem host', async t => {
    const srv = await spawnServer(); t.after(() => srv.stop());
    const { s, init } = await connect(srv.port); t.after(() => s.close());
    assert.equal(init.mode, 'br');
    assert.equal(init.phase, 'LOBBY');
    assert.equal(init.hostId, null);
    assert.ok(Number.isFinite(init.worldSeed));
  });

  it('dado um nick com HTML, quando entra na sala, então o roster sai sanitizado', async t => {
    const srv = await spawnServer(); t.after(() => srv.stop());
    const { s } = await connect(srv.port); t.after(() => s.close());
    const rosters = collect(s, 'roster');
    s.emit('hello', { nick: '<img src=x>Zé' });
    await sleep(300);
    const nick = rosters[rosters.length - 1].players[0].nick;
    assert.ok(!/[<>&"']/.test(nick), `sobrou caractere perigoso: ${nick}`);
    assert.ok(nick.length <= 14);
  });

  it('dado o nick digitado letra a letra (hello por tecla), então só anuncia a entrada uma vez', async t => {
    const srv = await spawnServer(); t.after(() => srv.stop());
    const a = await connect(srv.port); t.after(() => a.s.close());
    const b = await connect(srv.port); t.after(() => b.s.close());
    const chats = collect(b.s, 'chat');
    for (const n of ['W', 'Wi', 'Wil', 'Will', 'Willi']) a.s.emit('hello', { nick: n });
    await sleep(400);
    const entradas = chats.filter(m => m.sys && m.msg.includes('entrou'));
    assert.ok(entradas.length <= 2, `chat spammado: ${entradas.length} anúncios`); // a própria entrada de B conta 1
  });

  it('dado um jogador comum, quando pede pra iniciar, então nada acontece', async t => {
    const srv = await spawnServer(); t.after(() => srv.stop());
    const { s } = await connect(srv.port); t.after(() => s.close());
    const counts = collect(s, 'countdown');
    s.emit('requestStart');
    await sleep(600);
    assert.equal(counts.length, 0);
  });

  it('dado o código do anfitrião, quando errado nega e quando certo (minúsculo) aceita', async t => {
    const srv = await spawnServer(); t.after(() => srv.stop());
    const { s, init } = await connect(srv.port); t.after(() => s.close());
    const bad = await ack(s, 'claimHost', { code: 'NOPE' });
    assert.equal(bad.ok, false);
    const rosters = collect(s, 'roster');
    const good = await ack(s, 'claimHost', { code: 'qa123' });
    assert.equal(good.ok, true);
    await sleep(200);
    assert.equal(rosters[rosters.length - 1].hostId, init.id);
  });

  it('dado o host, quando inicia, então vem countdown e matchStart com plano completo', async t => {
    const { plan } = await playing(t, 2);
    assert.ok(plan.ship && Array.isArray(plan.ship.from) && plan.ship.flyTime > 0);
    assert.equal(plan.zone.length, 5);
    assert.ok(plan.boss.hp > 0);
  });

  it('dado que o host caiu, então ninguém herda o posto', async t => {
    const srv = await spawnServer(); t.after(() => srv.stop());
    const a = await connect(srv.port);
    const b = await connect(srv.port); t.after(() => b.s.close());
    await ack(a.s, 'claimHost', { code: 'QA123' });
    const rosters = collect(b.s, 'roster');
    a.s.close();
    await sleep(400);
    assert.equal(rosters[rosters.length - 1].hostId, null);
  });

  it('dado que a sala esvaziou na contagem, então volta pro lobby sem partida vazia', async t => {
    const srv = await spawnServer(); t.after(() => srv.stop());
    const a = await connect(srv.port);
    await ack(a.s, 'claimHost', { code: 'QA123' });
    a.s.emit('requestStart');
    await sleep(200);
    a.s.close(); // host some no meio da contagem
    await sleep(1600); // contagem de 1s dispara com sala vazia
    const b = await connect(srv.port); t.after(() => b.s.close());
    assert.equal(b.init.phase, 'LOBBY');
  });
});

/* =============== ESTADO E MOVIMENTO =============== */
describe('Estado e movimento', () => {
  it('dado um state válido, então os outros recebem playerUpdate com o carro', async t => {
    const { clients } = await playing(t, 2);
    const [a, b] = clients;
    const upds = collect(b.s, 'playerUpdate');
    const iv = setInterval(() => a.s.emit('state', { pos: [1, 2, 3], rotY: 0.5, car: 2 }), 60);
    t.after(() => clearInterval(iv));
    await sleep(500);
    const mine = upds.filter(u => u.id === a.init.id);
    assert.ok(mine.length > 0, 'nenhum playerUpdate chegou');
    assert.deepEqual(mine[mine.length - 1].pos, [1, 2, 3]);
    assert.equal(mine[mine.length - 1].car, 2);
  });

  it('dado um state com posição inválida (não numérica), então ele é descartado', async t => {
    const { clients } = await playing(t, 2);
    const [a, b] = clients;
    a.s.emit('state', { pos: [10, 5, 10], rotY: 0 });
    await sleep(200);
    const upds = collect(b.s, 'playerUpdate');
    const iv = setInterval(() => a.s.emit('state', { pos: ['abc', 5, 10], rotY: 0 }), 60);
    t.after(() => clearInterval(iv));
    await sleep(500);
    assert.equal(upds.filter(u => u.id === a.init.id).length, 0, 'posição inválida passou pelo servidor');
  });

  it('dado um jogador morto, então o state dele não é repassado (avatar-marionete)', async t => {
    const { clients } = await playing(t, 3);
    const [a, b] = clients;
    await ack(a.s, 'died', {});
    const upds = collect(b.s, 'playerUpdate');
    const iv = setInterval(() => a.s.emit('state', { pos: [5, 5, 5], rotY: 0 }), 60);
    t.after(() => clearInterval(iv));
    await sleep(500);
    assert.equal(upds.filter(u => u.id === a.init.id).length, 0, 'morto pilotou avatar');
  });

  it('dada uma posição absurda, então ela é clampada aos limites do mundo', async t => {
    const { clients } = await playing(t, 2);
    const [a, b] = clients;
    const upds = collect(b.s, 'playerUpdate');
    const iv = setInterval(() => a.s.emit('state', { pos: [99999, 9999, -99999], rotY: 0 }), 60);
    t.after(() => clearInterval(iv));
    await sleep(500);
    const mine = upds.filter(u => u.id === a.init.id);
    assert.ok(mine.length > 0);
    assert.deepEqual(mine[mine.length - 1].pos, [1100, 600, -1100]);
  });
});

/* =============== COMBATE =============== */
describe('Combate', () => {
  it('dado um tiro, então a vítima recebe o dano com teto de 95 e o nick do atirador', async t => {
    const { clients } = await playing(t, 2);
    const [a, b] = clients;
    const hit = once(b.s, 'youWereHit');
    a.s.emit('shotHit', { targetId: b.init.id, dmg: 500, weapon: 'FUZIL', fromPos: [0, 0, 0] });
    const d = await hit;
    assert.equal(d.dmg, 95);
    assert.equal(d.shooterNick, 'QA0');
  });

  it('dado um atirador morto, então os tiros dele são ignorados', async t => {
    const { clients } = await playing(t, 3);
    const [a, , c] = clients;
    await ack(a.s, 'died', {}); // A morre
    const hits = collect(c.s, 'youWereHit');
    a.s.emit('shotHit', { targetId: c.init.id, dmg: 50, weapon: 'FUZIL', fromPos: [0, 0, 0] });
    await sleep(400);
    assert.equal(hits.length, 0, 'morto atirou');
  });

  it('dada uma vítima já morta, então o tiro nela é ignorado', async t => {
    const { clients } = await playing(t, 3);
    const [a, b] = clients;
    await ack(b.s, 'died', {});
    const hits = collect(b.s, 'youWereHit');
    a.s.emit('shotHit', { targetId: b.init.id, dmg: 50, weapon: 'FUZIL', fromPos: [0, 0, 0] });
    await sleep(400);
    assert.equal(hits.length, 0);
  });

  it('dado flood de 20 tiros num segundo, então no máximo 12 passam', async t => {
    const { clients } = await playing(t, 2);
    const [a, b] = clients;
    const hits = collect(b.s, 'youWereHit');
    for (let i = 0; i < 20; i++)
      a.s.emit('shotHit', { targetId: b.init.id, dmg: 10, weapon: 'FUZIL', fromPos: [0, 0, 0] });
    await sleep(600);
    assert.ok(hits.length <= 12, `passaram ${hits.length}`);
    assert.ok(hits.length >= 10, `só ${hits.length} chegaram`);
  });

  it('dada uma morte com killer, então a kill é creditada com colocação', async t => {
    const { clients } = await playing(t, 3);
    const [a, b] = clients;
    const killed = once(a.s, 'playerKilled');
    const res = await ack(b.s, 'died', { killerId: a.init.id, weapon: 'FUZIL' });
    const k = await killed;
    assert.equal(k.killerId, a.init.id);
    assert.equal(k.killerKills, 1);
    assert.equal(res.placement, 3); // morreu com 3 vivos = #3
  });

  it('dado um suicídio (killerId = eu mesmo), então não credita kill', async t => {
    const { clients } = await playing(t, 3);
    const [a] = clients;
    const killed = once(a.s, 'playerKilled');
    await ack(a.s, 'died', { killerId: a.init.id, weapon: 'GRANADA' });
    const k = await killed;
    assert.equal(k.killerKills, 0);
  });

  it('dado um espectador apontado como killer, então ele não ganha a kill', async t => {
    const { srv, clients } = await playing(t, 2);
    const [a, b] = clients;
    const spec = await connect(srv.port); t.after(() => spec.s.close());
    assert.equal(spec.init.phase, 'PLAYING'); // entrou no meio: espectador
    const killed = once(a.s, 'playerKilled');
    await ack(b.s, 'died', { killerId: spec.init.id, weapon: 'FUZIL' });
    const k = await killed;
    assert.equal(k.killerId, null, 'espectador levou a kill');
  });

  it('dado o último vivo, então a partida termina com ranking ordenado', async t => {
    const { clients } = await playing(t, 3);
    const [a, b, c] = clients;
    const endP = once(a.s, 'matchEnd');
    await ack(c.s, 'died', { killerId: a.init.id, weapon: 'FUZIL' });
    await ack(b.s, 'died', { killerId: a.init.id, weapon: 'FUZIL' });
    const end = await endP;
    assert.equal(end.winner.id, a.init.id);
    assert.equal(end.winner.kills, 2);
    assert.deepEqual(end.ranking.map(r => r.placement), [1, 2, 3]);
    assert.equal(end.ranking[0].nick, 'QA0');
  });
});

  it('dados os dois últimos morrendo juntos, então ainda sai um vencedor coerente', async t => {
    const { clients } = await playing(t, 2);
    const [a, b] = clients;
    const endP = once(a.s, 'matchEnd');
    a.s.emit('died', { killerId: b.init.id, weapon: 'GRANADA' }); // troca mútua,
    b.s.emit('died', { killerId: a.init.id, weapon: 'GRANADA' }); // sem await no meio
    const end = await endP;
    assert.ok(end.winner, 'partida terminou "sem sobreviventes" com gente no ranking');
    const primeiro = end.ranking.find(r => r.placement === 1);
    assert.equal(end.winner.nick, primeiro.nick, 'vencedor difere do #1 do ranking');
  });

/* =============== LOOT =============== */
describe('Cache HTTP (atualizações chegam nos jogadores)', () => {
  it('dado o código do jogo, então revalida sempre; modelos pesados podem cachear', async t => {
    // bug de playtest: sem cache-control da origem, o Cloudflare/navegador
    // seguravam js antigo por 4h — deploy no ar e jogador vendo carro velho
    const srv = await spawnServer(); t.after(() => srv.stop());
    const h = async p => (await fetch(`http://localhost:${srv.port}${p}`)).headers;
    for (const p of ['/', '/game.js', '/js/car.js', '/br-game.js']) {
      const cc = (await h(p)).get('cache-control') || '';
      assert.match(cc, /no-cache/, `${p} sem no-cache (ficaria 4h preso no edge/navegador): "${cc}"`);
    }
    const glb = (await h('/assets/models/mazda-rx7.optimized.glb')).get('cache-control') || '';
    assert.match(glb, /max-age=[1-9]/, `modelo sem cache longo: "${glb}"`);
  });
});

describe('Loot', () => {
  it('dado um baú, então abre uma única vez e avisa os outros', async t => {
    const { clients } = await playing(t, 2);
    const [a, b] = clients;
    const openedEv = once(b.s, 'chestOpened');
    const r1 = await ack(a.s, 'openChest', { key: 'c1' });
    assert.equal(r1.ok, true);
    assert.ok(Array.isArray(r1.items) && r1.items.length > 0);
    assert.equal((await openedEv).key, 'c1');
    const r2 = await ack(b.s, 'openChest', { key: 'c1' });
    assert.equal(r2.ok, false);
    assert.equal(r2.opened, true);
  });

  it('dado o fim da partida, então o lobby seguinte não herda os baús da rodada anterior', async t => {
    const rankFile = path.join('/tmp', `fps-chest-reset-${process.pid}-${Date.now()}.json`);
    const { clients, srv } = await playing(t, 2, { NEXT_IN_S: '1', RANK_FILE: rankFile });
    const [a, b] = clients;
    const opened = await ack(a.s, 'openChest', { key: 'c1' });
    assert.equal(opened.ok, true);

    const nextMatch = once(a.s, 'nextMatch');
    a.s.emit('died', { killerId: b.init.id, weapon: 'QA' });
    await nextMatch;

    const reloaded = await connect(srv.port);
    t.after(() => reloaded.s.close());
    assert.equal(reloaded.init.phase, 'LOBBY');
    assert.deepEqual(reloaded.init.openedChests, [],
      'o init do lobby recarregado ainda trouxe baús abertos da partida encerrada');
  });

  it('dado o baú do boss, então só abre depois do GOLEM morrer', async t => {
    const { clients } = await playing(t, 2);
    const [a, b] = clients;
    const early = await ack(a.s, 'openChest', { key: 'boss' });
    assert.equal(early.ok, false, 'baú do boss abriu com o boss vivo');
    const deadEv = once(b.s, 'bossDead');
    // orçamento anti-cheat de 1200 dano/s no boss: os 3600 hp exigem ~3s de tiros espaçados
    const shooter = (async () => {
      for (let i = 0; i < 60; i++) { a.s.emit('bossHit', { dmg: 150 }); await sleep(120); }
    })();
    await deadEv;
    await shooter.catch(() => {});
    const late = await ack(a.s, 'openChest', { key: 'boss' });
    assert.equal(late.ok, true);
    assert.equal(late.items[0].rarity, 'lendário');
  });

  it('dado um drop de morte, então só vale um por vida', async t => {
    const { clients } = await playing(t, 2);
    const [a, b] = clients;
    const drops = collect(b.s, 'dropSpawn');
    a.s.emit('deathDrop', { pos: [1, 0, 1], items: [{ type: 'med' }] });
    a.s.emit('deathDrop', { pos: [2, 0, 2], items: [{ type: 'med' }] }); // spam
    await sleep(400);
    assert.equal(drops.length, 1, `spawnou ${drops.length} drops`);
  });

  it('dado um espectador, então ele não consegue queimar baú dos vivos', async t => {
    const { srv } = await playing(t, 2);
    const spec = await connect(srv.port); t.after(() => spec.s.close());
    const res = await ack(spec.s, 'openChest', { key: 'c2' });
    assert.equal(res.ok, false, 'espectador abriu baú');
  });

  it('dado um item malicioso no drop, então o servidor sanitiza formato e limites', async t => {
    const { clients } = await playing(t, 2);
    const [a, b] = clients;
    const dropEv = once(b.s, 'dropSpawn');
    a.s.emit('deathDrop', {
      pos: [1, 0, 1],
      items: [
        { type: 'weapon<script>', weapon: 99, ammo: 999999, amount: -5, rarity: '<b>x', extra: 'y'.repeat(50000) },
        { type: 'ammo', amount: 60 },
        'lixo', null,
      ],
    });
    const drop = await dropEv;
    for (const it of drop.items) {
      assert.ok(Object.keys(it).every(k => ['type', 'weapon', 'ammo', 'amount', 'rarity'].includes(k)),
        'campo desconhecido vazou: ' + JSON.stringify(Object.keys(it)));
      assert.ok(!/[<>]/.test(it.type + (it.rarity || '')), 'HTML vazou no item');
      if (it.ammo !== undefined) assert.ok(it.ammo <= 999);
      if (it.weapon !== undefined) assert.ok(it.weapon >= 0 && it.weapon <= 5);
    }
    assert.equal(drop.items.length, 2, 'itens-lixo deviam ser descartados');
  });

  it('dado um drop no chão, então só pega quem está perto — e uma vez só', async t => {
    const { clients } = await playing(t, 3);
    const [a, b, c] = clients;
    const dropEv = once(b.s, 'dropSpawn');
    a.s.emit('deathDrop', { pos: [50, 0, 50], items: [{ type: 'med' }] });
    const drop = await dropEv;
    // B está longe (pos padrão 0,0,0 → 70m do drop)
    const far = await ack(b.s, 'takeDrop', { id: drop.id });
    assert.equal(far.ok, false, 'pegou de longe');
    // B anda até perto e pega
    b.s.emit('state', { pos: [49, 0, 49], rotY: 0 });
    await sleep(250);
    const near = await ack(b.s, 'takeDrop', { id: drop.id });
    assert.equal(near.ok, true);
    // C chega depois: já era
    c.s.emit('state', { pos: [50, 0, 50], rotY: 0 });
    await sleep(250);
    const gone = await ack(c.s, 'takeDrop', { id: drop.id });
    assert.equal(gone.ok, false);
  });
});

/* =============== ANTI-CHEAT =============== */
describe('Anti-cheat', () => {
  it('dado martelar códigos de anfitrião, então o socket entra em cooldown', async t => {
    const srv = await spawnServer({ CLAIM_COOLDOWN_MS: '900' }); t.after(() => srv.stop());
    const { s } = await connect(srv.port); t.after(() => s.close());
    for (let i = 0; i < 6; i++) await ack(s, 'claimHost', { code: 'CHUTE' + i });
    const bloqueado = await ack(s, 'claimHost', { code: 'QA123' }); // certo, mas em cooldown
    assert.equal(bloqueado.ok, false, 'força bruta passou pelo cooldown');
    await sleep(1100);
    const depois = await ack(s, 'claimHost', { code: 'QA123' });
    assert.equal(depois.ok, true, 'cooldown não abriu depois da janela');
  });


  it('dado um teleporte impossível, então o servidor descarta a posição (speedhack)', async t => {
    const { clients } = await playing(t, 2);
    const [a, b] = clients;
    for (let i = 0; i < 3; i++) { a.s.emit('state', { pos: [1, 2, 3], rotY: 0 }); await sleep(80); }
    const upds = collect(b.s, 'playerUpdate');
    for (let i = 0; i < 5; i++) { a.s.emit('state', { pos: [800, 2, 3], rotY: 0 }); await sleep(80); }
    await sleep(300);
    const jumped = upds.filter(u => u.id === a.init.id && u.pos[0] > 700);
    assert.equal(jumped.length, 0, 'teleporte de 800m foi aceito');
  });

  it('dado dano acima do orçamento (520/s), então o excedente é descartado', async t => {
    const { clients } = await playing(t, 2);
    const [a, b] = clients;
    const hits = collect(b.s, 'youWereHit');
    for (let i = 0; i < 12; i++)
      a.s.emit('shotHit', { targetId: b.init.id, dmg: 95, weapon: 'HACK', fromPos: [0, 0, 0] });
    await sleep(500);
    const total = hits.reduce((s, h) => s + h.dmg, 0);
    assert.ok(total <= 520, `passaram ${total} de dano num segundo`);
    assert.ok(total >= 380, `orçamento cortou demais: ${total}`);
  });

  it('dado um shotHit vindo de longe demais, então é descartado (exploit de kill instantâneo)', async t => {
    // reproduz o hack relatado em produção: cliente adulterado emitindo
    // shotHit contra qualquer id do lobby, de qualquer distância, sem
    // precisar mirar/acertar de verdade — matava o mapa inteiro em <1s
    const { clients } = await playing(t, 2);
    const [a, b] = clients;
    for (let i = 0; i < 3; i++) { a.s.emit('state', { pos: [900, 5, 900], rotY: 0 }); await sleep(80); }
    await sleep(100);
    const hits = collect(b.s, 'youWereHit');
    a.s.emit('shotHit', { targetId: b.init.id, dmg: 95, weapon: 'HACK', fromPos: [900, 5, 900] });
    await sleep(300);
    assert.equal(hits.length, 0, 'tiro a ~1270m de distância foi aceito');
  });

  it('dado um alvo a distância real de tiro, então o dano passa normalmente', async t => {
    const { clients } = await playing(t, 2);
    const [a, b] = clients;
    for (let i = 0; i < 3; i++) { a.s.emit('state', { pos: [50, 5, 0], rotY: 0 }); await sleep(80); }
    await sleep(100);
    const hit = once(b.s, 'youWereHit');
    a.s.emit('shotHit', { targetId: b.init.id, dmg: 40, weapon: 'FUZIL', fromPos: [50, 5, 0] });
    const d = await hit;
    assert.equal(d.dmg, 40, 'tiro dentro do alcance foi rejeitado por engano');
  });

  it('dado atirar em si mesmo (targetId = próprio id), então é descartado', async t => {
    const { clients } = await playing(t, 2);
    const [a] = clients;
    const hits = collect(a.s, 'youWereHit');
    a.s.emit('shotHit', { targetId: a.init.id, dmg: 95, weapon: 'HACK', fromPos: [0, 0, 0] });
    await sleep(300);
    assert.equal(hits.length, 0, 'auto-shotHit foi aceito');
  });

  it('dado farm automatizado de baús, então há intervalo mínimo entre aberturas', async t => {
    const { clients } = await playing(t, 2);
    const [a] = clients;
    const r1 = await ack(a.s, 'openChest', { key: 'r1' });
    assert.equal(r1.ok, true);
    const r2 = await ack(a.s, 'openChest', { key: 'r2' }); // < 300ms depois
    assert.equal(r2.ok, false, 'abriu 2 baús em <300ms');
    await sleep(400);
    const r3 = await ack(a.s, 'openChest', { key: 'r3' });
    assert.equal(r3.ok, true);
  });
});

/* =============== REGRAS DA SALA (FLAGS) =============== */
describe('Regras da sala (flags do anfitrião)', () => {
  it('dado um não-host mexendo nas flags, então nada muda; host muda e todos recebem', async t => {
    const srv = await spawnServer(); t.after(() => srv.stop());
    const a = await connect(srv.port); t.after(() => a.s.close());
    const b = await connect(srv.port); t.after(() => b.s.close());
    assert.equal(a.init.flags.golem, true, 'init sem flags');
    const recebidas = collect(a.s, 'flags');
    b.s.emit('setFlags', { golem: false, ciclo: 'noite' }); // B não é host
    await sleep(300);
    assert.equal(recebidas.length, 0, 'não-host alterou as regras!');
    await ack(a.s, 'claimHost', { code: 'QA123' });
    a.s.emit('setFlags', { golem: false, animais: false, ciclo: 'noite' });
    await sleep(300);
    const f = recebidas[recebidas.length - 1];
    assert.ok(f && f.golem === false && f.animais === false && f.ciclo === 'noite');
  });

  it('dado GOLEM desligado, então a partida nasce com boss morto e o baú lendário não abre', async t => {
    const srv = await spawnServer(); t.after(() => srv.stop());
    const a = await connect(srv.port); t.after(() => a.s.close());
    a.s.emit('hello', { nick: 'HostQA' });
    await ack(a.s, 'claimHost', { code: 'QA123' });
    a.s.emit('setFlags', { golem: false });
    const started = once(a.s, 'matchStart');
    a.s.emit('requestStart');
    const ms = await started;
    assert.equal(ms.plan.flags.golem, false, 'flags não congelaram no plano');
    const r = await ack(a.s, 'openChest', { key: 'boss' });
    assert.equal(r.ok, false, 'baú lendário abriu sem GOLEM na sala');
  });

  it('dados bots e zumbis nas flags, então sanitiza (teto 8, booleano) e bots ENTRAM na sala', async t => {
    const srv = await spawnServer(); t.after(() => srv.stop());
    const a = await connect(srv.port); t.after(() => a.s.close());
    await ack(a.s, 'claimHost', { code: 'QA123' });
    const recebidas = collect(a.s, 'flags');
    const rosters = collect(a.s, 'roster');
    a.s.emit('setFlags', { bots: 99, zumbis: 'sim' });   // lixo
    await sleep(300);
    let f = recebidas[recebidas.length - 1];
    assert.equal(f.bots, 8, 'teto de bots não aplicou');
    assert.equal(f.zumbis, false, 'zumbis não-booleano passou');
    a.s.emit('setFlags', { bots: 2, zumbis: true });
    // processo de bots sobe e conecta — polling até 12s (máquina carregada)
    let entraram = false;
    for (let i = 0; i < 40 && !entraram; i++) {
      await sleep(300);
      const ultimo = rosters[rosters.length - 1];
      entraram = !!ultimo && ultimo.players.length >= 3;
    }
    f = recebidas[recebidas.length - 1];
    assert.equal(f.bots, 2);
    assert.equal(f.zumbis, true);
    assert.ok(entraram, 'bots não entraram na sala em 12s');
    a.s.emit('setFlags', { bots: 0 }); // desliga (mata o processo filho)
    await sleep(400);
  });

  it('dado ciclo inválido no setFlags, então é ignorado (sanitização)', async t => {
    const srv = await spawnServer(); t.after(() => srv.stop());
    const a = await connect(srv.port); t.after(() => a.s.close());
    await ack(a.s, 'claimHost', { code: 'QA123' });
    const recebidas = collect(a.s, 'flags');
    a.s.emit('setFlags', { ciclo: 'meianoite<script>', golem: 'sim' });
    await sleep(300);
    const f = recebidas[recebidas.length - 1];
    assert.equal(f.ciclo, 'auto', 'ciclo inválido passou');
    assert.equal(f.golem, true, 'golem não-booleano passou');
  });
});

/* =============== POSSE DE VEÍCULO =============== */
describe('Posse de veículo (arbitrada no servidor)', () => {
  it('dado dois pedidos pelo mesmo carro, então só o primeiro leva — e sair devolve', async t => {
    const { clients } = await playing(t, 3);
    const [a, b] = clients;
    const r1 = await ack(a.s, 'enterCar', { idx: 0 });
    assert.equal(r1.ok, true);
    const r2 = await ack(b.s, 'enterCar', { idx: 0 });
    assert.equal(r2.ok, false, 'segundo motorista levou o mesmo carro');
    a.s.emit('leaveCar', { idx: 0 });
    await sleep(200);
    const r3 = await ack(b.s, 'enterCar', { idx: 0 });
    assert.equal(r3.ok, true, 'carro não foi liberado ao sair');
  });

  it('dada a morte do motorista, então o carro é liberado pros outros', async t => {
    const { clients } = await playing(t, 3);
    const [a, b] = clients;
    await ack(a.s, 'enterCar', { idx: 2 });
    await ack(a.s, 'died', {});
    const r = await ack(b.s, 'enterCar', { idx: 2 });
    assert.equal(r.ok, true, 'carro ficou preso com o morto');
  });
});

/* =============== ZONA AUTORITATIVA =============== */
describe('Zona autoritativa (servidor mata quem o cliente não mata)', () => {
  it('dado um jogador travado fora da zona, então o servidor o elimina e a partida termina', async t => {
    const { clients, plan } = await playing(t, 2, { BR_FAST: '1', FLY_TIME: '2' });
    const [a, b] = clients;
    const z0 = plan.zone[0];
    // A joga normal no centro; B fica "flutuando" longe, na rota da nave
    const iv = setInterval(() => {
      a.s.emit('state', { pos: [z0.cx, 5, z0.cz], rotY: 0 });
      b.s.emit('state', { pos: [900, 250, 900], rotY: 0, ship: true });
    }, 150);
    t.after(() => clearInterval(iv));
    const killedP = once(a.s, 'playerKilled');
    const endP = once(a.s, 'matchEnd');
    const k = await killedP;
    assert.equal(k.victimId, b.init.id);
    assert.equal(k.byZone, true);
    const end = await endP;
    assert.equal(end.winner.id, a.init.id);
  });

  it('dado um jogador AFK que parou de mandar estado, então o servidor o elimina', async t => {
    const { clients, plan } = await playing(t, 2, { BR_FAST: '1', FLY_TIME: '2' });
    const [a, b] = clients;
    const z0 = plan.zone[0];
    b.s.emit('state', { pos: [z0.cx, 5, z0.cz], rotY: 0 }); // dentro da zona… e silêncio
    const iv = setInterval(() => a.s.emit('state', { pos: [z0.cx + 3, 5, z0.cz], rotY: 0 }), 150);
    t.after(() => clearInterval(iv));
    const k = await once(a.s, 'playerKilled');
    assert.equal(k.victimId, b.init.id);
    assert.equal(k.byZone, true);
  });
});

/* =============== CHAT =============== */
describe('Chat', () => {
  it('dada uma mensagem, então repassa com nick, remove HTML e segura spam', async t => {
    const { clients } = await playing(t, 2);
    const [a, b] = clients;
    const msgs = collect(b.s, 'chat');
    a.s.emit('chat', { msg: 'oi <script>alert(1)</script>' });
    a.s.emit('chat', { msg: 'spam imediato' }); // < 1.2s: ignorada
    await sleep(500);
    const said = msgs.filter(m => !m.sys && m.nick === 'QA0');
    assert.equal(said.length, 1, `chegaram ${said.length} mensagens`);
    assert.ok(!said[0].msg.includes('<'), 'HTML passou no chat');
  });
});
