/* terreno: funcao de altura compartilhada (fBm de simplex), plataformas,
   grade de obstaculos e nivel da agua — a UNICA fonte de verdade do chao.
   Factory: a permutacao do SimplexNoise consome Math.random, que precisa
   estar SEEDADO (multiplayer) antes — por isso nao roda no import. */
import * as THREE from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';

export function createTerrain(deps) {
  const { lerp, clamp } = deps;
const simplex = new SimplexNoise();
function fbm(x, z, oct, freq, amp, lac = 2.0, gain = 0.5) {
  let s = 0, f = freq, a = amp;
  for (let i = 0; i < oct; i++) { s += simplex.noise(x * f, z * f) * a; f *= lac; a *= gain; }
  return s;
}
const CITY = { x: -340, z: 130 }; // distrito urbano (terreno aplainado)
function heightAnalytic(x, z) {
  let h = fbm(x, z, 4, 0.0042, 9.5);          // colinas largas
  h += fbm(x + 310, z - 170, 3, 0.016, 2.1);  // detalhe médio
  h += Math.max(0, fbm(x - 800, z + 530, 2, 0.0021, 14)) * 1.25; // morros ocasionais
  // platô gramado na área de spawn (acampamento inicial / carro)
  const d0 = Math.hypot(x, z);
  const flat = THREE.MathUtils.smoothstep(d0, 12, 70);
  h = lerp(2.4, h, 0.1 + 0.9 * flat);
  // platô da cidade
  const dc = Math.hypot(x - CITY.x, z - CITY.z);
  if (dc < 130) {
    const cf = THREE.MathUtils.smoothstep(dc, 62, 125);
    h = lerp(3.2, h, 0.05 + 0.95 * cf);
  }
  return h;
}
/* PERF: depois que o mundo é gerado, a altura vem de uma grade pré-computada
   com interpolação bilinear (~20x mais rápido que 9 chamadas de simplex por
   consulta). A geração do mundo usa a analítica na ordem original, então o
   determinismo multiplayer não muda. A grade é idêntica em todos os clientes. */
let hGrid = null, hGridN = 0, hGridHalf = 0, hGridCell = 0;
function buildHeightGrid(worldSize, cells = 440) {
  const n = cells + 1;
  const g = new Float32Array(n * n);
  const half = worldSize / 2, step = worldSize / cells;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++)
      g[j * n + i] = heightAnalytic(-half + i * step, -half + j * step);
  hGrid = g; hGridN = n; hGridHalf = half; hGridCell = step;
}
function heightAt(x, z) {
  if (!hGrid || x < -hGridHalf || x >= hGridHalf || z < -hGridHalf || z >= hGridHalf)
    return heightAnalytic(x, z);
  const fx = (x + hGridHalf) / hGridCell, fz = (z + hGridHalf) / hGridCell;
  const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j;
  const r0 = j * hGridN + i, r1 = r0 + hGridN;
  const a = hGrid[r0] + (hGrid[r0 + 1] - hGrid[r0]) * tx;
  const b = hGrid[r1] + (hGrid[r1 + 1] - hGrid[r1]) * tx;
  return a + (b - a) * tz;
}
/* plataformas pisáveis (andares e rampas de prédios) além do terreno */
const platforms = []; // {x0,x1,z0,z1, y} | rampa: {ramp:true, axis:'x'|'z', y0, y1}
function groundAt(x, z, curY) {
  let g = heightAt(x, z);
  for (const p of platforms) {
    if (x < p.x0 || x > p.x1 || z < p.z0 || z > p.z1) continue;
    let top = p.y;
    if (p.ramp) {
      const k = p.axis === 'x' ? (x - p.x0) / (p.x1 - p.x0) : (z - p.z0) / (p.z1 - p.z0);
      top = lerp(p.y0, p.y1, clamp(k, 0, 1));
    }
    if (top > g && top <= curY + 0.65) g = top;
  }
  return g;
}
function slopeAt(x, z) {
  const e = 0.6;
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
}
function terrainNormal(x, z, out) {
  const e = 0.6;
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return out.set(-dx / (2 * e), 1, -dz / (2 * e)).normalize();
}
/* biomas: < -0.2 deserto | > 0.34 floresta | meio: pradaria */
function biomeAt(x, z) {
  return simplex.noise(x * 0.0016 + 41.7, z * 0.0016 - 12.3);
}

  const WATER_LEVEL = -5;


/* colisores círculo (árvores/pedras/cactos) num hash espacial */
const obstacleGrid = new Map(); // hash espacial p/ colisão do player
const OBST_CELL = 16;
function addObstacle(x, z, r) {
  const k = `${Math.floor(x / OBST_CELL)}_${Math.floor(z / OBST_CELL)}`;
  if (!obstacleGrid.has(k)) obstacleGrid.set(k, []);
  obstacleGrid.get(k).push({ x, z, r });
}
function obstaclesNear(x, z) {
  const gx = Math.floor(x / OBST_CELL), gz = Math.floor(z / OBST_CELL);
  const out = [];
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const c = obstacleGrid.get(`${gx + i}_${gz + j}`);
    if (c) out.push(...c);
  }
  return out;
}
  return { simplex, fbm, heightAt, heightAnalytic, buildHeightGrid, groundAt,
    slopeAt, terrainNormal, biomeAt,
    platforms, WATER_LEVEL, addObstacle, obstaclesNear, CITY };
}
