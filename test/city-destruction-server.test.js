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
