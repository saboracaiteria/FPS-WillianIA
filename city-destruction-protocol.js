/* ================================================================
   PROTOCOLO do evento de destruição da cidade — compartilhado entre
   servidor (CJS) e navegador (window.CityDestructionProtocol).
   Tudo aqui é DETERMINÍSTICO por seed: todos os clientes e o servidor
   derivam os mesmos mísseis, o mesmo míssil assinado e os mesmos
   pontos de impacto. A qualidade local só muda a QUANTIDADE visual —
   nunca o assinado, os 8 impactos principais ou o instante do impacto.
   Plano: docs/plans/city-destruction-event.md
   ================================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CityDestructionProtocol = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* centro/raio da cidade (espelho do CITY de js/terrain.js e dos lots
     de js/structures.js — fixos no jogo, não dependem da seed do mapa) */
  const CITY_CENTER = { x: -340, z: 130 };
  const CITY_RADIUS = 95;
  const CITY_KILL_RADIUS = 100;   // raio letal do ataque (ajuste aqui)

  const DELAY_DEFAULT = 90000;        // produção: 90s após o início da partida
  const IMPACT_DELAY_DEFAULT = 8500;  // impacto 8,5s após o começo da cinemática

  /* fases da cinematográfica, em segundos desde cinematicStartedAt */
  const PHASES = {
    skyPan: [0, 3],        // câmera sobe, mísseis ao longe
    missileClose: [3, 5.5], // close no míssil assinado "By RenatoDReis"
    wide: [5.5, 7],        // plano aberto sobre a cidade
    mirv: [7, 8.5],        // ogivas se separam e mergulham
    impact: 8.5,           // instante oficial do impacto
    aftermath: [8.5, 12],  // fumaça baixa, câmera devolvida
  };

  /* contagens visuais por qualidade (assinado e impactos NÃO variam) */
  const QUALITY = {
    low: { missiles: 6, warheads: 12 },
    medium: { missiles: 10, warheads: 24 },
    high: { missiles: 16, warheads: 40 },
  };

  /* lots dos prédios (espelho de js/structures.js) — alvos urbanos reais */
  const LOTS = [[-34, -28], [-16, -34], [4, -30], [38, -26], [-40, -2], [-38, 44],
    [-14, 42], [8, 44], [40, 8], [42, 42], [-44, 18], [16, -8]];

  function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* evento completo: mísseis (canônicos: os N primeiros são iguais em toda
     qualidade), índice do míssil assinado, ogivas e 8+ impactos principais */
  function buildCityEvent(seed, quality) {
    const q = QUALITY[quality] || QUALITY.medium;
    const rng = mulberry32((seed >>> 0) ^ 0xC17DE57);
    const cx = CITY_CENTER.x, cz = CITY_CENTER.z;

    // 8 impactos principais: prédios sorteados por seed + jitter pequeno
    const ordem = LOTS.map((l, i) => ({ l, k: rng() })).sort((a, b) => a.k - b.k);
    const impacts = [];
    for (let i = 0; i < 8; i++) {
      const [ox, oz] = ordem[i % ordem.length].l;
      impacts.push({
        x: +(cx + ox + (rng() - 0.5) * 6).toFixed(2),
        z: +(cz + oz + (rng() - 0.5) * 6).toFixed(2),
      });
    }

    // mísseis: sequência canônica de 16 (todas as qualidades compartilham o
    // prefixo) — nascem num anel alto ao redor da cidade e mergulham nela
    const MAX = QUALITY.high.missiles;
    const missiles = [];
    for (let i = 0; i < MAX; i++) {
      const a = rng() * Math.PI * 2;
      const r = 550 + rng() * 350;
      const alvo = impacts[i % impacts.length];
      missiles.push({
        from: { x: +(cx + Math.cos(a) * r).toFixed(1), y: +(320 + rng() * 120).toFixed(1),
          z: +(cz + Math.sin(a) * r).toFixed(1) },
        to: { x: alvo.x, y: 0, z: alvo.z },
        delay: +(rng() * 1.2).toFixed(2), // defasagem visual de entrada
      });
    }
    // assinado sempre entre os 6 primeiros → existe em TODAS as qualidades
    const signedIndex = (seed >>> 0) % QUALITY.low.missiles;

    // ogivas: cada míssil visível libera warheads/missiles ogivas; alvos
    // derivados dos impactos principais com espalhamento determinístico
    const warheads = [];
    for (let i = 0; i < QUALITY.high.warheads; i++) {
      const alvo = impacts[i % impacts.length];
      warheads.push({
        x: +(alvo.x + (rng() - 0.5) * 22).toFixed(2),
        z: +(alvo.z + (rng() - 0.5) * 22).toFixed(2),
      });
    }

    return {
      seed: seed >>> 0,
      counts: q,
      missiles: missiles.slice(0, q.missiles),
      signedIndex,
      impacts,
      warheads: warheads.slice(0, q.warheads),
    };
  }

  return {
    CITY_CENTER, CITY_RADIUS, CITY_KILL_RADIUS,
    DELAY_DEFAULT, IMPACT_DELAY_DEFAULT,
    PHASES, QUALITY,
    buildCityEvent,
  };
});
