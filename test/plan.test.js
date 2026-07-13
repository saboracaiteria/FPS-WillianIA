/* ================================================================
   QA — testes de UNIDADE da lógica pura do servidor (sem rede).
   buildPlan/zoneAt/rollChest exportados por server.js; o require
   não abre porta (listen só roda com node server.js direto).
   ================================================================ */
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildPlan, zoneAt, rollChest, mulberry32, LIM, rankEntry, pruneRank, topRank } = require('../server.js');

describe('Plano da partida (unidade)', () => {
  it('dado 300 seeds diferentes, então o plano é sempre válido e a zona nunca vaza do mapa', () => {
    for (let i = 1; i <= 300; i++) {
      const plan = buildPlan((i * 2654435761) >>> 0);
      assert.equal(plan.zone.length, 5);
      let prevT = 0;
      plan.zone.forEach((ph, j) => {
        assert.ok(ph.r1 < ph.r0, `fase ${j}: raio não encolhe`);
        assert.ok(ph.tWaitEnd > prevT && ph.tShrinkEnd > ph.tWaitEnd, `fase ${j}: tempos fora de ordem`);
        prevT = ph.tShrinkEnd;
        assert.ok(Math.abs(ph.nx) <= LIM && Math.abs(ph.nz) <= LIM, `fase ${j}: centro fora do mapa`);
        // o próximo círculo precisa caber DENTRO do atual (senão safe teleporta)
        const d = Math.hypot(ph.nx - ph.cx, ph.nz - ph.cz);
        assert.ok(d + ph.r1 <= ph.r0 + 1e-6, `seed ${i} fase ${j}: círculo vaza (d=${d.toFixed(1)})`);
        assert.ok(ph.dps > 0);
      });
      assert.ok(plan.ship.flyTime > 0 && plan.ship.alt > 100);
      assert.ok(plan.boss.hp > 0);
    }
  });

  it('dado o tempo passando, então zoneAt só encolhe e termina no círculo final', () => {
    const plan = buildPlan(12345);
    let last = Infinity;
    for (let t = 0; t <= 900; t += 2) {
      const z = zoneAt(t, plan);
      assert.ok(Number.isFinite(z.x) && Number.isFinite(z.z) && z.dps > 0, `t=${t}: zona inválida`);
      assert.ok(z.r <= last + 1e-6, `t=${t}: raio CRESCEU (${last.toFixed(1)} -> ${z.r.toFixed(1)})`);
      last = z.r;
    }
    const end = zoneAt(99999, plan);
    assert.equal(end.r, plan.zone[4].r1);
    assert.ok(end.dps > plan.zone[4].dps, 'zona final deveria doer mais');
  });
});

describe('Loot dos baús (unidade)', () => {
  it('dados 500 baús, então todo item tem tipo conhecido, valores sãos e toda raridade aparece', () => {
    const rng = mulberry32(999);
    const types = new Set(), rarities = new Set();
    for (let i = 0; i < 500; i++) {
      const items = rollChest(rng);
      assert.ok(items.length >= 1, 'baú vazio');
      for (const it of items) {
        types.add(it.type);
        assert.ok(['ammo', 'weapon', 'med', 'armor'].includes(it.type), 'tipo desconhecido: ' + it.type);
        if (it.type === 'weapon') {
          rarities.add(it.rarity);
          // arsenal atual: 0-3 clássicas + 6 (SNIPER AGULHA) e 7 (ESCOPETA RAJADA);
          // 4 (plasma) é exclusivo do boss e 5 é a faca — nunca vêm de baú
          assert.ok([0, 1, 2, 3, 6, 7].includes(it.weapon), 'índice de arma inválido: ' + it.weapon);
          assert.ok(it.ammo > 0, 'arma sem munição');
        }
        if (it.type === 'ammo') assert.ok(it.amount > 0 && it.amount <= 200);
        if (it.type === 'armor') assert.ok(it.amount > 0 && it.amount <= 100);
      }
    }
    for (const t of ['ammo', 'weapon', 'med', 'armor']) assert.ok(types.has(t), `nunca saiu ${t}`);
    for (const r of ['incomum', 'raro', 'épico', 'lendário']) assert.ok(rarities.has(r), `nunca saiu arma ${r}`);
  });
});

describe('Ranking global (unidade)', () => {
  it('dado RANK_FILE no ambiente, então o servidor persiste o ranking nesse caminho (volume do deploy)', () => {
    const os = require('node:os');
    const path = require('node:path');
    const fs = require('node:fs');
    const alvo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rank-')), 'rank.json');
    const { execSync } = require('node:child_process');
    // processo limpo: RANK_FILE é lido no carregamento do módulo
    // (execPath entre aspas: no Windows o node mora em "C:\Program Files\...")
    const out = execSync(JSON.stringify(process.execPath) +
      ' -e "const s=require(\'./server.js\'); s.rankEntry(\'Env\').points=7; s.saveRankNow(); console.log(\'ok\')"',
      { cwd: path.join(__dirname, '..'), env: { ...process.env, RANK_FILE: alvo }, encoding: 'utf8' });
    assert.match(out, /ok/);
    const salvo = JSON.parse(fs.readFileSync(alvo, 'utf8'));
    assert.equal(salvo['env'] ? salvo['env'].points : salvo['Env'].points, 7);
  });

  it('dado um ranking inflado por 1200 nicks, então o prune segura em 500 e preserva o topo', () => {
    // pontos MUITO acima de qualquer jogador real: o br-rank.json do disco é
    // carregado junto e não pode disputar o topo com os nicks do teste
    for (let i = 0; i < 1200; i++) rankEntry('Inflado' + i).points = 100000 + i;
    const restaram = pruneRank();
    assert.equal(restaram, 500);
    const top = topRank(3);
    assert.equal(top[0].points, 101199, 'prune jogou fora o líder');
  });
});
