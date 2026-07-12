/* Cenário 3D: converte GLBs em geometria "assada" pra instancing barato
   (árvores) e em props únicos (mercado, casa da árvore, barris).
   As árvores viram UMA BufferGeometry com vertex colors (cores dos materiais
   pintadas nos vértices) — compatível com o material único instanciado que o
   jogo já usa, então centenas de cópias continuam custando 1 draw call. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

export function createScenery() {
  const loader = new GLTFLoader();
  const cache = new Map();
  const cached = url => {
    if (!cache.has(url)) cache.set(url, loader.loadAsync(url));
    return cache.get(url);
  };

  const _c = new THREE.Color();
  function bakeColor(geo, color) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    // atributos extras estragam o merge; posição+normal+cor bastam
    for (const k of Object.keys(g.attributes)) {
      if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
    }
    return g;
  }

  /* GLB → geometria única com vertex colors, altura normalizada e pé no chão.
     Materiais com TEXTURA (cor base branca) receberiam branco no bake — pra
     esses usamos a paleta de fallback (verde folha/marrom tronco alternados). */
  const FALLBACK = [0x4e8a35, 0x5d9c3e, 0x3e7a31, 0x6b4a2e];
  async function bakedGeometry(url, { height = 8 } = {}) {
    let fbIdx = 0;
    const partColor = m => {
      if (m && m.color && !m.map) {
        const l = m.color.r * 0.299 + m.color.g * 0.587 + m.color.b * 0.114;
        if (l < 0.85) return _c.copy(m.color);
      }
      return _c.setHex(FALLBACK[fbIdx++ % FALLBACK.length]);
    };
    const gltf = await cached(url);
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const parts = [];
    root.traverse(o => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      // grupos por material: um pedaço colorido por grupo
      if (o.geometry.groups && o.geometry.groups.length > 1) {
        for (const grp of o.geometry.groups) {
          const sub = o.geometry.index
            ? o.geometry.toNonIndexed() : o.geometry.clone();
          // fatia o range do grupo
          const g2 = new THREE.BufferGeometry();
          for (const k of ['position', 'normal']) {
            const a = sub.attributes[k];
            if (!a) continue;
            g2.setAttribute(k, new THREE.BufferAttribute(
              a.array.slice(grp.start * a.itemSize, (grp.start + grp.count) * a.itemSize), a.itemSize));
          }
          const painted = bakeColor(g2, partColor(mats[grp.materialIndex] || mats[0]));
          painted.applyMatrix4(o.matrixWorld);
          parts.push(painted);
        }
      } else {
        const painted = bakeColor(o.geometry, partColor(mats[0]));
        painted.applyMatrix4(o.matrixWorld);
        parts.push(painted);
      }
    });
    if (!parts.length) throw new Error('GLB sem malhas: ' + url);
    let merged = BufferGeometryUtils.mergeGeometries(parts, false);
    // normaliza: altura alvo, base no y=0, centrado em XZ
    merged.computeBoundingBox();
    const bb = merged.boundingBox;
    const s = height / Math.max(bb.max.y - bb.min.y, 1e-3);
    merged.scale(s, s, s);
    merged.computeBoundingBox();
    const b2 = merged.boundingBox;
    merged.translate(-(b2.min.x + b2.max.x) / 2, -b2.min.y, -(b2.min.z + b2.max.z) / 2);
    return merged;
  }

  /* GLB → objeto único no mundo (prédios/props), com materiais originais */
  async function prop(url, { height = 6, yaw = 0 } = {}) {
    const gltf = await cached(url);
    const inst = gltf.scene.clone(true);
    inst.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = false; // precedente dos carros (CSM 4x draw calls)
      o.receiveShadow = false;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m && m.isMeshStandardMaterial && !m.map) {
          const l = m.color.r * 0.299 + m.color.g * 0.587 + m.color.b * 0.114;
          if (l > 0.72) m.color.multiplyScalar(0.72 / l);
        }
      }
    });
    const orient = new THREE.Group();
    orient.rotation.y = yaw;
    orient.add(inst);
    orient.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(orient);
    const s = height / Math.max(bb.max.y - bb.min.y, 1e-3);
    orient.scale.setScalar(s);
    orient.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(orient);
    orient.position.set(-(b2.min.x + b2.max.x) / 2, -b2.min.y, -(b2.min.z + b2.max.z) / 2);
    const root = new THREE.Group();
    root.add(orient);
    const size = b2.getSize(new THREE.Vector3());
    return { root, size };
  }

  return { bakedGeometry, prop };
}
