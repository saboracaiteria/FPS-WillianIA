/* ================================================================
   CONSTANTES AJUSTÁVEIS — mexa aqui para calibrar qualidade/perf
   ================================================================ */
export const CFG = {
  // Grama
  GRASS_TOTAL:      40000,   // total aproximado de lâminas no patch
  GRASS_CHUNKS:     7,       // grade NxN de chunks ao redor do player
  GRASS_CHUNK_SIZE: 14,      // metros por chunk (raio do patch = N/2 * tamanho)
  GRASS_HEIGHT:     0.95,    // altura média da lâmina
  WIND_STRENGTH:    0.55,
  // Mundo
  WORLD_SIZE:       1100,    // lado do terreno (m)
  TERRAIN_SEGS:     120,     // segmentos do PlaneGeometry
  VIEW_DIST:        380,     // far do fog / culling
  TREE_COUNT:       200,     // árvores
  ROCK_COUNT:       120,     // pedras
  FLOWER_COUNT:     800,     // flores
  // Sombra
  SHADOW_MAP_SIZE:  512,     // por cascata — 3 cascatas CSM
  CSM_MAX_FAR:      110,
  // Inimigos
  ENEMY_COUNT:      12,
  // Render
  MAX_PIXEL_RATIO:  2,
  BLOOM_STRENGTH:   0.22,
  BLOOM_RADIUS:     0.3,
  BLOOM_THRESHOLD:  1.0,
  EXPOSURE:         0.58,
};

/* ===== configurações (localStorage) ===== */
export const SETTINGS = Object.assign({ vol: 0.5, res: 1, shadow: 1, bloom: 1, ping: 1 },
  (() => { try { return JSON.parse(localStorage.getItem('callofai_cfg') || '{}'); } catch (e) { return {}; } })());
export function persistSettings() { localStorage.setItem('callofai_cfg', JSON.stringify(SETTINGS)); }

/* ===== Mobile detection ===== */
export function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}
export function isSmallScreen() {
  return window.innerWidth < 768 || window.innerHeight < 600;
}
