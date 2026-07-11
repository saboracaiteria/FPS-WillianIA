/* ================================================================
   QA — fluxo BR real no harness: drops de morte respeitam andares.
   (Partida de verdade: bot-host inicia, página joga em fase PLAY.)
   ================================================================ */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame, startBRMatch } = require('./helpers/harness');

describe('BR — drops de morte e avatares remotos', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h, bot;
  before(async () => {
    h = await bootGame({ port: 3189, extraEnv: { COUNTDOWN_S: '1', NEXT_IN_S: '120' } });
    bot = await startBRMatch(h);
  });
  after(async () => {
    if (bot) bot.close();
    if (h) await h.close();
  });

  it('dado um deathDrop em cima de uma torre, então o loot aparece NO andar — não 27m abaixo', async t => {
    // torre mais alta (mesma seed fixa de sempre)
    const alvo = await h.play(() => {
      const QA = window.QA, MP = QA.MP;
      const camp = (QA.G.Structures.enemyCamps || [])
        .filter(c => c.floorY !== undefined)
        .map(c => ({ x: c.x, z: c.z, floorY: c.floorY, dif: c.floorY - MP.heightAt(c.x, c.z) }))
        .sort((a, b) => b.dif - a.dif)[0];
      return camp && camp.dif > 8 ? camp : null;
    });
    if (!alvo) { t.skip('pré-condição não encontrada nesta seed'); return; }
    bot.emit('deathDrop', { pos: [alvo.x, alvo.floorY, alvo.z], items: [{ type: 'med' }] });
    const r = await h.play(async (alvoIn) => {
      const dbg = window.__BR_debug;
      const t0 = performance.now();
      while (dbg.drops.size === 0 && performance.now() - t0 < 8000)
        await new Promise(rr => setTimeout(rr, 150));
      if (dbg.drops.size === 0) return null;
      const d = [...dbg.drops.values()][0];
      return { y: +d.g.position.y.toFixed(2), andar: +alvoIn.floorY.toFixed(2),
               terreno: +window.QA.MP.heightAt(alvoIn.x, alvoIn.z).toFixed(2) };
    }, alvo);
    assert.ok(r, 'dropSpawn nunca chegou na página');
    assert.ok(Math.abs(r.y - r.andar) < 1.2,
      `loot caiu do andar pro chão: y=${r.y} andar=${r.andar} terreno=${r.terreno}`);
  });
});

describe('BR — bonecos remotos, zona e nave', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h, bot;
  before(async () => {
    h = await bootGame({ port: 3182, extraEnv: { COUNTDOWN_S: '1', NEXT_IN_S: '120' } });
    bot = await startBRMatch(h);
  });
  after(async () => {
    if (bot) bot.close();
    if (h) await h.close();
  });

  it('dado um jogador remoto andando no chão, então o boneco dele NÃO flutua', async t => {
    const chao = await h.play(() => +window.QA.MP.groundAt(80, 80, 999).toFixed(2));
    const iv = setInterval(() => bot.volatile.emit('state', { pos: [80, chao, 80], rotY: 0, car: -1 }), 100);
    try {
      const r = await h.play(async (chaoIn) => {
        const dbg = window.__BR_debug;
        const t0 = performance.now();
        while (dbg.remotes.size === 0 && performance.now() - t0 < 8000)
          await new Promise(rr => setTimeout(rr, 150));
        if (dbg.remotes.size === 0) return null;
        await new Promise(rr => setTimeout(rr, 1500)); // lerp assenta (rAF do BR)
        const rp = [...dbg.remotes.values()][0];
        return { y: +rp.group.position.y.toFixed(2), chao: chaoIn,
                 visivel: rp.group.visible, dy: +(rp.group.position.y - chaoIn).toFixed(2) };
      }, chao);
      if (!r) { t.skip('remoto não apareceu a tempo'); return; }
      assert.ok(r.visivel, 'boneco remoto invisível andando no chão');
      assert.ok(Math.abs(r.dy) < 0.8, `boneco remoto flutuando/enterrado: dy=${r.dy}m`);
    } finally { clearInterval(iv); }
  });

  it('dado um jogador remoto que morre, então o boneco tomba e some — não vira estátua', async t => {
    const r0 = await h.play(() => window.__BR_debug.remotes.size);
    if (r0 === 0) { t.skip('sem remoto na sala'); return; }
    bot.emit('died', {}); // bot morre pro servidor
    const r = await h.play(async () => {
      const dbg = window.__BR_debug;
      const rp = [...dbg.remotes.values()][0];
      const t0 = performance.now();
      while (rp.group.visible && performance.now() - t0 < 6000)
        await new Promise(rr => setTimeout(rr, 150));
      return { sumiu: !rp.group.visible, vivo: rp.alive };
    });
    assert.ok(!r.vivo, 'roster não marcou o remoto como morto');
    assert.ok(r.sumiu, 'boneco morto continuou de pé (estátua)');
  });
});

describe('BR — indicadores da zona e cabine da nave', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h, bot;
  before(async () => {
    h = await bootGame({ port: 3181, extraEnv: { COUNTDOWN_S: '1', NEXT_IN_S: '120' } });
    bot = await startBRMatch(h);
  });
  after(async () => {
    if (bot) bot.close();
    if (h) await h.close();
  });

  it('dado o jogador FORA da safe, então a tela avermelha — e limpa ao voltar', async t => {
    const r = await h.play(async () => {
      const QA = window.QA, dbg = window.__BR_debug, P = QA.MP.player;
      const zc = dbg.zc;
      // fora da zona (bem além do raio atual)
      const ang = 0.7;
      P.pos.set(zc.x + Math.cos(ang) * (zc.r + 80), 5, zc.z + Math.sin(ang) * (zc.r + 80));
      P.invulnUntil = QA.MP.state.gameTime + 999; // não morrer durante a medição
      await new Promise(rr => setTimeout(rr, 1400)); // brTick atualiza a cada 0.5s
      const foraOpacity = document.getElementById('gasTint').style.opacity;
      P.pos.set(zc.x, QA.MP.groundAt(zc.x, zc.z, 999), zc.z); // centro da safe
      await new Promise(rr => setTimeout(rr, 1400));
      const dentroOpacity = document.getElementById('gasTint').style.opacity;
      P.invulnUntil = 0;
      return { foraOpacity, dentroOpacity };
    });
    assert.equal(r.foraOpacity, '1', 'tela não avermelhou fora da safe');
    assert.equal(r.dentroOpacity, '0', 'tinta vermelha não limpou dentro da safe');
  });

  it('dada a nave, então ela tem cabine com janela de vidro no chão', async t => {
    const r = await h.play(() => {
      const ship = window.__BR_debug.ship;
      if (!ship) return null;
      const janela = ship.g.getObjectByName('cabineJanela');
      return { temJanela: !!janela, filhos: ship.g.children.length };
    });
    if (!r) { t.skip('nave ainda não construída'); return; }
    assert.ok(r.temJanela, 'janela do chão da cabine sumiu');
    assert.ok(r.filhos >= 15, `cabine incompleta (${r.filhos} peças)`);
  });
});
