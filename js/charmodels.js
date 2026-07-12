/* Personagens 3D rigados (inimigos/boss): carregamento com cache, clone de
   esqueleto por instância (SkeletonUtils) e normalização pé-no-chão.
   Cada build() devolve { root, mixer, actions } — quem chama pendura o root
   no grupo do personagem e dirige o mixer; se a rede falhar, o chamador
   simplesmente continua com o corpo procedural antigo. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

export function createCharModels() {
  const loader = new GLTFLoader();
  const cache = new Map();
  const norm = s => String(s).replace(/[.\s]/g, '');

  function cached(url) {
    if (!cache.has(url)) cache.set(url, loader.loadAsync(url));
    return cache.get(url);
  }

  /* prepara um "molde": mede uma vez, cada build() clona esqueleto+malha */
  async function character(url, { height = 1.9, yaw = 0 } = {}) {
    const gltf = await cached(url);
    const proto = gltf.scene;
    const box = new THREE.Box3().setFromObject(proto);
    const rawH = Math.max(box.max.y - box.min.y, 1e-3);
    const s = height / rawH;

    function build() {
      const inst = cloneSkeleton(proto);
      inst.traverse(o => {
        if (o.isMesh || o.isSkinnedMesh) {
          o.castShadow = false;   // precedente dos carros: CSM 4x multiplicaria draw calls
          o.receiveShadow = false;
          o.frustumCulled = false; // esqueleto animado desloca a malha do bounding original
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            if (m && m.isMeshStandardMaterial && !m.map) {
              const l = m.color.r * 0.299 + m.color.g * 0.587 + m.color.b * 0.114;
              if (l > 0.72) m.color.multiplyScalar(0.72 / l);
            }
          }
        }
      });
      const orient = new THREE.Group();
      orient.rotation.y = yaw;
      orient.scale.setScalar(s);
      orient.add(inst);
      orient.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(orient);
      orient.position.set(-(b.min.x + b.max.x) * 0.5, -b.min.y, -(b.min.z + b.max.z) * 0.5);
      const root = new THREE.Group();
      root.add(orient);

      const mixer = new THREE.AnimationMixer(inst);
      const actions = {};
      for (const clip of gltf.animations) actions[clip.name] = mixer.clipAction(clip);

      const findNode = frag => {
        const f = norm(frag);
        let hit = null;
        inst.traverse(o => { if (!hit && norm(o.name).includes(f)) hit = o; });
        return hit;
      };
      return { root, mixer, actions, findNode };
    }
    return { build };
  }

  return { character };
}
