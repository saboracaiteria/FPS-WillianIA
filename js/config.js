/* ================================================================
   CONSTANTES AJUSTÁVEIS — mexa aqui para calibrar qualidade/perf
   ================================================================ */
export const CFG = {
  // Grama
  GRASS_TOTAL:      170000,  // total aproximado de lâminas no patch
  GRASS_CHUNKS:     13,      // grade NxN de chunks ao redor do player
  GRASS_CHUNK_SIZE: 10,      // metros por chunk (raio do patch = N/2 * tamanho)
  GRASS_HEIGHT:     0.95,    // altura média da lâmina
  WIND_STRENGTH:    0.55,
  // Mundo
  WORLD_SIZE:       1100,    // lado do terreno (m)
  TERRAIN_SEGS:     220,     // segmentos do PlaneGeometry
  VIEW_DIST:        420,     // far do fog / culling
  TREE_COUNT:       380,
  ROCK_COUNT:       240,
  FLOWER_COUNT:     2600,
  // Sombra
  SHADOW_MAP_SIZE:  1024,    // por cascata (4 cascatas CSM)
  CSM_MAX_FAR:      160,
  // Inimigos
  ENEMY_COUNT:      12,
  // Render
  MAX_PIXEL_RATIO:  2,
  BLOOM_STRENGTH:   0.28,
  BLOOM_RADIUS:     0.35,
  BLOOM_THRESHOLD:  1.0,
  EXPOSURE:         0.58,
};

/* ===== configurações (localStorage) ===== */
export const SETTINGS = Object.assign({ vol: 0.5, res: 1.5, shadow: 1, bloom: 1, ping: 1 },
  (() => { try { return JSON.parse(localStorage.getItem('callofai_cfg') || '{}'); } catch (e) { return {}; } })());
export function persistSettings() { localStorage.setItem('callofai_cfg', JSON.stringify(SETTINGS)); }
