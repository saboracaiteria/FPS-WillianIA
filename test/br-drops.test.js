/* ================================================================
   QA — fluxo BR real no harness: drops de morte respeitam andares.
   (Partida de verdade: bot-host inicia, página joga em fase PLAY.)
   ================================================================ */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame, startBRMatch } = require('./helpers/harness');

describe('BR — drops de morte', { skip: !CHROME && 'Chrome não encontrado' }, () => {
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
