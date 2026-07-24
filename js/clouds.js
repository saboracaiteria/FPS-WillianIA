/* Camada de nuvens volumétricas low-poly: um único InstancedMesh, sem sombra. */
import * as THREE from 'three';

export function createClouds({ scene, Env, worldSize = 1000 }) {
  let seed = 0xC10D5A11;
  const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 15), 1 | seed) + 0x6D2B79F5 | 0) >>> 0) / 4294967296;
  const cloudCount = 80, puffsPerCloud = 3, count = cloudCount * puffsPerCloud;
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xe6edf4, roughness: 1, metalness: 0,
    transparent: true, opacity: 0.54, depthWrite: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.name = 'nuvensInstanciadas';
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = -4;
  const d = new THREE.Object3D();
  const span = worldSize + 260;
  let idx = 0;
  for (let i = 0; i < cloudCount; i++) {
    const cx = (rnd() - 0.5) * span, cz = (rnd() - 0.5) * span;
    const cy = 92 + rnd() * 68, base = 7 + rnd() * 9;
    for (let p = 0; p < puffsPerCloud; p++) {
      d.position.set(cx + (p - 1) * base * 0.7, cy + (p === 1 ? base * 0.16 : 0), cz + (rnd() - 0.5) * base);
      d.rotation.set(rnd() * 0.35, rnd() * Math.PI * 2, rnd() * 0.18);
      d.scale.set(base * (0.85 + rnd() * 0.55), base * (0.24 + rnd() * 0.16), base * (0.58 + rnd() * 0.42));
      d.updateMatrix(); mesh.setMatrixAt(idx++, d.matrix);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);

  const day = new THREE.Color(0xe6edf4), storm = new THREE.Color(0x77818c), night = new THREE.Color(0x303b52);
  let acc = 9;
  function update(dt, t) {
    mesh.position.x = ((t * 1.1 + span * 0.5) % span) - span * 0.5;
    mesh.position.z = Math.sin(t * 0.006) * 24;
    acc += dt;
    if (acc < 0.2) return;
    acc = 0;
    const weatherK = THREE.MathUtils.clamp(Env?.weatherK || 0, 0, 1);
    const nightK = THREE.MathUtils.clamp(Env?.nightK || 0, 0, 1);
    mat.color.copy(day).lerp(storm, weatherK * 0.72).lerp(night, nightK * 0.72);
    mat.opacity = 0.45 + weatherK * 0.22;
  }
  return { mesh, material: mat, count, update };
}
