/* Modelos 3D dos assets novos: armas em primeira pessoa, corpo do jogador
   rigado (helldiver), Guardião nos inimigos e alien no Visitante.
   Node puro: valida os arquivos GLB; Chrome: valida a integração viva. */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { CHROME, bootGame } = require('./helpers/harness.js');

const MODELS = path.join(__dirname, '..', 'assets', 'models');

function glbJson(p) {
  const buf = fs.readFileSync(p);
  assert.equal(buf.readUInt32LE(0), 0x46546c67, p + ' não é GLB');
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.slice(20, 20 + len).toString('utf8'));
}

describe('Arquivos GLB dos assets', () => {
  it('dado o helldiver, então tem rig completo com dedos e sem cabeça extra', () => {
    const g = glbJson(path.join(MODELS, 'Personagens', 'low_poly_helldiver_rig.glb'));
    assert.ok(g.skins && g.skins[0].joints.length >= 50, 'rig com 51 ossos esperado');
    const names = g.nodes.map(n => n.name || '');
    for (const frag of ['Hand.L', 'Hand.R', 'Finger_1.L', 'Finger_1.R', 'Arm_1.L', 'Arm_2.R', 'Head'])
      assert.ok(names.some(n => n.includes(frag)), 'osso ausente: ' + frag);
  });
  it('dado o Guardião, então traz as animações Punch/Shoot/Walk e a arma embutida', () => {
    const g = glbJson(path.join(MODELS, 'Personagens', 'Guardiao.glb'));
    const anims = (g.animations || []).map(a => a.name);
    assert.deepEqual(anims.sort(), ['Punch', 'Shoot', 'Walk']);
    const names = g.nodes.map(n => n.name || '');
    assert.ok(names.some(n => n.includes('MuzzleFlash')), 'nó do flash ausente');
  });
  it('dado o alien otimizado, então preserva o rig e a Take 001 abaixo de 1.5MB', () => {
    const p = path.join(MODELS, 'Personagens', 'alien.optimized.glb');
    assert.ok(fs.statSync(p).size < 1.5 * 1024 * 1024, 'alien otimizado grande demais');
    const g = glbJson(p);
    assert.ok(g.skins && g.skins[0].joints.length >= 50, 'rig perdido na otimização');
    assert.ok((g.animations || []).some(a => a.name === 'Take 001'), 'animação perdida');
  });
  it('dada a bazuca otimizada, então cabe em 1MB', () => {
    assert.ok(fs.statSync(path.join(MODELS, 'Armas', 'bazooka.optimized.glb')).size < 1024 * 1024);
  });
  it('dada a sniper leve, então traz as animações embutidas de recarga/ferrolho', () => {
    const g = glbJson(path.join(MODELS, 'Armas', 'low-poly_sniper_Rápida_Fraca.glb'));
    const anims = (g.animations || []).map(a => a.name).sort();
    assert.deepEqual(anims, ['bolt_slide', 'reload']);
  });
});

describe('Integração viva dos modelos', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h;
  before(async () => { h = await bootGame({ port: 3218 }); });
  after(async () => { if (h) await h.close(); });

  it('dado o jogo carregado, então armas GLB, corpo FP, Guardião e alien ficam prontos', async () => {
    const r = await h.play(async () => {
      const G = window.QA.G;
      await G.WeaponModels.ready;
      for (let i = 0; i < 100 && !(G.FpBody.ready || G.FpBody.failed); i++)
        await new Promise(rs => setTimeout(rs, 100));
      for (let i = 0; i < 100 && !G.Enemies.list.some(e => e.hasModel); i++)
        await new Promise(rs => setTimeout(rs, 100));
      return {
        armas: G.WeaponModels.status(),
        fpPronto: G.FpBody.ready,
        fpFalhou: G.FpBody.failed,
        arsenalTotal: G.arsenal.length,
        guardioes: G.Enemies.list.filter(e => e.hasModel).length,
        executivosProcedurais: G.Enemies.list.filter(e => e.suit && !e.hasModel).length >= 0,
      };
    });
    for (const a of r.armas) assert.equal(a.status, 'ready', `arma ${a.idx} não carregou: ${a.url}`);
    assert.equal(r.fpPronto, true, 'corpo FP (helldiver) não ficou pronto');
    assert.equal(r.fpFalhou, false);
    assert.equal(r.arsenalTotal, 8, 'arsenal deveria ter 8 armas (6 antigas + sniper leve + escopeta rajada)');
    assert.ok(r.guardioes >= 10, `esperava >=10 Guardiões com modelo, veio ${r.guardioes}`);
    assert.deepEqual(h.pageErrors, [], 'erros de página: ' + h.pageErrors.join(' | '));
  });

  it('dado um tiro com a sniper nova, então mag/bolt do GLB estão religados nas âncoras', async () => {
    const r = await h.play(() => {
      const G = window.QA.G;
      G.arsenal[6].locked = false;
      G.switchWeapon(6);
      const gun = G.gun;
      const magNode = gun.parts.mag && gun.parts.mag.children.some(c => /mag/i.test(c.name));
      const boltNode = gun.parts.bolt && gun.parts.bolt.children.some(c => /bolt/i.test(c.name));
      return { nome: gun.name, magNode, boltNode, temAnims: !!G.WeaponModels.status().find(s => s.idx === 6) };
    });
    assert.equal(r.nome, 'SNIPER "AGULHA"');
    assert.ok(r.magNode, 'pente do GLB não foi religado na âncora animada');
    assert.ok(r.boltNode, 'ferrolho do GLB não foi religado na âncora animada');
  });
});
