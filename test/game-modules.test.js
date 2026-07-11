/* ================================================================
   QA — specs dos módulos do jogo (js/*.js) rodando em Node.
   Protegem a refatoração: determinismo do terreno (multiplayer),
   grade de altura ≈ analítica, contratos dos módulos puros.
   ================================================================ */
'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

/* mesmo gerador seedado que o jogo usa no lugar do Math.random */
function seedRandom(seed) {
  let s = seed >>> 0;
  const orig = Math.random;
  Math.random = function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => { Math.random = orig; };
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

describe('Terreno (js/terrain.js)', () => {
  let createTerrain;
  beforeEach(async () => {
    ({ createTerrain } = await import('../js/terrain.js'));
  });

  it('dada a mesma seed, então dois "clientes" geram exatamente o mesmo terreno', () => {
    const restore1 = seedRandom(12345);
    const t1 = createTerrain({ lerp, clamp });
    restore1();
    const restore2 = seedRandom(12345);
    const t2 = createTerrain({ lerp, clamp });
    restore2();
    for (let i = 0; i < 200; i++) {
      const x = (i * 37) % 1000 - 500, z = (i * 91) % 1000 - 500;
      assert.equal(t1.heightAt(x, z), t2.heightAt(x, z), `divergiu em (${x},${z})`);
      assert.equal(t1.biomeAt(x, z), t2.biomeAt(x, z));
    }
  });

  it('dadas seeds diferentes, então os terrenos são diferentes', () => {
    const r1 = seedRandom(111); const t1 = createTerrain({ lerp, clamp }); r1();
    const r2 = seedRandom(222); const t2 = createTerrain({ lerp, clamp }); r2();
    let dif = 0;
    for (let i = 0; i < 50; i++) {
      if (t1.heightAt(i * 20 - 500, i * 13) !== t2.heightAt(i * 20 - 500, i * 13)) dif++;
    }
    assert.ok(dif > 40, 'terrenos iguais com seeds diferentes?');
  });

  it('dada a grade de altura (PERF), então ela casa com a analítica no mundo todo', () => {
    const r = seedRandom(777);
    const t = createTerrain({ lerp, clamp });
    r();
    t.buildHeightGrid(1100);
    let worst = 0;
    for (let i = 0; i < 800; i++) {
      const x = (Math.sin(i * 12.9898) * 43758.5453 % 1) * 1000 - 500;
      const z = (Math.sin(i * 78.233) * 12543.21 % 1) * 1000 - 500;
      const d = Math.abs(t.heightAt(x, z) - t.heightAnalytic(x, z));
      if (d > worst) worst = d;
    }
    assert.ok(worst < 0.75, `grade desvia ${worst.toFixed(3)}m da analítica`);
  });

  it('dada uma plataforma, então groundAt sobe até ela só quando alcançável', () => {
    const r = seedRandom(42);
    const t = createTerrain({ lerp, clamp });
    r();
    const base = t.heightAt(300, 300);
    t.platforms.push({ x0: 295, x1: 305, z0: 295, z1: 305, y: base + 3 });
    assert.equal(t.groundAt(300, 300, base + 3.2), base + 3);   // em cima: pisa
    assert.equal(t.groundAt(300, 300, base + 0.2), base);        // embaixo: chão
    assert.equal(t.groundAt(400, 400, base + 3.2), t.heightAt(400, 400)); // fora
  });

  it('dado o hash de obstáculos, então só devolve círculos das células vizinhas', () => {
    const r = seedRandom(7);
    const t = createTerrain({ lerp, clamp });
    r();
    t.addObstacle(100, 100, 1);
    t.addObstacle(500, 500, 1);
    const near = t.obstaclesNear(102, 99);
    assert.equal(near.length, 1);
    assert.equal(near[0].x, 100);
  });
});

describe('Config e utils (js/config.js, js/utils.js)', () => {
  it('dado o CFG, então os campos que o jogo inteiro usa existem', async () => {
    const { CFG, SETTINGS } = await import('../js/config.js');
    for (const k of ['WORLD_SIZE', 'VIEW_DIST', 'TREE_COUNT', 'GRASS_TOTAL', 'EXPOSURE'])
      assert.ok(Number.isFinite(CFG[k]), `CFG.${k} sumiu`);
    for (const k of ['vol', 'res', 'shadow', 'bloom', 'ping'])
      assert.ok(k in SETTINGS, `SETTINGS.${k} sumiu`);
  });

  it('dadas as utilidades, então clamp/lerp/damp/rand se comportam', async () => {
    const u = await import('../js/utils.js');
    assert.equal(u.clamp(5, 0, 3), 3);
    assert.equal(u.lerp(0, 10, 0.5), 5);
    assert.ok(u.damp(0, 10, 8, 1 / 60) > 0);
    const r = u.rand(2, 4);
    assert.ok(r >= 2 && r < 4);
    assert.ok(u._v1.isVector3 && u.chaseCamPos.isVector3);
  });
});
