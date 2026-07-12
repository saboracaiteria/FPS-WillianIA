/* Integração dos modelos GLB dos veículos: carregamento, normalização e orçamento. */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame } = require('./helpers/harness');

describe('Modelos 3D dos veículos', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h;
  before(async () => { h = await bootGame({ port: 3195 }); });
  after(async () => { if (h) await h.close(); });

  it('carrega os três GLBs normalizados com geometria compartilhada e custo limitado', async () => {
    const report = await h.play(async () => {
      const Car = window.QA.G.Car;
      if (!Car.ready) return { hasReady: false };
      await Car.ready;

      const geometries = new Set();
      let uniqueVertices = 0;
      const vehicles = Car.vehicles.map(v => {
        let importedMeshes = 0;
        let mappedMaterials = 0;
        let standardMaterials = 0;
        const floorNodes = [];
        v.group.traverse(obj => {
          if (/^floor$/i.test(obj.name)) floorNodes.push(obj.name);
          if (!obj.isMesh || !obj.userData.importedCarModel) return;
          importedMeshes++;
          const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
          mappedMaterials += materials.filter(m => m && m.map).length;
          standardMaterials += materials.filter(m => m && m.isMeshStandardMaterial).length;
          if (!geometries.has(obj.geometry)) {
            geometries.add(obj.geometry);
            uniqueVertices += obj.geometry.attributes.position.count;
          }
        });
        return {
          status: v.modelStatus,
          error: v.modelError,
          url: v.modelUrl,
          importedMeshes,
          mappedMaterials,
          standardMaterials,
          floorNodes,
          metrics: v.modelMetrics,
          collider: { x: v.cfg.half[0] * 2, z: v.cfg.half[2] * 2 },
          modelYaw: v.cfg.modelYaw,
          groundOffset: -(v.cfg.wheelR + v.cfg.half[1] + 0.32),
        };
      });
      return {
        hasReady: true, vehicles, uniqueVertices, uniqueGeometries: geometries.size,
        hooks: {
          render: typeof window.render_game_to_text === 'function',
          advance: typeof window.advanceTime === 'function',
        },
      };
    });

    assert.equal(report.hasReady, true, 'Car.ready não foi exposto');
    assert.ok(report.vehicles.length >= 3, 'frota incompleta');
    assert.deepEqual([...new Set(report.vehicles.map(v => v.url))].sort(), [
      '/assets/models/gumball-car.optimized.glb',
      '/assets/models/mazda-rx7.v2.glb',
      '/assets/models/truck-drifter.optimized.glb',
    ]);
    for (const v of report.vehicles) {
      assert.equal(v.status, 'ready', `modelo não carregou: ${v.url} (${v.error || 'sem detalhe'})`);
      assert.ok(v.importedMeshes > 0 && v.importedMeshes <= 16,
        `${v.url} usa ${v.importedMeshes} malhas importadas`);
      assert.deepEqual(v.floorNodes, [], `${v.url} manteve piso auxiliar`);
      assert.ok(Math.abs(v.metrics.sizeX - v.collider.x * 0.98) < 0.06,
        `${v.url} não acompanha o comprimento do collider`);
      assert.ok(Math.abs(v.metrics.sizeZ - v.collider.z * 0.98) < 0.06,
        `${v.url} não acompanha a largura do collider`);
      assert.ok(Math.abs(v.metrics.minY - v.groundOffset) < 0.04,
        `${v.url} não foi apoiado no chão`);
      if (v.url.endsWith('/mazda-rx7.v2.glb')) {
        assert.ok(Math.abs(v.modelYaw - Math.PI) < 1e-6, 'RX-7 está com a traseira apontada para +X');
        // derivado v2: cores reais do modelo (emissive->baseColor), materiais iluminados
        assert.ok(v.standardMaterials > 0, 'RX-7 sem material iluminado');
      }
    }
    // orçamento: o RX-7 v2 preserva os materiais reais (sem palette destrutiva)
    // ao custo de ~2k vértices a mais — ainda irrisório perto do mundo
    assert.ok(report.uniqueVertices <= 60000,
      `geometria única acima do orçamento: ${report.uniqueVertices} vértices`);
    assert.deepEqual(report.hooks, { render: true, advance: true },
      'hooks determinísticos do playtest não foram expostos');
    assert.deepEqual(h.pageErrors, [], `erros de página: ${h.pageErrors.join('\n')}`);
  });
});


describe('Veículos assentados e com as cores do modelo', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h;
  before(async () => { h = await bootGame({ port: 3194 }); });
  after(async () => { if (h) await h.close(); });

  it('dado o mundo com física assentada, então nenhum carro fica enterrado no chão', async () => {
    const r = await h.play(async () => {
      const G = window.QA.G, MP = window.QA.MP, THREE = MP.THREE;
      await G.Car.ready;
      window.QA.tick(300); // 5s de física: suspensão assenta e o alinhamento roda
      return G.Car.vehicles.map(v => {
        const box = new THREE.Box3().setFromObject(v.group);
        const solo = MP.heightAt(v.group.position.x, v.group.position.z);
        return { tipo: v.cfg.name, fundoVsSolo: +(box.min.y - solo).toFixed(2) };
      });
    });
    for (const v of r) {
      assert.ok(v.fundoVsSolo > -0.25, `${v.tipo} enterrado ${v.fundoVsSolo}m no chão`);
      assert.ok(v.fundoVsSolo < 0.6, `${v.tipo} flutuando ${v.fundoVsSolo}m acima do chão`);
    }
  });

  it('dados os DOIS esportivos, então cada um tem lataria de cor própria (vidros/rodas preservados)', async () => {
    const r = await h.play(async () => {
      const G = window.QA.G;
      await G.Car.ready;
      const esportivos = G.Car.vehicles.filter(x => x.cfg.name === 'ESPORTIVO GT');
      return esportivos.map(v => {
        let lataria = null, outros = 0;
        v.group.traverse(o => {
          if (!o.isMesh || !o.userData.importedCarModel) return;
          const m = o.material;
          if (m.name === v.cfg.bodyMaterial) lataria = m.color.getHexString();
          else outros++;
        });
        return { lataria, outros };
      });
    });
    assert.ok(r.length >= 2, 'menos de 2 esportivos na frota');
    const cores = new Set(r.map(x => x.lataria));
    assert.ok(!cores.has(null) && !cores.has(undefined), 'lataria não encontrada em algum esportivo');
    assert.ok(cores.size >= 2, `todos os esportivos com a mesma lataria: ${[...cores].join(',')}`);
    for (const x of r) assert.ok(x.outros > 5, 'detalhes do modelo sumiram junto com o tint');
  });

  it('dado o esportivo, então mantém os materiais do modelo (não vira um bloco de uma cor só)', async () => {
    const r = await h.play(async () => {
      const G = window.QA.G;
      await G.Car.ready;
      const v = G.Car.vehicles.find(x => x.cfg.name === 'ESPORTIVO GT');
      const cores = new Set();
      let pretos = 0, total = 0;
      v.group.traverse(o => {
        if (!o.isMesh || !o.userData.importedCarModel) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (!m || !m.color) continue;
          total++;
          const hex = m.color.getHexString();
          cores.add(hex);
          if (hex === '000000') pretos++;
        }
      });
      return { cores: [...cores].slice(0, 8), unicas: cores.size, pretos, total };
    });
    assert.ok(r.unicas >= 3, `esportivo monocromático (${r.unicas} cor: ${r.cores.join(',')})`);
    assert.ok(r.pretos < r.total, 'todos os materiais do esportivo estão pretos');
  });
});
