/* ================================================================
   QA — Destruição da cidade no CLIENTE (harness Chrome headless).
   Parte A: Structures.city (mundo troca de verdade — visual+colisão).
   Parte B: cinemática + morte por míssil em partida BR real.
   Plano: docs/plans/city-destruction-event.md
   ================================================================ */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame, startBRMatch } = require('./helpers/harness');

describe('Structures.city — troca do mundo', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h;
  before(async () => { h = await bootGame({ port: 3179 }); });
  after(async () => { if (h) await h.close(); });
  const play = (fn, ...args) => h.play(fn, ...args);

  it('dada a interface, então expõe centro/raio/containsPoint e estado inicial intacto', async t => {
    const r = await play(() => {
      const c = window.QA.G.Structures.city;
      if (!c) return null;
      return {
        temTudo: !!(c.center && c.radius && c.containsPoint && c.destroy && c.restore && c.getState),
        estado: c.getState(),
        dentro: c.containsPoint(-340, 130),
        fora: c.containsPoint(0, 0),
      };
    });
    assert.ok(r, 'Structures.city não existe');
    assert.ok(r.temTudo, 'interface incompleta');
    assert.equal(r.estado, 'intact');
    assert.ok(r.dentro && !r.fora);
  });

  it('dado destroy(), então a parede original some (colisão em altura + bala) e o telhado deixa de ser pisável', async t => {
    const r = await play(() => {
      const QA = window.QA, G = QA.G, MP = QA.MP, P = MP.player;
      const city = G.Structures.city;
      if (!city) return null;
      const b = G.Structures.walls.find(w => w.city && (w.x1 - w.x0) > 8 && (w.y1 - w.y0) > 8);
      if (!b) return { semParede: true };
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      // ANTES: dentro do prédio a 4m de altura, o push-out cospe o jogador
      QA.reset(b.x0 - 4, cz);
      P.pos.set(cx, b.y0 + 4, cz); P.onGround = false; P.vel.set(0, 0, 0);
      QA.tick(2);
      const cuspidoAntes = Math.abs(P.pos.x - cx) > 1 || Math.abs(P.pos.z - cz) > 1;
      city.destroy();
      const estado = city.getState();
      // DEPOIS: mesma posição — nada empurra (escombro tem só 1,6m)
      P.pos.set(cx, b.y0 + 4, cz); P.onGround = false; P.vel.set(0, 0, 0);
      QA.tick(2);
      const livreDepois = Math.abs(P.pos.x - cx) < 1 && Math.abs(P.pos.z - cz) < 1;
      // bala a 3m de altura atravessa o footprint inteiro
      const THREE = MP.THREE;
      const hit = G.Structures.rayHit(new THREE.Vector3(b.x0 - 3, b.y0 + 3, cz),
        new THREE.Vector3(1, 0, 0), (b.x1 - b.x0) + 6);
      const balaPassa = hit === Infinity;
      // telhado deixou de ser plataforma
      const telhadoSumiu = MP.groundAt(cx, cz, b.y1 + 2) < b.y1 - 2;
      return { estado, cuspidoAntes, livreDepois, balaPassa, telhadoSumiu };
    });
    assert.ok(r && !r.semParede, 'sem prédio city testável');
    assert.equal(r.estado, 'destroyed');
    assert.ok(r.cuspidoAntes, 'pré-condição falhou: prédio intacto não empurrava (teste vazio)');
    assert.ok(r.livreDepois, 'parede fantasma ainda empurra após destroy');
    assert.ok(r.balaPassa, 'bala ainda bate na parede fantasma');
    assert.ok(r.telhadoSumiu, 'telhado destruído continua pisável');
  });

  it('dado destroy(), então os corpos CANNON da cidade saem do mundo físico (sem órfãos)', async t => {
    const r = await play(() => {
      const QA = window.QA, W = QA.MP.world, city = QA.G.Structures.city;
      city.restore(); // garante estado base
      const antes = W.bodies.length;
      city.destroy();
      const depois = W.bodies.length;
      city.restore();
      const devolta = W.bodies.length;
      return { antes, depois, devolta };
    });
    assert.ok(r.depois < r.antes - 5, `corpos não saíram (${r.antes} -> ${r.depois})`);
    assert.equal(r.devolta, r.antes, 'restore não devolveu os corpos');
  });

  it('dado destroy(), então o FORTE (fora da cidade) continua sólido', async t => {
    const r = await play(() => {
      const QA = window.QA, G = QA.G, P = QA.MP.player;
      const city = G.Structures.city;
      city.destroy();
      // parede NÃO-city testável (mesmo critério do findWall)
      const b = G.Structures.walls.find(w => {
        if (w.city || w.noCollide) return false;
        if ((w.x1 - w.x0) < 3 || (w.y1 - w.y0) < 2.2) return false;
        const cz2 = (w.z0 + w.z1) / 2;
        const ter = QA.MP.heightAt(w.x0 - 3, cz2);
        return Math.abs(ter - w.y0) < 0.8 && w.y1 > ter + 1.9 &&
          Math.abs(QA.MP.groundAt(w.x0 - 3, cz2, 999) - ter) < 0.5;
      });
      if (!b) return null;
      const cz2 = (w => (w.z0 + w.z1) / 2)(b);
      QA.reset(b.x0 - 3, cz2);
      QA.aimAt((b.x0 + b.x1) / 2, P.pos.y + 1.5, cz2);
      G.keys.KeyW = true;
      QA.tick(100);
      G.keys.KeyW = false;
      const barrado = P.pos.x <= b.x0 - P.radius + 0.2;
      city.restore();
      return { barrado };
    });
    if (!r) { t.skip('sem parede não-city testável'); return; }
    assert.ok(r.barrado, 'forte/estruturas fora da cidade perderam colisão junto');
  });

  it('dada a versão destruída, então ela existe desde o boot (invisível) e aparece no destroy', async t => {
    const r = await play(() => {
      const QA = window.QA, city = QA.G.Structures.city;
      city.restore();
      const ruinas = QA.MP.scene.getObjectByName('cidadeDestruida');
      if (!ruinas) return null;
      const antes = ruinas.visible;
      city.destroy();
      const durante = ruinas.visible;
      city.restore();
      return { antes, durante, depois: ruinas.visible, pecas: ruinas.children.length };
    });
    assert.ok(r, 'grupo cidadeDestruida não existe no boot');
    assert.equal(r.antes, false, 'ruínas visíveis antes do impacto');
    assert.equal(r.durante, true, 'ruínas não aparecem no destroy');
    assert.equal(r.depois, false);
    assert.ok(r.pecas >= 10, `versão destruída rala demais (${r.pecas} peças)`);
  });
});

/* =============== PARTE B: cinemática + morte (partida BR real) =============== */
describe('Cinemática — jogador fora do raio sobrevive e recupera o controle', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h, bot;
  before(async () => {
    h = await bootGame({ port: 3178, extraEnv: { COUNTDOWN_S: '1', NEXT_IN_S: '300',
      CITY_DESTRUCTION_DELAY_MS: '6000', CITY_DESTRUCTION_IMPACT_DELAY_MS: '2000' } });
    bot = await startBRMatch(h);
  });
  after(async () => { if (bot) bot.close(); if (h) await h.close(); });

  it('dada a timeline, então trava o jogador, destrói a cidade no impacto e devolve a câmera', async t => {
    const r = await h.play(async () => {
      const QA = window.QA, MP = QA.MP, G = QA.G, P = MP.player;
      const city = window.__BR_debug.S.plan && window.__BR_debug.S.plan.city;
      if (!city) return { semPlano: true };
      QA.reset(200, 200); // bem fora do raio letal
      const posAntes = [P.pos.x, P.pos.z];
      // espera a cinemática ligar (relógio do servidor)
      let t0 = performance.now();
      while (!MP.state.cinematic && performance.now() - t0 < 12000)
        await new Promise(r2 => setTimeout(r2, 150));
      const ligou = MP.state.cinematic === true;
      // input travado: segura W por 0,8s de tempo real
      G.keys.KeyW = true;
      await new Promise(r2 => setTimeout(r2, 800));
      G.keys.KeyW = false;
      const andou = Math.hypot(P.pos.x - posAntes[0], P.pos.z - posAntes[1]);
      // espera o fim da cinemática (impacto + aftermath)
      t0 = performance.now();
      while (MP.state.cinematic && performance.now() - t0 < 16000)
        await new Promise(r2 => setTimeout(r2, 200));
      const desligou = MP.state.cinematic === false;
      const estadoCidade = G.Structures.city.getState();
      // câmera devolvida ao FPS: perto da cabeça do jogador
      await new Promise(r2 => setTimeout(r2, 400));
      const dCam = MP.camera.position.distanceTo(
        new MP.THREE.Vector3(P.pos.x, P.pos.y + 1.62, P.pos.z));
      return { ligou, andou, desligou, estadoCidade, dCam: +dCam.toFixed(2), vivo: !P.dead };
    });
    assert.ok(r && !r.semPlano, 'partida sem plan.city');
    assert.ok(r.ligou, 'state.cinematic nunca ligou');
    assert.ok(r.andou < 0.5, `input vazou durante a cinemática (andou ${r.andou}m)`);
    assert.ok(r.desligou, 'cinemática nunca terminou');
    assert.equal(r.estadoCidade, 'destroyed', 'cidade não foi destruída no impacto');
    assert.ok(r.dCam < 3, `câmera não voltou pro jogador (d=${r.dCam})`);
    assert.ok(r.vivo, 'jogador FORA do raio morreu');
    assert.equal(h.pageErrors.length, 0, 'pageerrors: ' + h.pageErrors.join(' | '));
  });
});

describe('Morte por míssil — vítima dentro do raio + late join', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h, bot, bot2, bot2iv;
  before(async () => {
    h = await bootGame({ port: 3177, extraEnv: { COUNTDOWN_S: '1', NEXT_IN_S: '300',
      CITY_DESTRUCTION_DELAY_MS: '5000', CITY_DESTRUCTION_IMPACT_DELAY_MS: '1500' } });
    // 2º sobrevivente fora do raio: a vítima morre no míssil e a partida
    // precisa continuar VIVA (fim de partida agora reseta o evento — correto)
    const { io } = require('socket.io-client');
    bot2 = io('http://localhost:3177', { transports: ['websocket'] });
    await new Promise(r => bot2.once('init', r));
    bot2.emit('hello', { nick: 'Sentinela' });
    bot2.on('matchStart', () => {
      bot2iv = setInterval(() => bot2.emit('state', { pos: [250, 3, -250], rotY: 0, car: -1 }), 2000);
    });
    bot = await startBRMatch(h);
  });
  after(async () => {
    clearInterval(bot2iv);
    if (bot2) bot2.close();
    if (bot) bot.close();
    if (h) await h.close();
  });

  it('dado o jogador NA cidade, então morre com a mensagem oficial e sem kill creditada', async t => {
    const r = await h.play(async () => {
      const QA = window.QA, MP = QA.MP, P = MP.player;
      QA.reset(-340, 130); // centro da cidade
      P.armor = 50; P.invulnUntil = MP.state.gameTime + 999; // teste: defesas não salvam
      const iv = setInterval(() => { if (!P.dead) { P.pos.set(-340, P.pos.y, 130); } }, 300);
      const t0 = performance.now();
      while (!P.dead && performance.now() - t0 < 15000)
        await new Promise(r2 => setTimeout(r2, 200));
      clearInterval(iv);
      return {
        morreu: P.dead === true,
        mensagem: document.getElementById('deathSub').textContent,
        feed: document.getElementById('killfeed').innerHTML,
      };
    });
    assert.ok(r.morreu, 'vítima no centro da cidade sobreviveu ao míssil');
    assert.equal(r.mensagem, 'Você morreu atingido pelo ataque de mísseis próximo à cidade!');
    assert.ok(/ataque de mísseis à cidade/.test(r.feed), 'kill feed sem a mensagem do míssil');
  });

  it('dado um late join após o impacto, então a cidade JÁ nasce destruída e sem cinemática', async t => {
    // "depois" de verdade: espera a janela da cinemática fechar (impactAt + 3,5s)
    const impactAt = await h.play(() => window.__BR_debug.S.plan.city.impactAt);
    const falta = impactAt + 4000 - Date.now();
    if (falta > 0) await new Promise(r => setTimeout(r, falta));
    const page2 = await h.browser.newPage();
    t.after(() => page2.close());
    await page2.goto(`http://localhost:3177/`, { waitUntil: 'domcontentloaded' });
    await page2.waitForFunction('!!window.__game && !!window.__MP', { timeout: 60000 });
    const r = await page2.evaluate(async () => {
      const t0 = performance.now();
      while (window.__game.Structures.city.getState() !== 'destroyed' && performance.now() - t0 < 9000)
        await new Promise(r2 => setTimeout(r2, 150));
      return {
        estado: window.__game.Structures.city.getState(),
        cinematic: window.__MP.state.cinematic === true,
      };
    });
    assert.equal(r.estado, 'destroyed', 'late join não recebeu cidade destruída');
    assert.ok(!r.cinematic, 'late join reiniciou a cinemática');
  });
});

/* =============== MODO SOLO: sem servidor, evento local =============== */
describe('Modo solo — evento local de destruição sem servidor', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let srv, browser, page;
  before(async () => {
    // servidor ESTÁTICO puro (sem socket.io): o jogo cai no modo solo real
    const http = require('node:http');
    const fs = require('node:fs');
    const path = require('node:path');
    const root = path.join(__dirname, '..');
    const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    srv = http.createServer((req, res) => {
      const f = path.join(root, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
      fs.readFile(f, (e, d) => {
        if (e) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
        res.end(d);
      });
    }).listen(3176);
    const puppeteer = require('puppeteer-core');
    browser = await puppeteer.launch({
      executablePath: CHROME, headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
        '--use-gl=angle', '--use-angle=swiftshader', '--mute-audio', '--window-size=800,600'],
    });
    page = await browser.newPage();
    await page.goto('http://localhost:3176/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('!!window.__game && !!window.__MP && !!window.__CityDestruction',
      { timeout: 60000 });
  });
  after(async () => { if (browser) await browser.close(); if (srv) srv.close(); });

  it('dado o jogo solo, então o evento local roda a cinemática e destrói a cidade', async () => {
    const r = await page.evaluate(async () => {
      const G = window.__game, MP = window.__MP;
      if (MP.socket) return { temSocket: true }; // não é solo de verdade
      G.forceStart();
      // mesmo caminho do poll solo, com timestamps curtos pro teste
      const t0 = Date.now();
      window.__CityDestruction.sync({
        eventId: 'solo-teste', seed: 424242, state: 'intact',
        cinematicStartedAt: t0 + 700, impactAt: t0 + 2400,
      });
      const espera = async (cond, ms) => {
        const i0 = performance.now();
        while (!cond() && performance.now() - i0 < ms)
          await new Promise(r2 => setTimeout(r2, 100));
        return cond();
      };
      const ligou = await espera(() => MP.state.cinematic === true, 8000);
      const destruiu = await espera(() => G.Structures.city.getState() === 'destroyed', 8000);
      const desligou = await espera(() => MP.state.cinematic === false, 16000);
      return { temSocket: false, ligou, destruiu, desligou, vivo: !MP.player.dead };
    });
    assert.ok(!r.temSocket, 'página estática ainda conectou socket (não é solo)');
    assert.ok(r.ligou, 'cinemática solo nunca ligou');
    assert.ok(r.destruiu, 'cidade não foi destruída no solo');
    assert.ok(r.desligou, 'cinemática solo não terminou');
    assert.ok(r.vivo, 'evento solo matou o jogador local (dano é só do servidor)');
  });
});
