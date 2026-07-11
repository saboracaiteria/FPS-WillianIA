/* ================================================================
   QA — INVARIANTE DAS ENTIDADES: nenhum "boneco" voando ou enterrado.
   Varre inimigos, animais, pickups, veículos e bosses comparando o y
   de cada um com o chão real (groundAt) — no spawn e depois de 5s de
   IA ligada andando. Reporta TODOS os violadores, não só o primeiro.
   ================================================================ */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame } = require('./helpers/harness');

describe('Entidades no chão (ninguém voando/enterrado)', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h;
  before(async () => { h = await bootGame({ port: 3185 }); });
  after(async () => { if (h) await h.close(); });

  const coleta = () => h.play(() => {
    const QA = window.QA, G = QA.G, MP = QA.MP;
    const chao = (x, z, y) => MP.groundAt(x, z, y + 2);
    const out = [];
    const checa = (grupo, nome, x, z, y, minDy, maxDy) => {
      const dy = y - chao(x, z, y);
      if (dy < minDy || dy > maxDy)
        out.push({ grupo, nome, x: +x.toFixed(1), z: +z.toFixed(1), dy: +dy.toFixed(2) });
    };
    for (const e of G.Enemies.list) {
      if (!e.alive) continue;
      checa('inimigo', e.name, e.group.position.x, e.group.position.z, e.group.position.y, -0.8, 1.5);
    }
    for (const a of (G.Animals.list || [])) {
      const p = a.group ? a.group.position : null;
      if (!p) continue;
      checa('animal', a.predator ? 'lobo' : 'veado', p.x, p.z, p.y, -1.0, 1.5);
    }
    for (const p of G.Pickups.actives())
      checa('pickup', p.type, p.root.position.x, p.root.position.z, p.root.position.y, -0.5, 1.5);
    G.Car.vehicles.forEach((v, i) =>
      checa('veículo', 'carro' + i, v.chassisBody.position.x, v.chassisBody.position.z,
        v.chassisBody.position.y, 0.1, 2.4));
    for (const B of G.Bosses) {
      if (!B.alive) continue;
      checa('boss', B.name, B.pos().x, B.pos().z, B.pos().y, -1.2, 3.5);
    }
    return out;
  });

  it('dado o mundo recém-gerado, então todas as entidades nascem no chão', async () => {
    await h.play(() => window.QA.tick(60)); // física assenta
    const v = await coleta();
    assert.deepEqual(v, [], `entidades fora do chão no spawn:\n${JSON.stringify(v, null, 1)}`);
  });

  it('dados 5s de IA andando pelo mapa, então ninguém termina voando/enterrado', async () => {
    const v = await h.play(() => {
      const QA = window.QA;
      window.__BR_active = false;      // liga a IA (inimigos patrulham/perseguem)
      QA.reset(40, 40);                // dá um alvo pra IA reagir
      QA.tick(300);
      window.__BR_active = true;
      return null;
    }).then(coleta);
    assert.deepEqual(v, [], `entidades fora do chão após IA andar:\n${JSON.stringify(v, null, 1)}`);
  });
});
