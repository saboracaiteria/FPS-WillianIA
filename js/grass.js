/* grama instanciada com vento no vertex shader — extraído de game.js; deps explícitas */
import * as THREE from 'three';

export function createGrass(deps) {
  const { CFG, rand, TAU, heightAt, biomeAt, WATER_LEVEL, simplex, scene, sunDir, CITY } = deps;
  const N = CFG.GRASS_CHUNKS;                       // grade NxN
  const SIZE = CFG.GRASS_CHUNK_SIZE;
  const PER_CHUNK = Math.floor(CFG.GRASS_TOTAL / (N * N));
  const PATCH_RADIUS = (N / 2) * SIZE;              // raio do tapete de grama

  // geometria da lâmina: quad afunilado com leve curvatura, raiz em y=0
  function bladeGeometry() {
    const g = new THREE.PlaneGeometry(0.1, 1, 1, 4);
    g.translate(0, 0.5, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      p.setX(i, p.getX(i) * (1.0 - y * 0.82));      // afunila ate a ponta
      p.setZ(i, Math.pow(y, 2) * 0.18);             // curvinha pra frente
    }
    g.computeVertexNormals();
    return g;
  }
  const baseBlade = bladeGeometry();

  const uniforms = {
    uTime:        { value: 0 },
    uPlayerPos:   { value: new THREE.Vector3(0, -999, 0) },
    uCarPos:      { value: new THREE.Vector3(0, -999, 0) },
    uWind:        { value: CFG.WIND_STRENGTH },
    uSunDir:      { value: sunDir.clone().normalize() },
    uSunColor:    { value: new THREE.Color(0xfff0d4).multiplyScalar(1.12) },
    uSkyColor:    { value: new THREE.Color(0xbfd9ff) },
    uGroundColor: { value: new THREE.Color(0x4d6a36) },
    uBaseColor:   { value: new THREE.Color(0x3e7028) },
    uTipColor:    { value: new THREE.Color(0x9cc94f) },
    uPatchRadius: { value: PATCH_RADIUS },
    ...THREE.UniformsLib.fog,
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      #include <common>
      #include <fog_pars_vertex>
      uniform float uTime;
      uniform vec3  uPlayerPos;
      uniform vec3  uCarPos;
      uniform float uWind;
      uniform float uPatchRadius;
      attribute float aPhase;
      attribute vec3  aTint;
      varying vec2 vUv;
      varying vec3 vTint;

      float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float vnoise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash12(i), b = hash12(i + vec2(1.0, 0.0)), c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      // dobra a lamina para longe de um ponto (player ou carro)
      void bendAway(inout vec4 wpos, vec3 src, float radius, float strength, float h) {
        vec2 toBlade = wpos.xz - src.xz;
        float d = length(toBlade);
        float falloff = 1.0 - smoothstep(0.0, radius, d);
        falloff *= 1.0 - smoothstep(0.5, 3.0, abs(wpos.y - src.y));   // so age perto em altura
        vec2 pushDir = toBlade / max(d, 1e-4);
        wpos.x += pushDir.x * falloff * h * strength;
        wpos.z += pushDir.y * falloff * h * strength;
        wpos.y -= falloff * h * 0.3;
      }

      void main() {
        vUv = uv;
        vTint = aTint;
        vec3 transformed = position;
        float h = uv.y;          // peso pela altura: raiz fixa, ponta solta
        float hh = h * h;

        // some suavemente perto da borda do patch (esconde o recorte)
        float dCam = distance((modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz, cameraPosition);
        float edgeFade = 1.0 - smoothstep(uPatchRadius * 0.8, uPatchRadius * 0.98, dCam);
        transformed.y *= edgeFade;
        transformed.x *= edgeFade;

        vec4 wpos = modelMatrix * instanceMatrix * vec4(transformed, 1.0);

        // vento: ruido rolando + balanco senoidal com fase por instancia
        float w1 = vnoise(wpos.xz * 0.08 + vec2(uTime * 0.85, uTime * 0.55));
        float w2 = vnoise(wpos.xz * 0.33 - vec2(uTime * 1.6, uTime * 0.2));
        float wind = (w1 - 0.5) * 1.7 + (w2 - 0.5) * 0.55;
        float sway = sin(uTime * 2.3 + aPhase * 6.2831) * 0.055;
        vec2 windDir = normalize(vec2(0.72, 0.45));
        wpos.x += windDir.x * (wind * uWind + sway) * hh;
        wpos.z += windDir.y * (wind * uWind + sway) * hh;
        wpos.y -= abs(wind) * uWind * hh * 0.16;

        bendAway(wpos, uPlayerPos, 1.5, 1.05, h);   // player amassa a grama
        bendAway(wpos, uCarPos,    3.1, 1.4,  h);   // carro amassa uma area maior

        vec4 mvPosition = viewMatrix * wpos;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uSkyColor;
      uniform vec3 uGroundColor;
      uniform vec3 uBaseColor;
      uniform vec3 uTipColor;
      varying vec2 vUv;
      varying vec3 vTint;

      void main() {
        vec3 albedo = mix(uBaseColor, uTipColor, vUv.y) * vTint;
        // UMA luz direcional embutida + hemisferio fake (confiavel e barato)
        float ndl = clamp(uSunDir.y, 0.0, 1.0);
        float ao = mix(0.5, 1.0, vUv.y);                       // raiz mais escura
        vec3 hemi = mix(uGroundColor, uSkyColor, 0.35 + 0.65 * vUv.y);
        vec3 col = albedo * (hemi * 0.6 + uSunColor * ndl * 0.95) * ao;
        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  // chunks: cada um e um InstancedMesh com bounding sphere propria p/ frustum culling
  const chunks = [];
  const dummy = new THREE.Object3D();
  const tintCol = new THREE.Color();

  function fillChunk(chunk, cx, cz) {
    chunk.cx = cx; chunk.cz = cz;
    const wx = cx * SIZE, wz = cz * SIZE;
    chunk.mesh.position.set(wx, 0, wz);
    const phase = chunk.mesh.geometry.attributes.aPhase;
    const tint = chunk.mesh.geometry.attributes.aTint;
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < PER_CHUNK; i++) {
      const lx = rand(-SIZE / 2, SIZE / 2);
      const lz = rand(-SIZE / 2, SIZE / 2);
      const y = heightAt(wx + lx, wz + lz);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      const bio = biomeAt(wx + lx, wz + lz);
      const desert = THREE.MathUtils.smoothstep(-bio, 0.18, 0.45);
      dummy.position.set(lx, y, lz);
      dummy.rotation.set(rand(-0.13, 0.13), rand(TAU), rand(-0.13, 0.13));
      let s = rand(0.65, 1.4) * CFG.GRASS_HEIGHT;
      // deserto: SEM grama (lâminas colapsam completamente)
      if (desert > 0.1) s = 0.001; // praticamente invisível
      if (y < WATER_LEVEL + 0.25) s = 0.015; // nada de grama dentro dos lagos
      // distrito urbano é asfalto: grama não brota no perímetro da cidade
      // (escala ~zero: até lâmina de 1,5cm pontilhava verde no chão claro)
      if (CITY && Math.hypot(wx + lx - CITY.x, wz + lz - CITY.z) < 92) s = 0.0001;
      dummy.scale.set(rand(0.8, 1.25), s, 1);
      dummy.updateMatrix();
      chunk.mesh.setMatrixAt(i, dummy.matrix);
      phase.setX(i, Math.random());
      // variacao sutil de cor por lamina, casando com terreno e bioma
      const v = simplex.noise((wx + lx) * 0.03, (wz + lz) * 0.03) * 0.5 + 0.5;
      const forest = THREE.MathUtils.smoothstep(bio, 0.34, 0.62);
      tintCol.setHSL(
        0.26 + v * 0.035 - 0.018 - desert * 0.09 + forest * 0.015,
        0.58 - desert * 0.2,
        0.5 + rand(-0.06, 0.06) - forest * 0.07);
      tint.setXYZ(i, 0.7 + tintCol.r * 0.5, 0.7 + tintCol.g * 0.5, 0.7 + tintCol.b * 0.5);
    }
    phase.needsUpdate = true;
    tint.needsUpdate = true;
    chunk.mesh.instanceMatrix.needsUpdate = true;
    const midY = (minY + maxY) / 2;
    chunk.mesh.geometry.boundingSphere.center.set(0, midY, 0);
    chunk.mesh.geometry.boundingSphere.radius = SIZE * 0.75 + (maxY - minY) * 0.5 + 2;
  }

  function makeChunk(cx, cz) {
    const geo = baseBlade.clone();
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array(PER_CHUNK), 1));
    geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(PER_CHUNK * 3), 3));
    geo.boundingSphere = new THREE.Sphere();
    const mesh = new THREE.InstancedMesh(geo, material, PER_CHUNK);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = true;   // culling por chunk
    const chunk = { mesh, cx: 99999, cz: 99999 };
    fillChunk(chunk, cx, cz);
    scene.add(mesh);
    return chunk;
  }

  // grade inicial centrada na origem
  const halfN = Math.floor(N / 2);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++)
      chunks.push(makeChunk(i - halfN, j - halfN));

  let centerX = 0, centerZ = 0; // celula central atual
  const REBUILD_BUDGET = 6;     // chunks re-preenchidos por frame, no maximo
  const pending = [];

  function update(playerPos, carPos, time) {
    uniforms.uTime.value = time;
    uniforms.uPlayerPos.value.copy(playerPos);
    uniforms.uCarPos.value.copy(carPos);

    const ncx = Math.round(playerPos.x / SIZE);
    const ncz = Math.round(playerPos.z / SIZE);
    if (ncx !== centerX || ncz !== centerZ) {
      centerX = ncx; centerZ = ncz;
      // recoloca chunks que sairam do raio da grade (wrap toroidal)
      for (const ch of chunks) {
        let tx = ch.cx, tz = ch.cz;
        while (tx < centerX - halfN) tx += N;
        while (tx > centerX + halfN) tx -= N;
        while (tz < centerZ - halfN) tz += N;
        while (tz > centerZ + halfN) tz -= N;
        if (tx !== ch.cx || tz !== ch.cz) pending.push([ch, tx, tz]);
      }
    }
    let budget = REBUILD_BUDGET;
    while (pending.length && budget-- > 0) {
      const [ch, tx, tz] = pending.shift();
      fillChunk(ch, tx, tz);
    }
  }

  function setVisible(v) {
    for (const ch of chunks) {
      ch.mesh.visible = v;
    }
  }

  function setDensity(d) {
    // d = 1 (normal), 0.5 (reduzida - mostra metade dos chunks), 0 (removida)
    if (d === 0) { setVisible(false); return; }
    setVisible(true);
    if (d >= 1) return;
    // Mostra apenas uma fração dos chunks
    const showCount = Math.ceil(chunks.length * d);
    for (let i = 0; i < chunks.length; i++) {
      chunks[i].mesh.visible = i < showCount;
    }
  }

  return { update, material, PATCH_RADIUS, setVisible, setDensity };
}
