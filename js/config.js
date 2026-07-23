/* ================================================================
   CONSTANTES AJUSTÁVEIS — mexa aqui para calibrar qualidade/perf
   ================================================================ */

// Detecta mobile para reduzir qualidade automaticamente
const _isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
  || (navigator.maxTouchPoints > 1 && window.innerWidth < 1024);

export const CFG = {
  // Grama
  GRASS_TOTAL:      _isMobile ? 15000 : 40000,
  GRASS_CHUNKS:     _isMobile ? 5 : 7,
  GRASS_CHUNK_SIZE: _isMobile ? 12 : 14,
  GRASS_HEIGHT:     0.95,
  WIND_STRENGTH:    0.55,
  // Mundo
  WORLD_SIZE:       1100,
  TERRAIN_SEGS:     _isMobile ? 80 : 120,
  VIEW_DIST:        _isMobile ? 280 : 380,
  TREE_COUNT:       _isMobile ? 120 : 200,
  ROCK_COUNT:       _isMobile ? 60 : 120,
  FLOWER_COUNT:     _isMobile ? 300 : 800,
  // Sombra
  SHADOW_MAP_SIZE:  _isMobile ? 256 : 512,
  CSM_MAX_FAR:      _isMobile ? 80 : 110,
  // Inimigos
  ENEMY_COUNT:      12,
  // Render
  MAX_PIXEL_RATIO:  _isMobile ? 1.5 : 2,
  BLOOM_STRENGTH:   _isMobile ? 0.15 : 0.22,
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
