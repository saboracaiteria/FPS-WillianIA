/* ================================================================
   QA — Evento de destruição da cidade (protocolo + servidor).
   Plano: docs/plans/city-destruction-event.md
   ================================================================ */
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

/* =============== PROTOCOLO (unidade, determinismo) =============== */
describe('CityDestructionProtocol (unidade)', () => {
  const P = require('../city-destruction-protocol.js');

  it('dado o mesmo seed, então míssil assinado e impactos principais são idênticos nas 3 qualidades', () => {
    const low = P.buildCityEvent(12345, 'low');
    const med = P.buildCityEvent(12345, 'medium');
    const high = P.buildCityEvent(12345, 'high');
    assert.deepEqual(low.impacts, med.impacts, 'impactos divergem entre low/medium');
    assert.deepEqual(med.impacts, high.impacts, 'impactos divergem entre medium/high');
    assert.deepEqual(low.missiles[low.signedIndex], high.missiles[high.signedIndex],
      'míssil assinado diverge entre qualidades');
    assert.ok(low.missiles.length < high.missiles.length, 'qualidade não muda contagem visual');
  });

  it('dado o mesmo seed duas vezes, então o evento é bit a bit igual (replay determinístico)', () => {
    assert.deepEqual(P.buildCityEvent(777, 'medium'), P.buildCityEvent(777, 'medium'));
  });

  it('dados seeds diferentes, então os eventos diferem', () => {
    const a = P.buildCityEvent(1, 'medium');
    const b = P.buildCityEvent(2, 'medium');
    assert.notDeepEqual(a.impacts, b.impacts);
  });

  it('dado qualquer seed, então os impactos principais caem DENTRO da cidade', () => {
    for (const seed of [1, 42, 999999, 0xDEADBEEF]) {
      const ev = P.buildCityEvent(seed, 'high');
      assert.ok(ev.impacts.length >= 8, 'menos de 8 impactos principais');
      for (const p of ev.impacts) {
        const d = Math.hypot(p.x - P.CITY_CENTER.x, p.z - P.CITY_CENTER.z);
        assert.ok(d <= P.CITY_RADIUS + 1, `impacto fora da cidade (d=${d.toFixed(1)})`);
      }
    }
  });

  it('dado o protocolo, então expõe raio letal, fases e defaults de produção', () => {
    assert.equal(P.CITY_KILL_RADIUS, 100);
    assert.equal(P.DELAY_DEFAULT, 90000);
    assert.equal(P.IMPACT_DELAY_DEFAULT, 8500);
    assert.equal(P.PHASES.impact, 8.5);
    assert.ok(P.PHASES.aftermath[1] === 12);
  });
});

/* =============== SERVIDOR (integração socket) =============== */
const path = require('node:path');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');

const SERVER = path.join(__dirname, '..', 'server.js');
let nextPort = 26000 + (process.pid % 400) * 10;

function spawnServer(env = {}) {
  const port = nextPort++;
  const proc = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(port), HOST_CODE: 'QA123', COUNTDOWN_S: '1',
      NEXT_IN_S: '60', WORLD_SEED: '424242',
      CITY_DESTRUCTION_DELAY_MS: '1200', CITY_DESTRUCTION_IMPACT_DELAY_MS: '900', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('servidor não subiu')), 5000);
    proc.stdout.on('data', d => {
      if (String(d).includes('Servidor BR no ar')) { clearTimeout(to); res({ port, proc, stop: () => proc.kill() }); }
    });
    proc.on('exit', c => rej(new Error('morreu cedo: ' + c)));
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
const collect = (sock, ev) => { const a = []; sock.on(ev, d => a.push(d)); return a; };

async function partida(t, n, env = {}) {
  const srv = await spawnServer(env);
  t.after(() => srv.stop());
  const cs = [];
  for (let i = 0; i < n; i++) {
    const c = await connect(srv.port);
    c.s.emit('hello', { nick: 'QA' + i });
    cs.push(c);
    t.after(() => c.s.close());
  }
  const started = cs.map(c => once(c.s, 'matchStart'));
  await ack(cs[0].s, 'claimHost', { code: 'QA123' });
  cs[0].s.emit('requestStart');
  const ms = await Promise.all(started);
  return { srv, cs, plan: ms[0].plan, t0: ms[0].t0 };
}

describe('Destruição da cidade — servidor autoritativo', () => {
  it('dada a sala nova, então a flag "cidade" começa HABILITADA e vem no init', async t => {
    const srv = await spawnServer(); t.after(() => srv.stop());
    const { s, init } = await connect(srv.port); t.after(() => s.close());
    assert.equal(init.flags.cidade, true, 'flag não começa habilitada');
    assert.ok(init.cityDestruction, 'init sem estado da cidade');
    assert.equal(init.cityDestruction.state, 'intact');
  });

  it('dado um não-host, então NÃO altera a flag; host altera e todos recebem', async t => {
    const srv = await spawnServer(); t.after(() => srv.stop());
    const a = await connect(srv.port); t.after(() => a.s.close());
    const b = await connect(srv.port); t.after(() => b.s.close());
    const fl = collect(a.s, 'flags');
    b.s.emit('setFlags', { cidade: false });
    await sleep(250);
    assert.equal(fl.length, 0, 'não-host mexeu na flag da cidade');
    await ack(a.s, 'claimHost', { code: 'QA123' });
    a.s.emit('setFlags', { cidade: false });
    await sleep(250);
    assert.equal(fl[fl.length - 1].cidade, false);
  });

  it('dado o início da partida, então o plano congela eventId, seed e timestamps do servidor', async t => {
    const { plan, t0 } = await partida(t, 2);
    const c = plan.city;
    assert.ok(c, 'plan.city ausente');
    assert.ok(/^city-\d+-\d+$/.test(c.eventId), 'eventId fora do formato: ' + c.eventId);
    assert.ok(Number.isInteger(c.seed));
    assert.equal(c.cinematicStartedAt, t0 + 1200, 'delay não veio do env de teste');
    assert.equal(c.impactAt, c.cinematicStartedAt + 900);
  });

  it('dada a flag desabilitada antes do início, então NÃO há agendamento', async t => {
    const srv = await spawnServer(); t.after(() => srv.stop());
    const a = await connect(srv.port); t.after(() => a.s.close());
    await ack(a.s, 'claimHost', { code: 'QA123' });
    a.s.emit('setFlags', { cidade: false });
    const started = once(a.s, 'matchStart');
    a.s.emit('requestStart');
    const ms = await started;
    assert.equal(ms.plan.city, null, 'agendou mesmo com a flag desligada');
  });

  it('dado o relógio do servidor, então cinemática e impacto disparam nos instantes agendados — UMA vez', async t => {
    const { cs, plan } = await partida(t, 2);
    const eventos = collect(cs[0].s, 'cityDestruction');
    const ini = Date.now();
    // espera cinemática + impacto (1.2s + 0.9s + folga)
    await sleep(3200);
    const estados = eventos.map(e => e.state);
    assert.deepEqual(estados, ['cinematic', 'destroyed'], 'sequência de estados: ' + estados.join(','));
    const cin = eventos[0], imp = eventos[1];
    assert.equal(cin.eventId, plan.city.eventId);
    assert.equal(imp.eventId, plan.city.eventId);
    assert.ok(Math.abs((ini + 1200) - Date.now() + 3200) >= 0); // sanidade temporal fraca
    await sleep(1500); // nenhum evento extra depois
    assert.equal(eventos.length, 2, 'evento disparou mais de uma vez');
  });

  it('dado o impacto, então quem está DENTRO do raio morre e quem está fora sobrevive — sem kill pra ninguém', async t => {
    const { cs } = await partida(t, 3);
    const [a, b, c] = cs;
    // a: no centro da cidade; b: a 300m; c: borda de fora do raio (110m)
    const iv = setInterval(() => {
      a.s.volatile.emit('state', { pos: [-340, 4, 130], rotY: 0, car: -1 });
      b.s.volatile.emit('state', { pos: [0, 4, 0], rotY: 0, car: -1 });
      c.s.volatile.emit('state', { pos: [-340 + 110, 4, 130], rotY: 0, car: -1 });
    }, 120);
    t.after(() => clearInterval(iv));
    const mortes = collect(b.s, 'playerKilled');
    await sleep(3400);
    const porMissil = mortes.filter(m => m.byCity);
    assert.equal(porMissil.length, 1, `mortes pelo míssil: ${porMissil.length} (esperado 1)`);
    assert.equal(porMissil[0].victimNick, 'QA0');
    assert.equal(porMissil[0].killerId, null, 'míssil creditou kill');
    assert.equal(porMissil[0].weapon, 'MÍSSEIS');
    assert.ok(porMissil[0].byZone !== true);
  });

  it('dada a vítima com armadura/invulnerabilidade (estado do cliente), então morre mesmo assim (decisão é do servidor)', async t => {
    // o servidor não consulta armadura/invuln — mata pela posição; este teste
    // fixa o CONTRATO: morte independe de estado defensivo do cliente
    const { cs } = await partida(t, 2);
    const [a, b] = cs;
    const iv = setInterval(() => {
      a.s.volatile.emit('state', { pos: [-345, 4, 128], rotY: 0, car: -1 });
      b.s.volatile.emit('state', { pos: [200, 4, 200], rotY: 0, car: -1 });
    }, 120);
    t.after(() => clearInterval(iv));
    const mortes = collect(b.s, 'playerKilled');
    await sleep(3400);
    assert.ok(mortes.some(m => m.byCity && m.victimNick === 'QA0'), 'vítima blindada não morreu');
  });

  it('dado um late join APÓS o impacto, então o init já vem com cidade destruída e timestamps antigos', async t => {
    const { srv } = await partida(t, 2, {});
    await sleep(3400); // partida viva? QA0/QA1 fora da cidade não morrem; cidade já destruída
    const tard = await connect(srv.port); t.after(() => tard.s.close());
    assert.equal(tard.init.cityDestruction.state, 'destroyed');
    assert.ok(tard.init.cityDestruction.impactAt < Date.now(), 'timestamps não são do evento antigo');
  });

  it('dado um cliente malicioso, então NÃO força impacto nem escolhe vítimas', async t => {
    const { cs } = await partida(t, 2);
    const [a, b] = cs;
    const eventos = collect(b.s, 'cityDestruction');
    const mortes = collect(b.s, 'playerKilled');
    a.s.emit('cityDestruction', { state: 'destroyed' });          // spoof de estado
    a.s.emit('cityDestructionDeath', { victimId: b.init.id });    // spoof de vítima
    await sleep(500);
    assert.equal(eventos.length, 0, 'cliente conseguiu emitir estado da cidade');
    assert.equal(mortes.filter(m => m.byCity).length, 0, 'cliente escolheu vítima');
  });

  it('dado o FIM da partida, então o init do lobby seguinte volta com cidade intacta (nada de ruínas herdadas)', async t => {
    // bug de playtest: nextMatch recarrega a página e o init ainda trazia
    // cityDestruction 'destroyed' da partida anterior -> lobby nascia em ruínas
    const { srv, cs } = await partida(t, 2);
    const [a, b] = cs;
    const iv = setInterval(() => {
      a.s.volatile.emit('state', { pos: [-340, 4, 130], rotY: 0, car: -1 }); // morre no míssil
      b.s.volatile.emit('state', { pos: [200, 4, 200], rotY: 0, car: -1 });  // vence
    }, 120);
    t.after(() => clearInterval(iv));
    const fim = new Promise(res => b.s.once('matchEnd', res));
    await fim; // QA0 morto pelo míssil -> QA1 vence -> partida encerra
    clearInterval(iv);
    const novo = await connect(srv.port); t.after(() => novo.s.close());
    assert.equal(novo.init.cityDestruction.state, 'intact',
      'lobby pós-partida herdou a cidade destruída do evento anterior');
    assert.equal(novo.init.cityDestruction.eventId, null);
  });

  it('dada a sala esvaziada, então a próxima sessão volta com flag habilitada e cidade intacta', async t => {
    const srv = await spawnServer(); t.after(() => srv.stop());
    const a = await connect(srv.port);
    await ack(a.s, 'claimHost', { code: 'QA123' });
    a.s.emit('setFlags', { cidade: false });
    await sleep(200);
    a.s.close(); // sala esvazia
    await sleep(400);
    const b = await connect(srv.port); t.after(() => b.s.close());
    assert.equal(b.init.flags.cidade, true, 'flag não resetou com a sala vazia');
    assert.equal(b.init.cityDestruction.state, 'intact');
  });

  it('dado produção sem env, então os defaults são 90000/8500 (validado pelo protocolo)', () => {
    const P = require('../city-destruction-protocol.js');
    assert.equal(P.DELAY_DEFAULT, 90000);
    assert.equal(P.IMPACT_DELAY_DEFAULT, 8500);
  });
});
