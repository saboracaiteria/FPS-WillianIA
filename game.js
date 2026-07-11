import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSM } from 'three/addons/csm/CSM.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CFG, SETTINGS, persistSettings } from './js/config.js';
import { clamp, lerp, damp, rand, TAU, _v1, _v2, _v3, _q1, _m1, chaseCamPos, chaseLook } from './js/utils.js';
import { createTerrain } from './js/terrain.js';
import { createSFX } from './js/sfx.js';
import { createStructures } from './js/structures.js';
import { createFX } from './js/fx.js';
import { createDmgNums } from './js/dmgnums.js';
import { createWeapons } from './js/weapons.js';
import { createCar } from './js/car.js';
import { createHeli } from './js/heli.js';
import { createGrenades } from './js/grenades.js';
import { createRockets } from './js/rockets.js';
import { createPickups } from './js/pickups.js';
import { createEnv } from './js/env.js';

/* ================================================================
   MULTIPLAYER — bootstrap aditivo. Conecta ANTES da geração do mundo
   pra receber a seed da sala: mesma seed => mapa idêntico pra todos.
   Sem servidor (window.io ausente ou timeout de 3s), segue 100% solo.
   ================================================================ */
let __mpSocket = null, __mpSpawn = null;
if (window.io) {
  try {
    __mpSocket = window.io();
    const __mpInit = await new Promise(res => {
      const to = setTimeout(() => res(null), 3000);
      __mpSocket.once('init', d => { clearTimeout(to); res(d); });
    });
    if (__mpInit) {
      __mpSpawn = __mpInit.spawn;
      window.__MP_init = __mpInit;
      let __mpS = __mpInit.worldSeed >>> 0; // mulberry32 seedado no lugar do Math.random
      Math.random = function () {
        __mpS = (__mpS + 0x6D2B79F5) | 0;
        let t = Math.imul(__mpS ^ (__mpS >>> 15), 1 | __mpS);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    } else { __mpSocket.close(); __mpSocket = null; }
  } catch (e) { console.warn('[MP] servidor indisponível — modo solo', e); __mpSocket = null; }
}


const { simplex, heightAt, buildHeightGrid, groundAt, slopeAt, terrainNormal, biomeAt,
  platforms, WATER_LEVEL, addObstacle, obstaclesNear, CITY } = createTerrain({ lerp, clamp });

const SFX = createSFX({ SETTINGS, clamp, rand });

/* ================== renderer / cena / pós ================== */
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, SETTINGS.res));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // r184: PCFSoft foi absorvido pelo PCF (evita warning)
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = CFG.EXPOSURE; // ~0.6 (ACES)
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const FOG_COLOR = new THREE.Color(0xb9d1e4);
scene.fog = new THREE.Fog(FOG_COLOR, CFG.VIEW_DIST * 0.5, CFG.VIEW_DIST);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, CFG.VIEW_DIST + 600);
camera.position.set(0, 3, 8);

// ambiente PMREM para os MeshStandardMaterial não ficarem chapados
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.38;
  pmrem.dispose();
}

/* ---- céu + sol ---- */
const sky = new Sky();
sky.scale.setScalar(45000);
scene.add(sky);
const SUN_ELEV = 27, SUN_AZIM = 155; // fim de tarde dourado
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - SUN_ELEV), THREE.MathUtils.degToRad(SUN_AZIM));
{
  const u = sky.material.uniforms;
  u.turbidity.value = 1.8;
  u.rayleigh.value = 1.15;          // horizonte menos estourado
  u.mieCoefficient.value = 0.0008;  // halo do sol bem contido (sem véu branco)
  u.mieDirectionalG.value = 0.8;
  u.sunPosition.value.copy(sunDir);
  if (u.cloudCoverage) { // nuvens procedurais do Sky no r184
    u.cloudCoverage.value = 0.38;
    u.cloudDensity.value = 0.45;
  }
  // o glare HDR do sol dominava a cena com ACES+bloom; comprime só os highlights
  // (soft-Reinhard: céu azul quase não muda, núcleo do sol capa em ~5.5 e ainda aciona o bloom)
  sky.material.fragmentShader = sky.material.fragmentShader.replace(
    'gl_FragColor = vec4( texColor, 1.0 );',
    'gl_FragColor = vec4( texColor / ( 1.0 + 0.55 * texColor ), 1.0 );'
  );
}

/* ---- luzes ---- */
const hemiLight = new THREE.HemisphereLight(0xa9cdf2, 0x687a4d, 0.42);
scene.add(hemiLight);
const ambLight = new THREE.AmbientLight(0xffffff, 0.16);
scene.add(ambLight);

// Cascaded Shadow Maps — 4 cascatas para sombra nítida perto e barata longe
const csm = new CSM({
  maxFar: CFG.CSM_MAX_FAR,
  cascades: 4,
  mode: 'practical',
  parent: scene,
  shadowMapSize: CFG.SHADOW_MAP_SIZE,
  lightDirection: sunDir.clone().negate().normalize(),
  camera,
  lightIntensity: 1.8,
});
csm.fade = true;
for (const l of csm.lights) {
  l.color.setHex(0xffe7c0);
  l.shadow.bias = -0.00022;
  l.shadow.normalBias = 0.02;
}
// registrar materiais que recebem as cascatas
const csmMaterials = [];
function csmMat(mat) { csm.setupMaterial(mat); csmMaterials.push(mat); return mat; }

/* ---- composer: Render -> Bloom -> SMAA -> Output (Output SEMPRE por último) ---- */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  CFG.BLOOM_STRENGTH, CFG.BLOOM_RADIUS, CFG.BLOOM_THRESHOLD
);
composer.addPass(bloomPass);
const smaaPass = new SMAAPass(window.innerWidth * renderer.getPixelRatio(), window.innerHeight * renderer.getPixelRatio());
composer.addPass(smaaPass);
composer.addPass(new OutputPass());
bloomPass.enabled = +SETTINGS.bloom !== 0;
if (+SETTINGS.shadow === 0) renderer.shadowMap.enabled = false;

/* ================== física (cannon-es) ================== */
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;
world.defaultContactMaterial.friction = 0.3;
world.defaultContactMaterial.restitution = 0.05;

/* heightfield espelhando a MESMA função heightAt do visual */
{
  const elem = 4;
  const n = Math.floor(CFG.WORLD_SIZE / elem) + 1;
  const half = ((n - 1) * elem) / 2;
  const data = [];
  for (let i = 0; i < n; i++) {
    data.push([]);
    for (let j = 0; j < n; j++) {
      data[i].push(heightAt(-half + i * elem, half - j * elem));
    }
  }
  const hfShape = new CANNON.Heightfield(data, { elementSize: elem });
  const hfBody = new CANNON.Body({ mass: 0 });
  hfBody.addShape(hfShape);
  hfBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  hfBody.position.set(-half, 0, half);
  world.addBody(hfBody);
}

/* ================== terreno visual ================== */
const COL_GRASS_A = new THREE.Color(0x55973e); // grama base
const COL_GRASS_B = new THREE.Color(0x6fae4a); // grama clara
const COL_SAND    = new THREE.Color(0xd7c08c);
const COL_ROCK    = new THREE.Color(0x8d8f96);
const COL_DIRT    = new THREE.Color(0x9a7e54);
const COL_FOREST  = new THREE.Color(0x3e7a31);
const COL_SNOW    = new THREE.Color(0xe8eef4);

let terrainMesh;
{
  const g = new THREE.PlaneGeometry(CFG.WORLD_SIZE, CFG.WORLD_SIZE, CFG.TERRAIN_SEGS, CFG.TERRAIN_SEGS);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    const slope = slopeAt(x, z);
    const nVar = simplex.noise(x * 0.02, z * 0.02) * 0.5 + 0.5;
    c.copy(COL_GRASS_A).lerp(COL_GRASS_B, nVar);
    const bio = biomeAt(x, z);
    if (bio < -0.18) c.lerp(COL_SAND, THREE.MathUtils.smoothstep(-bio, 0.18, 0.45));  // bioma deserto
    if (bio > 0.34) c.lerp(COL_FOREST, THREE.MathUtils.smoothstep(bio, 0.34, 0.62));  // bioma floresta
    if (h < 0.9) c.lerp(COL_SAND, THREE.MathUtils.smoothstep(0.9 - h, 0, 1.4));       // baixadas arenosas
    if (slope > 0.45) c.lerp(COL_DIRT, THREE.MathUtils.smoothstep(slope, 0.45, 0.75)); // barranco
    if (slope > 0.7) c.lerp(COL_ROCK, THREE.MathUtils.smoothstep(slope, 0.7, 1.05));   // rocha
    if (h > 17) c.lerp(COL_ROCK, THREE.MathUtils.smoothstep(h, 17, 26));               // topos rochosos
    if (h > 21) c.lerp(COL_SNOW, THREE.MathUtils.smoothstep(h, 21, 28));               // picos nevados
    const dCity = Math.hypot(x - CITY.x, z - CITY.z);
    if (dCity < 62) c.lerp(COL_ROCK, 0.55).multiplyScalar(0.55);                       // asfalto urbano
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  const m = csmMat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0.0 }));
  terrainMesh = new THREE.Mesh(g, m);
  terrainMesh.receiveShadow = true;
  scene.add(terrainMesh);
}

/* ================== água: lagos nas bacias do terreno ================== */
const Water = (() => {
  const uniforms = {
    uTime:    { value: 0 },
    uSunDir:  { value: sunDir.clone().normalize() },
    uDeep:    { value: new THREE.Color(0x14424f) },
    uShallow: { value: new THREE.Color(0x2c7e88) },
    uSky:     { value: new THREE.Color(0xbcd8ee) },
    ...THREE.UniformsLib.fog,
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, fog: true, transparent: true,
    vertexShader: /* glsl */`
      #include <common>
      #include <fog_pars_vertex>
      uniform float uTime;
      varying vec3 vWPos;
      varying vec3 vNorm;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        float w1 = sin(wp.x * 0.12 + uTime * 1.1) * cos(wp.z * 0.1 + uTime * 0.8);
        float w2 = sin(wp.x * 0.31 + wp.z * 0.27 - uTime * 1.7);
        wp.y += w1 * 0.1 + w2 * 0.05;
        vNorm = normalize(vec3(-w2 * 0.22 - w1 * 0.1, 1.0, -w1 * 0.14));
        vWPos = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 uSunDir, uDeep, uShallow, uSky;
      varying vec3 vWPos;
      varying vec3 vNorm;
      void main() {
        vec3 V = normalize(cameraPosition - vWPos);
        float fres = pow(1.0 - max(dot(V, vNorm), 0.0), 2.2);
        vec3 col = mix(uDeep, uShallow, 0.35 + 0.3 * sin(vWPos.x * 0.05 + vWPos.z * 0.06));
        col = mix(col, uSky, fres * 0.75);
        vec3 H = normalize(V + uSunDir);
        col += pow(max(dot(vNorm, H), 0.0), 90.0) * 0.85; // brilho do sol
        gl_FragColor = vec4(col, 0.86);
        #include <fog_fragment>
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const geo = new THREE.PlaneGeometry(CFG.WORLD_SIZE, CFG.WORLD_SIZE, 48, 48);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WATER_LEVEL;
  scene.add(mesh);
  return { update(t) { uniforms.uTime.value = t; }, uniforms };
})();

/* ================================================================
   GRAMA REATIVA — InstancedMesh em chunks que acompanham o player.
   Vento no vertex shader + dobra quando player/carro passam.
   ================================================================ */
const Grass = (() => {
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
        float edgeFade = 1.0 - smoothstep(uPatchRadius * 0.72, uPatchRadius * 0.97, dCam);
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
      // deserto: quase sem grama (lâminas colapsam) e mais baixa nas bordas
      if (desert > 0.05) s *= Math.random() < desert * 0.85 ? 0.02 : (1 - desert * 0.45);
      if (y < WATER_LEVEL + 0.25) s = 0.015; // nada de grama dentro dos lagos
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

  return { update, material, PATCH_RADIUS };
})();

/* ================================================================
   VEGETAÇÃO — árvores (2 LODs), pedras e flores, tudo InstancedMesh
   ================================================================ */
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

function paintGeometry(geo, color) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
const _c = new THREE.Color();

/* árvore "gota de goma": tronco + 3 esferas de copa, mescladas com vertex color */
function treeGeoHigh() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.2, 0.32, 2.8, 7, 1);
  trunk.translate(0, 1.4, 0);
  parts.push(paintGeometry(trunk, _c.setHex(0x6b4a2e)));
  const s1 = new THREE.SphereGeometry(1.95, 12, 9);  s1.scale(1, 0.92, 1);  s1.translate(0, 3.7, 0);
  parts.push(paintGeometry(s1, _c.setHex(0x4e8a35)));
  const s2 = new THREE.SphereGeometry(1.45, 11, 8);  s2.translate(0.55, 4.95, 0.25);
  parts.push(paintGeometry(s2, _c.setHex(0x5d9c3e)));
  const s3 = new THREE.SphereGeometry(1.05, 10, 7);  s3.translate(-0.45, 5.55, -0.2);
  parts.push(paintGeometry(s3, _c.setHex(0x6cab46)));
  return BufferGeometryUtils.mergeGeometries(parts);
}
function treeGeoLow() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.22, 0.34, 2.6, 5, 1);
  trunk.translate(0, 1.3, 0);
  parts.push(paintGeometry(trunk, _c.setHex(0x6b4a2e)));
  const crown = new THREE.SphereGeometry(2.1, 7, 5); crown.scale(1, 1.25, 1); crown.translate(0, 4.3, 0);
  parts.push(paintGeometry(crown, _c.setHex(0x558f39)));
  return BufferGeometryUtils.mergeGeometries(parts);
}

const treeMat = csmMat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }));
const treeHiMesh = new THREE.InstancedMesh(treeGeoHigh(), treeMat, CFG.TREE_COUNT);
const treeLoMesh = new THREE.InstancedMesh(treeGeoLow(), treeMat, CFG.TREE_COUNT);
treeHiMesh.castShadow = treeHiMesh.receiveShadow = true;
treeLoMesh.castShadow = true;
treeHiMesh.frustumCulled = false; // a malha cobre o mapa todo; culling por instância não compensa
treeLoMesh.frustumCulled = false;
scene.add(treeHiMesh, treeLoMesh);

const Structures = createStructures({ clamp, rand, TAU, heightAt, slopeAt, platforms, WATER_LEVEL, CITY, scene, world, csmMat, paintGeometry });

/* paredes das construções também são sólidas pra física dos veículos —
   sem isso carro/caminhão atravessavam prédios, fortes e muros */
for (const b of Structures.walls) {
  if (b.noCollide) continue;
  const hx = (b.x1 - b.x0) / 2, hy = (b.y1 - b.y0) / 2, hz = (b.z1 - b.z0) / 2;
  if (hx < 0.04 || hy < 0.04 || hz < 0.04) continue;
  const wb = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)) });
  wb.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
  world.addBody(wb);
}

const treeSpots = []; // posições das árvores (LOD + minimapa)
{
  const lim = CFG.WORLD_SIZE * 0.47;
  let tries = 0;
  while (treeSpots.length < CFG.TREE_COUNT && tries++ < CFG.TREE_COUNT * 30) {
    const x = rand(-lim, lim), z = rand(-lim, lim);
    if (Math.hypot(x, z) < 26) continue;                       // longe do spawn
    if (slopeAt(x, z) > 0.5) continue;                         // sem árvore em barranco
    const y = heightAt(x, z);
    if (y < 0.8) continue;                                     // nem na areia
    const bio = biomeAt(x, z);
    if (bio < -0.18) continue;                                 // deserto: sem árvores
    // bosques: ruído decide densidade; floresta é bem mais densa
    if (simplex.noise(x * 0.006 + 50, z * 0.006 - 80) < (bio > 0.34 ? -0.3 : 0.05)) continue;
    let nearBuild = false;
    for (const st of Structures.sites) if (Math.hypot(x - st.x, z - st.z) < st.r + 4) { nearBuild = true; break; }
    if (nearBuild) continue;
    const s = rand(0.75, 1.5);
    // variação de cor: verdes, outono dourado e tons profundos por região
    const cv = simplex.noise(x * 0.004 - 90, z * 0.004 + 60);
    const tint = cv > 0.45 ? 0xffaa58 : cv > 0.3 ? 0xffd98a : cv < -0.45 ? 0x7ddf9a : 0xffffff;
    treeSpots.push({ x, y, z, s, rot: rand(TAU), tint });
    addObstacle(x, z, 0.45 * s);
    const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(0.32 * s, 1.8, 0.32 * s)) });
    body.position.set(x, y + 1.8, z);
    world.addBody(body);
  }
}

/* re-balanceia LOD por distância (perto = detalhada, longe = barata) */
const TREE_LOD_DIST = 70;
const _dummy = new THREE.Object3D();
function rebucketTrees(px, pz) {
  let hi = 0, lo = 0;
  for (const t of treeSpots) {
    _dummy.position.set(t.x, t.y - 0.15, t.z);
    _dummy.rotation.set(0, t.rot, 0);
    _dummy.scale.setScalar(t.s);
    _dummy.updateMatrix();
    const d = Math.hypot(t.x - px, t.z - pz);
    if (d < TREE_LOD_DIST) { treeHiMesh.setColorAt(hi, _c.setHex(t.tint)); treeHiMesh.setMatrixAt(hi++, _dummy.matrix); }
    else if (d < CFG.VIEW_DIST) { treeLoMesh.setColorAt(lo, _c.setHex(t.tint)); treeLoMesh.setMatrixAt(lo++, _dummy.matrix); }
  }
  treeHiMesh.count = hi; treeLoMesh.count = lo;
  treeHiMesh.instanceMatrix.needsUpdate = true;
  treeLoMesh.instanceMatrix.needsUpdate = true;
  if (treeHiMesh.instanceColor) treeHiMesh.instanceColor.needsUpdate = true;
  if (treeLoMesh.instanceColor) treeLoMesh.instanceColor.needsUpdate = true;
}

/* pedras: icosaedro deformado, flat shading estilizado */
{
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    _v1.fromBufferAttribute(p, i);
    const n = 1 + simplex.noise(_v1.x * 1.7 + 9, _v1.y * 1.7 - 4 + _v1.z) * 0.28;
    p.setXYZ(i, _v1.x * n, _v1.y * n * 0.78, _v1.z * n);
  }
  g.computeVertexNormals();
  const m = csmMat(new THREE.MeshStandardMaterial({ color: 0x8d929c, roughness: 0.95, metalness: 0.02, flatShading: true }));
  const rocks = new THREE.InstancedMesh(g, m, CFG.ROCK_COUNT);
  rocks.castShadow = rocks.receiveShadow = true;
  rocks.frustumCulled = false;
  const lim = CFG.WORLD_SIZE * 0.47;
  let placed = 0, tries = 0;
  while (placed < CFG.ROCK_COUNT && tries++ < CFG.ROCK_COUNT * 20) {
    const x = rand(-lim, lim), z = rand(-lim, lim);
    if (Math.hypot(x, z) < 18) continue;
    const s = Math.pow(Math.random(), 2.2) * 2.6 + 0.35;
    const y = heightAt(x, z) - s * 0.3;
    _dummy.position.set(x, y, z);
    _dummy.rotation.set(rand(-0.3, 0.3), rand(TAU), rand(-0.3, 0.3));
    _dummy.scale.set(s * rand(0.8, 1.3), s, s * rand(0.8, 1.3));
    _dummy.updateMatrix();
    rocks.setMatrixAt(placed++, _dummy.matrix);
    if (s > 1.1) {
      addObstacle(x, z, s * 0.8);
      const body = new CANNON.Body({ mass: 0, shape: new CANNON.Sphere(s * 0.75) });
      body.position.set(x, y + s * 0.2, z);
      world.addBody(body);
    }
  }
  rocks.count = placed;
  scene.add(rocks);
}

/* flores: cruz de 2 quads, cores vivas pro bloom dar um brilho sutil */
{
  const q1 = new THREE.PlaneGeometry(0.22, 0.22); q1.translate(0, 0.11, 0);
  const q2 = q1.clone(); q2.rotateY(Math.PI / 2);
  const g = BufferGeometryUtils.mergeGeometries([q1, q2]);
  const m = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.7, emissiveIntensity: 0.25 });
  const flowers = new THREE.InstancedMesh(g, m, CFG.FLOWER_COUNT);
  flowers.frustumCulled = false;
  const palette = [0xfff3c4, 0xffd24d, 0xff7e5f, 0xc98bff, 0xff9ad5, 0xfdfdfd];
  const lim = CFG.WORLD_SIZE * 0.45;
  let placed = 0, tries = 0;
  while (placed < CFG.FLOWER_COUNT && tries++ < CFG.FLOWER_COUNT * 8) {
    const x = rand(-lim, lim), z = rand(-lim, lim);
    if (slopeAt(x, z) > 0.4) continue;
    const y = heightAt(x, z);
    if (y < 0.9) continue;
    if (biomeAt(x, z) < -0.12) continue; // sem flores no deserto
    if (simplex.noise(x * 0.01 - 200, z * 0.01 + 140) < 0.18) continue; // em manchas
    _dummy.position.set(x, y, z);
    _dummy.rotation.set(0, rand(TAU), 0);
    _dummy.scale.setScalar(rand(0.7, 1.5));
    _dummy.updateMatrix();
    flowers.setMatrixAt(placed, _dummy.matrix);
    flowers.setColorAt(placed, _c.setHex(palette[(Math.random() * palette.length) | 0]));
    placed++;
  }
  flowers.count = placed;
  if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
  scene.add(flowers);
}

/* cactos saguaro no deserto */
{
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.18, 0.23, 2.4, 9);
  trunk.translate(0, 1.2, 0);
  parts.push(paintGeometry(trunk, _c.setHex(0x3f7d46)));
  const cap = new THREE.SphereGeometry(0.18, 9, 6);
  cap.translate(0, 2.4, 0);
  parts.push(paintGeometry(cap, _c.setHex(0x4a8c50)));
  const a1h = new THREE.CylinderGeometry(0.1, 0.1, 0.5, 7); a1h.rotateZ(Math.PI / 2); a1h.translate(0.34, 1.15, 0);
  parts.push(paintGeometry(a1h, _c.setHex(0x3f7d46)));
  const a1v = new THREE.CylinderGeometry(0.1, 0.1, 0.85, 7); a1v.translate(0.56, 1.6, 0);
  parts.push(paintGeometry(a1v, _c.setHex(0x4a8c50)));
  const a2h = new THREE.CylinderGeometry(0.09, 0.09, 0.4, 7); a2h.rotateZ(Math.PI / 2); a2h.translate(-0.3, 1.55, 0);
  parts.push(paintGeometry(a2h, _c.setHex(0x3f7d46)));
  const a2v = new THREE.CylinderGeometry(0.09, 0.09, 0.6, 7); a2v.translate(-0.47, 1.88, 0);
  parts.push(paintGeometry(a2v, _c.setHex(0x4a8c50)));
  const geo = BufferGeometryUtils.mergeGeometries(parts);
  const m = csmMat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
  const cacti = new THREE.InstancedMesh(geo, m, 160);
  cacti.castShadow = true;
  cacti.frustumCulled = false;
  const limC = CFG.WORLD_SIZE * 0.47;
  let nCac = 0, triesC = 0;
  while (nCac < 160 && triesC++ < 4000) {
    const x = rand(-limC, limC), z = rand(-limC, limC);
    if (biomeAt(x, z) > -0.25 || slopeAt(x, z) > 0.4) continue;
    if (heightAt(x, z) < WATER_LEVEL + 0.5) continue; // cacto não nasce no lago
    _dummy.position.set(x, heightAt(x, z), z);
    _dummy.rotation.set(0, rand(TAU), rand(-0.06, 0.06));
    _dummy.scale.setScalar(rand(0.7, 1.5));
    _dummy.updateMatrix();
    cacti.setMatrixAt(nCac++, _dummy.matrix);
    addObstacle(x, z, 0.35);
  }
  cacti.count = nCac;
  scene.add(cacti);
}

const FX = createFX({ rand, _v1, scene, camera });

/* ================== HUD: helpers ================== */
const $ = id => document.getElementById(id);
const ui = {
  hud: $('hud'), crosshair: $('crosshair'), hitmarker: $('hitmarker'),
  healthFill: $('healthFill'), ammoMag: $('ammoMag'), ammoReserve: $('ammoReserve'),
  damageFlash: $('damageFlash'), healLow: $('healLow'), killfeed: $('killfeed'),
  prompt: $('prompt'), centerMsg: $('centerMsg'), speedo: $('speedo'), speedVal: $('speedVal'),
  ammoWrap: $('ammoWrap'), overlay: $('overlay'), fps: $('fps'), minimap: $('minimap'),
  weaponName: $('weaponName'), slots: $('slots'), scoreVal: $('scoreVal'), killsVal: $('killsVal'),
  nadeCount: $('nadeCount'), medCount: $('medCount'), invNade: $('invNade'), invMed: $('invMed'),
  bossWrap: $('bossWrap'), bossFill: $('bossFill'), dmgDir: $('dmgDir'), banner: $('banner'),
  scope: $('scope'), waterTint: $('waterTint'), healFx: $('healFx'), armorFill: $('armorFill'),
  missionText: $('missionText'), invPanel: $('invPanel'), invList: $('invList'), deathScreen: $('deathScreen'),
};
let bannerTimer = null;
function showBanner(html, dur = 3500) {
  ui.banner.innerHTML = html;
  ui.banner.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => ui.banner.classList.remove('show'), dur);
}

let hitmarkerTimer = null;
function showHitmarker(kill) {
  ui.hitmarker.classList.toggle('kill', !!kill);
  ui.hitmarker.classList.add('show');
  clearTimeout(hitmarkerTimer);
  hitmarkerTimer = setTimeout(() => ui.hitmarker.classList.remove('show'), kill ? 220 : 110);
}
function addKillFeed(html) {
  const div = document.createElement('div');
  div.className = 'kf';
  div.innerHTML = html;
  ui.killfeed.prepend(div);
  while (ui.killfeed.children.length > 5) ui.killfeed.lastChild.remove();
  setTimeout(() => { div.style.opacity = '0'; }, 3600);
  setTimeout(() => div.remove(), 4400);
}
let flashT = 0;
function damageFlash(strength = 1) {
  flashT = Math.max(flashT, 0.5 * strength);
}
let msgTimer = null;
function centerMsg(text, dur = 1800) {
  ui.centerMsg.textContent = text;
  ui.centerMsg.style.opacity = '1';
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => ui.centerMsg.style.opacity = '0', dur);
}

/* números de dano flutuantes (pool de divs) */
const DmgNums = createDmgNums({ rand, _v1, camera });

/* ================================================================
   ARMA EM PRIMEIRA PESSOA — modelo procedural + sway/bob/ADS/recoil
   ================================================================ */
scene.add(camera); // necessário p/ renderizar filhos da câmera (a arma)

const { weaponRoot, weaponKick, arsenal, knuckleMat } = createWeapons({ camera });
function unlockWeapon(i, msg) {
  if (!arsenal[i].locked) return;
  arsenal[i].locked = false;
  SFX.unlock();
  showBanner(`${arsenal[i].name} DESBLOQUEADA<small>${msg || 'pressione ' + (i + 1) + ' para equipar'}</small>`, 4200);
  updateSlotsHUD();
}
let gun = arsenal[0];
gun.group.visible = true;
let switchAnim = 1; // 0 = arma abaixada, 1 = pronta

/* flash do cano: compartilhado, reanexado à arma ativa */
const muzzle = new THREE.Group();
const muzzleMatFlash = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
{
  const q = new THREE.PlaneGeometry(0.34, 0.34);
  const f1 = new THREE.Mesh(q, muzzleMatFlash);
  const f2 = new THREE.Mesh(q, muzzleMatFlash); f2.rotation.y = Math.PI / 2;
  const f3 = new THREE.Mesh(q, muzzleMatFlash); f3.rotation.x = Math.PI / 2;
  muzzle.add(f1, f2, f3);
}
const muzzleLight = new THREE.PointLight(0xffc274, 0, 11, 2.2);
muzzle.add(muzzleLight);
gun.muzzleAnchor.add(muzzle);
let muzzleT = 0;
function muzzleFlash(scale = 1) {
  muzzleT = 0.05;
  muzzle.rotation.z = rand(TAU);
  muzzle.scale.setScalar(rand(0.8, 1.35) * scale);
}

function updateSlotsHUD() {
  ui.slots.innerHTML = arsenal.map((w, i) =>
    `<div class="slot${w === gun ? ' active' : ''}" style="${w.locked ? 'opacity:.35' : ''}"><b>${i + 1}</b>${w.locked ? '🔒 ' : ''}${w.name}</div>`).join('');
}
function switchWeapon(idx) {
  if (arsenal[idx] === gun || state.driving) return;
  if (arsenal[idx].locked) { centerMsg('Arma trancada — encontre-a explorando o mundo', 1400); return; }
  gun.reloading = false; // troca cancela recarga
  gun.group.visible = false;
  gun = arsenal[idx];
  gun.group.visible = true;
  gun.muzzleAnchor.add(muzzle);
  switchAnim = 0;
  SFX.switchW();
  updateAmmoHUD();
  updateSlotsHUD();
}
weaponRoot.position.copy(gun.hipV);

/* ================== controles / input ================== */
const controls = new PointerLockControls(camera, document.body);

const state = {
  started: false, paused: true, pointerLocked: false, lockFailed: false,
  driving: false, flying: false, gameTime: 0,
};

const keys = {};
const justPressed = new Set();
window.addEventListener('keydown', e => {
  // digitando num campo (nick, chat, código do anfitrião): o jogo não captura teclas
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (e.code === 'Space' || e.code === 'ControlLeft' || e.code === 'Tab') e.preventDefault();
  if (!keys[e.code]) justPressed.add(e.code);
  keys[e.code] = true;
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

const mouse = { shooting: false, aiming: false, clicked: false, swayX: 0, swayY: 0 };
window.addEventListener('mousedown', e => {
  if (!state.started || state.paused) return;
  if (e.button === 0) { mouse.shooting = true; mouse.clicked = true; }
  if (e.button === 2) mouse.aiming = true;
});
window.addEventListener('wheel', e => {
  if (!state.started || state.paused || state.driving) return;
  const stepDir = e.deltaY > 0 ? 1 : arsenal.length - 1;
  let idx = arsenal.indexOf(gun);
  for (let n = 0; n < arsenal.length; n++) {
    idx = (idx + stepDir) % arsenal.length;
    if (!arsenal[idx].locked) break;
  }
  switchWeapon(idx);
}, { passive: true });
window.addEventListener('mouseup', e => {
  if (e.button === 0) mouse.shooting = false;
  if (e.button === 2) mouse.aiming = false;
});
window.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('mousemove', e => {
  if (!state.pointerLocked) return;
  mouse.swayX += e.movementX;
  mouse.swayY += e.movementY;
});

controls.addEventListener('lock', () => {
  state.pointerLocked = true;
  if (state.started) setPaused(false);
});
controls.addEventListener('unlock', () => {
  state.pointerLocked = false;
  if (state.started && !state.lockFailed) setPaused(true);
});

function setPaused(p) {
  state.paused = p;
  ui.overlay.classList.toggle('hidden', !p);
  ui.overlay.classList.toggle('paused', p && state.started);
  ui.hud.classList.toggle('on', !p);
}

/* ================================================================
   PLAYER — controlador FPS (movimento, pulo, agachar, game feel)
   ================================================================ */
const player = {
  pos: new THREE.Vector3(0, heightAt(0, 4) , 4), // pés
  vel: new THREE.Vector3(),
  onGround: true,
  eyeH: 1.62, crouchT: 0,
  radius: 0.42,
  health: 100, maxHealth: 100,
  lastDamageT: -99, dead: false,
  coyote: 0,
  bobTime: 0, bobAmp: 0,
  landDip: 0, landDipVel: 0,
  stepAcc: 0,
  slideT: -1, slideDir: new THREE.Vector3(),
  healPool: 0, invulnUntil: 0,
  armor: 0, armorMax: 50, // escudo azul (recompensa do COLOSSO)
};
const WALK_SPEED = 5.2, RUN_SPEED = 8.6, CROUCH_SPEED = 2.6, ADS_SPEED = 3.4;
const GRAVITY = 22, JUMP_VEL = 8.4;

let fovCur = 75;
let adsT = 0;          // 0 = hip, 1 = mirando
let sprintT = 0;
const swayPos = new THREE.Vector3(), swayRot = new THREE.Vector3();
let trauma = 0;        // screen shake 0..1
function addTrauma(t) { trauma = Math.min(1, trauma + t); }

/* recoil com mola (impulso + retorno suave) */
const recoil = {
  pitch: 0, pitchVel: 0, yaw: 0, yawVel: 0,
  applied: 0, appliedYaw: 0,
  kickZ: 0, kickRot: 0, shotIdx: 0, lastShotT: -9,
};

function playerUpdate(dt, t) {
  const sprintHeld = keys['ShiftLeft'] || keys['ShiftRight'];
  const crouchHeld = keys['ControlLeft'] || keys['ControlRight'];
  const fwd = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);
  const str = (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0);

  const sliding = player.slideT > 0;
  player.crouchT = damp(player.crouchT, (crouchHeld || sliding) ? 1 : 0, 12, dt);
  const sprinting = sprintHeld && fwd > 0 && !mouse.aiming && !mouse.shooting && player.crouchT < 0.4 && player.onGround && !sliding;

  // deslizar (CTRL durante o sprint) — com cooldown de 0.3s
  const spdNow = Math.hypot(player.vel.x, player.vel.z);
  if (justPressed.has('ControlLeft') && sprintHeld && fwd > 0 && player.onGround && spdNow > 6 && player.slideT <= -0.3) {
    player.slideT = 0.78;
    player.slideDir.set(player.vel.x, 0, player.vel.z).normalize();
    SFX.slide();
  }
  player.slideT -= dt;

  // direção desejada no plano XZ a partir do yaw da câmera
  _v1.set(0, 0, -1).applyQuaternion(camera.quaternion); _v1.y = 0; _v1.normalize();
  _v2.set(1, 0, 0).applyQuaternion(camera.quaternion);  _v2.y = 0; _v2.normalize();
  _v3.set(0, 0, 0).addScaledVector(_v1, fwd).addScaledVector(_v2, str);
  if (_v3.lengthSq() > 1) _v3.normalize();

  let speed = WALK_SPEED;
  if (sprinting) speed = RUN_SPEED;
  if (mouse.aiming) speed = ADS_SPEED;
  speed = lerp(speed, CROUCH_SPEED, player.crouchT);
  if (player.pos.y < WATER_LEVEL + 0.6) speed *= 0.45; // vadear água pesa

  // aceleração suave, independente de framerate (deslizar tem prioridade)
  if (player.slideT > 0) {
    const k = clamp(player.slideT / 0.78, 0, 1);
    const sp = 10.6 * (0.3 + 0.7 * k);
    player.vel.x = damp(player.vel.x, player.slideDir.x * sp, 8, dt);
    player.vel.z = damp(player.vel.z, player.slideDir.z * sp, 8, dt);
  } else {
    const accelK = player.onGround ? 11 : 2.6;
    player.vel.x = damp(player.vel.x, _v3.x * speed, accelK, dt);
    player.vel.z = damp(player.vel.z, _v3.z * speed, accelK, dt);
  }

  // gravidade + pulo (com coyote time)
  player.vel.y -= GRAVITY * dt;
  if (player.onGround) player.coyote = 0.12; else player.coyote -= dt;
  if (justPressed.has('Space') && player.coyote > 0 && (player.crouchT < 0.5 || player.slideT > 0)) {
    player.vel.y = JUMP_VEL;
    player.onGround = false; player.coyote = 0;
    player.slideT = 0; // pulo cancela o deslize
    SFX.jump();
  }

  player.pos.addScaledVector(player.vel, dt);

  // colisão com chão (terreno OU plataforma/andar de prédio)
  const groundY = groundAt(player.pos.x, player.pos.z, player.pos.y);
  const wasGrounded = player.onGround;
  if (player.pos.y <= groundY) {
    if (!wasGrounded && player.vel.y < -7) {
      player.landDipVel = player.vel.y * 0.016;
      addTrauma(Math.min(0.35, -player.vel.y * 0.018));
      SFX.land();
    }
    player.pos.y = groundY;
    player.vel.y = Math.max(0, player.vel.y);
    player.onGround = true;
  } else if (wasGrounded && player.vel.y <= 0 && player.pos.y - groundY < 0.55) {
    // gruda no chão em descidas (evita "voinhos" que cortam o sprint)
    player.pos.y = groundY;
    player.vel.y = 0;
    player.onGround = true;
  } else {
    player.onGround = false;
  }

  // colisão com árvores/pedras (push-out por círculo)
  for (const o of obstaclesNear(player.pos.x, player.pos.z)) {
    const dx = player.pos.x - o.x, dz = player.pos.z - o.z;
    const d = Math.hypot(dx, dz), min = o.r + player.radius;
    if (d < min && d > 1e-4) {
      player.pos.x = o.x + dx / d * min;
      player.pos.z = o.z + dz / d * min;
    }
  }
  Structures.collide(player.pos, player.radius, 1.7); // paredes das construções
  // colisão com veículos (círculo aproximado do chassi — antes dava pra atravessar)
  if (!state.driving) for (const v of Car.vehicles) {
    const vp = v.group.position;
    if (Math.abs(player.pos.y - vp.y) > 3) continue;
    const r = Math.max(v.cfg.half[0], v.cfg.half[2]) * 0.9 + player.radius;
    const dx = player.pos.x - vp.x, dz = player.pos.z - vp.z;
    const d = Math.hypot(dx, dz);
    if (d < r && d > 1e-4) { player.pos.x = vp.x + dx / d * r; player.pos.z = vp.z + dz / d * r; }
  }
  // limites do mundo
  const lim = CFG.WORLD_SIZE * 0.49;
  player.pos.x = clamp(player.pos.x, -lim, lim);
  player.pos.z = clamp(player.pos.z, -lim, lim);

  // ---- game feel: bob, dip de aterrissagem, passos ----
  const spdXZ = Math.hypot(player.vel.x, player.vel.z);
  const moving = spdXZ > 0.5 && player.onGround;
  player.bobAmp = damp(player.bobAmp, moving ? Math.min(1, spdXZ / RUN_SPEED) : 0, 8, dt);
  player.bobTime += dt * (5.6 + spdXZ * 0.85);
  // mola do dip de pouso
  player.landDipVel += (-player.landDip * 130 - player.landDipVel * 11) * dt;
  player.landDip += player.landDipVel * dt;
  // passos sincronizados com o bob
  if (moving) {
    player.stepAcc += spdXZ * dt;
    const stride = sprinting ? 2.6 : 1.9;
    if (player.stepAcc > stride) { player.stepAcc = 0; SFX.step(sprinting); }
  }

  // kit médico: cura gradual
  if (player.healPool > 0 && !player.dead && player.health < player.maxHealth) {
    const h = Math.min(player.healPool, 55 * dt, player.maxHealth - player.health);
    player.health += h;
    player.healPool -= 55 * dt;
    updateHealthHUD();
  }
  // regeneração estilo CoD após 5s sem dano
  if (!player.dead && player.health < player.maxHealth && t - player.lastDamageT > 5) {
    player.health = Math.min(player.maxHealth, player.health + 14 * dt);
    updateHealthHUD();
  }

  adsT = damp(adsT, (mouse.aiming && !state.driving) ? 1 : 0, 13, dt);
  sprintT = damp(sprintT, sprinting ? 1 : 0, 8, dt);
}

/* ================================================================
   CÂMERA FPS + ARMA POR FRAME — sway, bob, ADS, recoil, screen shake
   ================================================================ */
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
let csmDirty = false;
let leanRoll = 0;
let dmgDirT = 0;
let breathApplied = 0; // respiração da luneta (delta aplicado no frame anterior)
let deathK = 0;        // animação de morte (câmera tomba)

function applyFpsCamera(dt, t) {
  // ---- screen shake (trauma decai, intensidade = trauma²) ----
  trauma = Math.max(0, trauma - dt * 1.7);
  const sh = trauma * trauma;
  const shakeRoll = (Math.sin(t * 41) * 0.5 + Math.sin(t * 23.7) * 0.5) * sh * 0.05;
  const shakeX = Math.sin(t * 37.2) * sh * 0.05;
  const shakeY = Math.cos(t * 43.7) * sh * 0.05;

  // ---- molas do recoil ----
  recoil.pitchVel += (-recoil.pitch * 210 - recoil.pitchVel * 15) * dt;
  recoil.pitch += recoil.pitchVel * dt;
  recoil.yawVel += (-recoil.yaw * 210 - recoil.yawVel * 15) * dt;
  recoil.yaw += recoil.yawVel * dt;
  recoil.kickZ = damp(recoil.kickZ, 0, 13, dt);
  recoil.kickRot = damp(recoil.kickRot, 0, 11, dt);

  // luneta (zoom forte, ex.: DMR): 0..1 quando quase totalmente mirado
  const scopedK = gun.adsFov < 32 ? clamp((adsT - 0.7) / 0.3, 0, 1) : 0;
  const breath = (Math.sin(t * 1.5) * 0.0011 + Math.sin(t * 0.83) * 0.0007) * scopedK;

  // aplica delta do recoil + respiração na rotação da câmera (compatível com PointerLock)
  _euler.setFromQuaternion(camera.quaternion);
  _euler.x += (recoil.pitch - recoil.applied) + (breath - breathApplied);
  _euler.y += (recoil.yaw - recoil.appliedYaw);
  breathApplied = breath;
  recoil.applied = recoil.pitch;
  recoil.appliedYaw = recoil.yaw;
  const strafe = (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0);
  const slideK = clamp(player.slideT / 0.78, 0, 1);
  deathK = player.dead ? Math.min(1, deathK + dt * 1.5) : 0;
  leanRoll = damp(leanRoll, state.driving ? 0 : (-strafe * 0.014 - slideK * 0.06), 7, dt);
  _euler.z = shakeRoll + leanRoll + deathK * 0.85; // tomba ao morrer
  _euler.x = clamp(_euler.x, -1.55, 1.55);
  camera.quaternion.setFromEuler(_euler);

  // ---- posição do olho: altura (agachar), bob, dip de pouso, shake ----
  const eyeH = lerp(1.62, 1.04, player.crouchT) * (1 - deathK * 0.78); // cai no chão ao morrer
  const bobScale = 1 - adsT * 0.82;
  const bobY = Math.sin(player.bobTime * 2) * 0.046 * player.bobAmp * bobScale;
  const bobX = Math.cos(player.bobTime) * 0.034 * player.bobAmp * bobScale;
  _v2.set(1, 0, 0).applyQuaternion(camera.quaternion);
  camera.position.copy(player.pos);
  camera.position.y += eyeH + bobY * 0.55 + player.landDip;
  camera.position.addScaledVector(_v2, bobX * 0.4 + shakeX);
  camera.position.y += shakeY;

  // ---- sway da arma (acompanha o mouse com atraso) ----
  const swTX = clamp(-mouse.swayX * 0.0021, -0.09, 0.09);
  const swTY = clamp(-mouse.swayY * 0.0021, -0.09, 0.09);
  mouse.swayX = 0; mouse.swayY = 0;
  swayRot.x = damp(swayRot.x, swTY * (1 - adsT * 0.7), 9, dt);
  swayRot.y = damp(swayRot.y, swTX * (1 - adsT * 0.7), 9, dt);
  swayPos.x = damp(swayPos.x, swTX * 0.55, 9, dt);
  swayPos.y = damp(swayPos.y, -swTY * 0.4, 9, dt);

  // ---- troca de arma (abaixa/levanta) + pose de sprint (arma erguida, CoD) ----
  switchAnim = Math.min(1, switchAnim + dt * 3.4);
  const ads = adsT * adsT * (3 - 2 * adsT); // smoothstep
  const lower = 1 - switchAnim;
  const sprintPose = sprintT * (1 - ads) * (gun.reloading ? 0.25 : 1);
  weaponRoot.position.lerpVectors(gun.hipV, gun.adsV, ads);
  weaponRoot.position.x += (bobX * 0.55 + swayPos.x) * bobScale - sprintPose * 0.055;
  weaponRoot.position.y += (bobY + swayPos.y) * bobScale + Math.sin(t * 1.7) * 0.0035 * (1 - adsT)
                         - lower * 0.3 - sprintPose * 0.02;
  weaponRoot.position.z += sprintPose * 0.07;
  weaponRoot.rotation.set(
    swayRot.x + sprintPose * 0.55 - lower * 0.7,
    swayRot.y + sprintPose * 0.24,
    swayRot.y * 0.6 + leanRoll * 2.2 + sprintPose * 0.2
  );

  // ---- recarga em fases: inclina -> tira o pente -> encaixa -> tapa -> ferrolho ----
  let slap = 0, boltK = 0;
  if (gun.reloading) {
    const k = clamp(1 - (gun.reloadEnd - t) / gun.reloadTime, 0, 1);
    const tilt = THREE.MathUtils.smoothstep(k, 0, 0.16) * (1 - THREE.MathUtils.smoothstep(k, 0.8, 0.97));
    const magOut = THREE.MathUtils.smoothstep(k, 0.14, 0.3);
    const magIn = THREE.MathUtils.smoothstep(k, 0.48, 0.66);
    const magDrop = magOut * (1 - magIn);
    slap = Math.sin(clamp((k - 0.66) / 0.12, 0, 1) * Math.PI);
    boltK = Math.sin(clamp((k - 0.82) / 0.15, 0, 1) * Math.PI);
    weaponRoot.rotation.x += tilt * 0.32;
    weaponRoot.rotation.z -= tilt * 0.38;
    weaponRoot.position.y -= tilt * 0.07;
    if (gun.parts.mag) {
      const b = gun.parts.mag.userData.base;
      gun.parts.mag.position.y = b.y - magDrop * 0.19;
      gun.parts.mag.rotation.x = b.rx - magDrop * 0.55;
    }
    if (gun.parts.pump) { // escopeta: bombeia durante a recarga
      const cyc = (k > 0.25 && k < 0.95) ? Math.max(0, Math.sin(k * Math.PI * 4)) : 0;
      gun.parts.pump.position.z = gun.parts.pump.userData.z0 + cyc * 0.085;
    }
  } else if (gun.parts.mag) {
    const b = gun.parts.mag.userData.base;
    gun.parts.mag.position.y = b.y;
    gun.parts.mag.rotation.x = b.rx;
  }
  // mão esquerda acompanha o pente durante a recarga (sai da arma e volta)
  if (gun.parts.handL) {
    const hb = gun.parts.handL.userData.base;
    if (gun.reloading) {
      const k = clamp(1 - (gun.reloadEnd - t) / gun.reloadTime, 0, 1);
      if (gun.parts.mag) {
        const grab = THREE.MathUtils.smoothstep(k, 0.06, 0.18) * (1 - THREE.MathUtils.smoothstep(k, 0.72, 0.85));
        _v1.copy(gun.parts.mag.position); _v1.y -= 0.08; _v1.z += 0.03;
        gun.parts.handL.position.lerpVectors(hb.p, _v1, grab);
        gun.parts.handL.rotation.x = hb.rx + grab * 0.5;
      } else { // escopeta: mão vai à porta de carregamento inserindo cartuchos
        const grab = THREE.MathUtils.smoothstep(k, 0.15, 0.3) * (1 - THREE.MathUtils.smoothstep(k, 0.85, 0.95));
        const bob = Math.abs(Math.sin(k * Math.PI * 5)) * 0.025;
        gun.parts.handL.position.set(lerp(hb.p.x, 0.05, grab), lerp(hb.p.y, -0.05 + bob, grab), lerp(hb.p.z, 0.06, grab));
      }
    } else {
      gun.parts.handL.position.copy(hb.p);
      gun.parts.handL.rotation.x = hb.rx;
    }
  }
  // animação de cura: arma abaixa, vinheta verde pulsa
  healAnimT = Math.max(0, healAnimT - dt);
  if (healAnimT > 0) {
    const hk = Math.sin(Math.min(1, (1.3 - healAnimT) / 1.3) * Math.PI);
    weaponRoot.position.y -= hk * 0.16;
    weaponRoot.rotation.x -= hk * 0.35;
    ui.healFx.style.opacity = (hk * 0.9).toFixed(2);
  } else if (player.healPool > 0) {
    ui.healFx.style.opacity = '0.35';
  } else {
    ui.healFx.style.opacity = '0';
  }

  // ciclo pós-tiro (bomba da escopeta / ferrolho do DMR)
  gun.cycleT = Math.max(0, gun.cycleT - dt);
  if (gun.parts.pump && !gun.reloading) {
    const ph = gun.cycleT > 0 ? Math.sin((1 - gun.cycleT / 0.55) * Math.PI) : 0;
    gun.parts.pump.position.z = gun.parts.pump.userData.z0 + ph * 0.09;
  }
  if (gun.parts.bolt) {
    const ph = gun.cycleT > 0 ? Math.sin((1 - gun.cycleT / 0.32) * Math.PI) : 0;
    gun.parts.bolt.position.z = gun.parts.bolt.userData.z0 + (ph + boltK) * 0.05;
  }

  weaponKick.position.z = recoil.kickZ;
  weaponKick.position.y = -slap * 0.03;
  weaponKick.rotation.x = recoil.kickRot + slap * 0.07;
  weaponRoot.visible = !state.driving && !state.flying && scopedK < 0.85; // na luneta, vê só o retículo

  // ---- flash do cano ----
  muzzleT = Math.max(0, muzzleT - dt);
  const mk = muzzleT / 0.05;
  muzzleMatFlash.opacity = mk * 0.95;
  muzzleLight.intensity = mk * 26;

  // ---- luneta: overlay + sensibilidade do mouse reduzida no zoom ----
  ui.scope.style.opacity = scopedK.toFixed(2);
  controls.pointerSpeed = lerp(1, gun.adsFov < 40 ? 0.36 : 0.75, ads);

  // ---- FOV: 75 base, 85 correndo, ADS por arma (55 / 62 / 26) ----
  let fovTarget = state.driving ? 72 : lerp(lerp(75, 85, sprintT), gun.adsFov, ads);
  const newFov = damp(fovCur, fovTarget, 11, dt);
  if (Math.abs(newFov - fovCur) > 0.001) {
    fovCur = newFov;
    camera.fov = fovCur;
    camera.updateProjectionMatrix();
    csmDirty = true;
  }

  // ---- mira dinâmica (abre com movimento, some no ADS) ----
  const spd = Math.hypot(player.vel.x, player.vel.z);
  const gap = 7 + spd * 1.4 + trauma * 18 + (player.onGround ? 0 : 9);
  ui.crosshair.style.setProperty('--gap', gap.toFixed(1) + 'px');
  ui.crosshair.style.opacity = (adsT > 0.55 || state.driving) ? '0' : '1';

  // flash de dano decai + indicador de direção
  flashT = Math.max(0, flashT - dt * 1.4);
  ui.damageFlash.style.opacity = Math.min(1, flashT * 1.6).toFixed(2);
  dmgDirT = Math.max(0, dmgDirT - dt);
  ui.dmgDir.style.opacity = dmgDirT > 0 ? '1' : '0';
  // tinta azulada quando a câmera mergulha
  ui.waterTint.style.opacity = camera.position.y < WATER_LEVEL ? '1' : '0';
}

/* ================================================================
   TIRO — hitscan com raycast, recoil com padrão, balística visual
   ================================================================ */
/* ---- inventário, pontuação, kit médico ---- */
const inventory = { nades: 3, nadesMax: 5, medkits: 1, medkitsMax: 3, meat: 0, meatMax: 6 };
let healAnimT = 0;
function updateInvHUD() {
  ui.nadeCount.textContent = inventory.nades;
  ui.medCount.textContent = inventory.medkits;
  ui.invNade.classList.toggle('zero', inventory.nades === 0);
  ui.invMed.classList.toggle('zero', inventory.medkits === 0);
}
let score = 0, kills = 0;
function addScore(pts, isKill) {
  score += pts;
  if (isKill) kills++;
  ui.scoreVal.textContent = score;
  ui.killsVal.textContent = kills;
}
function useMedkit(t) {
  if (inventory.medkits <= 0 || player.dead || player.health >= player.maxHealth - 1) return;
  inventory.medkits--;
  player.healPool = 65; // cura ao longo do tempo
  healAnimT = 1.3;      // animação da mão erguendo o kit
  SFX.medkit();
  updateInvHUD();
}
function eatMeat() {
  if (inventory.meat <= 0 || player.dead || player.health >= player.maxHealth - 1) return;
  inventory.meat--;
  player.healPool = 38;
  healAnimT = 1.0;
  SFX.eat();
  updateInvHUD();
}

/* ---- recarga (por arma) ---- */
function updateAmmoHUD() {
  ui.ammoMag.textContent = gun.melee ? '—' : gun.mag;
  ui.ammoMag.classList.toggle('empty', !gun.melee && gun.mag === 0);
  ui.ammoReserve.textContent = gun.melee ? '' : '| ' + gun.reserve;
  ui.weaponName.textContent = gun.name;
}
function startReload(t) {
  if (gun.reloading || gun.mag === gun.magSize || gun.reserve <= 0) return;
  gun.reloading = true;
  gun.reloadEnd = t + gun.reloadTime;
  SFX.reload();
}
function finishReload() {
  const take = Math.min(gun.magSize - gun.mag, gun.reserve);
  gun.mag += take; gun.reserve -= take;
  gun.reloading = false;
  updateAmmoHUD();
}

/* marcha ao longo do raio testando terreno e troncos (LOS barato em heightfield) */
function rayBlockedAt(origin, dir, maxDist) {
  const wallT = Structures.rayHit(origin, dir, maxDist); // paredes param bala
  const lim = Math.min(maxDist, wallT);
  const step = 1.6;
  for (let d = step; d < lim; d += step) {
    const x = origin.x + dir.x * d, y = origin.y + dir.y * d, z = origin.z + dir.z * d;
    if (y < heightAt(x, z)) return d - step * 0.5;
    if (y < heightAt(x, z) + 3.4) { // só checa árvores perto do chão
      for (const o of obstaclesNear(x, z)) {
        if ((x - o.x) * (x - o.x) + (z - o.z) * (z - o.z) < o.r * o.r * 0.8) return d;
      }
    }
  }
  return wallT;
}

const _rayDir = new THREE.Vector3(), _rayOrig = new THREE.Vector3(), _hitPos = new THREE.Vector3();
const _hitAgg = new THREE.Vector3();
function fire(t) {
  // faca (melee): golpe curto, sem munição/flash/som de tiro
  if (gun.melee) {
    gun.cycleT = 0.34;
    addTrauma(0.06);
    recoil.kickZ += 0.12; recoil.kickRot += 0.1;
    SFX.switchW();
    camera.getWorldPosition(_rayOrig);
    camera.getWorldDirection(_rayDir);
    if (window.__BR_melee) window.__BR_melee(_rayOrig, _rayDir, gun.dmg);
    return;
  }
  gun.mag--;
  updateAmmoHUD();
  muzzleFlash(gun.pellets > 1 ? 1.5 : 1);
  if (gun.laser) SFX.laser();
  else SFX.shot(gun.pellets > 1 ? 'shotgun' : gun.adsFov < 40 ? 'dmr' : 'rifle');
  addTrauma(0.08 + gun.kick * 1.1);
  lastShotInfo.pos.copy(player.pos);
  lastShotInfo.t = t;
  if (!gun.auto) gun.cycleT = gun.pellets > 1 ? 0.55 : 0.32; // anima bomba/ferrolho

  // bazuca: dispara foguete físico em vez de hitscan
  if (gun.rocket) {
    SFX.rocket();
    addTrauma(0.5);
    recoil.pitchVel += 2.3;
    recoil.kickZ += 0.28;
    recoil.kickRot += 0.2;
    camera.getWorldDirection(_rayDir);
    muzzle.getWorldPosition(_v3);
    Rockets.fire(_v3, _rayDir);
    return;
  }

  // ---- recoil: sobe sempre, deriva lateral conforme a sequência ----
  if (t - recoil.lastShotT > 0.35) recoil.shotIdx = 0;
  recoil.lastShotT = t;
  const idx = recoil.shotIdx++;
  const adsMul = 1 - adsT * 0.45;
  recoil.pitchVel += (gun.recoilP + Math.min(idx, 10) * 0.028) * adsMul;
  const drift = (idx < 4 ? rand(-0.1, 0.1) : Math.sin(idx * 0.55) * 0.16) + rand(-gun.recoilY, gun.recoilY) * 0.5;
  recoil.yawVel += drift * adsMul;
  recoil.kickZ += gun.kick;
  recoil.kickRot += gun.kick * 0.9;

  // ---- spread por arma (quadril > mirando; mover/pular abre o cone) ----
  const spd = Math.hypot(player.vel.x, player.vel.z);
  const spread = lerp(gun.spreadHip, gun.spreadAds, adsT) + spd * 0.0006 + (player.onGround ? 0 : 0.012);
  camera.getWorldPosition(_rayOrig);
  muzzle.getWorldPosition(_v3);

  let hitAny = false, killAny = false, headAny = false, totalDmg = 0;
  for (let p = 0; p < gun.pellets; p++) {
    camera.getWorldDirection(_rayDir);
    _v1.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(spread * Math.sqrt(Math.random()));
    _rayDir.add(_v1).normalize();

    // BR online: armas marcadas com projSpeed disparam projétil real (queda + tempo de voo)
    if (window.__BR_ballistics && gun.projSpeed) { window.__BR_ballistics(_v3, _rayDir, gun); continue; }

    // inimigos comuns (esferas analíticas)
    let bestT = Infinity, bestEnemy = null, bestPart = null, bestBoss = false;
    for (const e of Enemies.list) {
      if (!e.alive) continue;
      if (e.group.position.distanceToSquared(_rayOrig) > 240 * 240) continue;
      for (const s of e.hitSpheres()) {
        _v2.copy(s.c).sub(_rayOrig);
        const proj = _v2.dot(_rayDir);
        if (proj < 0 || proj > 240) continue;
        const d2 = _v2.lengthSq() - proj * proj;
        if (d2 < s.r * s.r) {
          const tHit = proj - Math.sqrt(s.r * s.r - d2);
          if (tHit < bestT) { bestT = tHit; bestEnemy = e; bestPart = s.part; bestBoss = false; }
        }
      }
    }
    // bosses (Colosso, Visitante...)
    let bestBossObj = null, bestExtra = null;
    for (const B2 of Bosses) {
      if (!B2.alive) continue;
      for (const s of B2.hitSpheres()) {
        _v2.copy(s.c).sub(_rayOrig);
        const proj = _v2.dot(_rayDir);
        if (proj < 0 || proj > 300) continue;
        const d2 = _v2.lengthSq() - proj * proj;
        if (d2 < s.r * s.r) {
          const tHit = proj - Math.sqrt(s.r * s.r - d2);
          if (tHit < bestT) { bestT = tHit; bestEnemy = null; bestExtra = null; bestPart = s.part; bestBoss = true; bestBossObj = B2; }
        }
      }
    }
    // alvos extras: animais, zumbis, fantasmas
    for (const a of extraTargets) {
      if (!a.alive) continue;
      for (const s of a.hitSpheres()) {
        _v2.copy(s.c).sub(_rayOrig);
        const proj = _v2.dot(_rayDir);
        if (proj < 0 || proj > 240) continue;
        const d2 = _v2.lengthSq() - proj * proj;
        if (d2 < s.r * s.r) {
          const tHit = proj - Math.sqrt(s.r * s.r - d2);
          if (tHit < bestT) { bestT = tHit; bestEnemy = null; bestBoss = false; bestBossObj = null; bestExtra = a; bestPart = s.part; }
        }
      }
    }
    // jogadores remotos (PVP online) — mesmo padrão de hitSpheres dos alvos acima
    let bestRemote = null;
    if (window.__MP_remotePlayers) for (const rp of window.__MP_remotePlayers) {
      if (!rp.alive) continue;
      if (rp.group.position.distanceToSquared(_rayOrig) > 240 * 240) continue;
      for (const s of rp.hitSpheres()) {
        _v2.copy(s.c).sub(_rayOrig);
        const proj = _v2.dot(_rayDir);
        if (proj < 0 || proj > 240) continue;
        const d2 = _v2.lengthSq() - proj * proj;
        if (d2 < s.r * s.r) {
          const tHit = proj - Math.sqrt(s.r * s.r - d2);
          if (tHit < bestT) { bestT = tHit; bestEnemy = null; bestBoss = false; bestBossObj = null; bestExtra = null; bestRemote = rp; bestPart = s.part; }
        }
      }
    }
    const blockT = rayBlockedAt(_rayOrig, _rayDir, Math.min(bestT, 240));

    if (blockT < bestT) {
      _hitPos.copy(_rayOrig).addScaledVector(_rayDir, blockT);
      terrainNormal(_hitPos.x, _hitPos.z, _v1);
      FX.burst(_hitPos, _v1, p % 2 ? 'spark' : 'dirt');
      FX.spawnTracer(_v3, _hitPos, gun.laser ? 0x52ffe6 : 0xffe9a8);
    } else if (bestEnemy || bestBoss || bestExtra || bestRemote) {
      _hitPos.copy(_rayOrig).addScaledVector(_rayDir, bestT);
      FX.burst(_hitPos, _rayDir.clone().negate(), bestBoss ? 'spark' : 'blood');
      FX.spawnTracer(_v3, _hitPos, gun.laser ? 0x52ffe6 : 0xffe9a8);
      const head = bestPart === 'head' || bestPart === 'core';
      let dmg = head ? gun.dmg * 2 : gun.dmg;
      let died;
      if (bestBoss) died = bestBossObj.damage(dmg, _hitPos, _rayDir, bestPart);
      else if (bestExtra) died = bestExtra.damage(dmg, _hitPos, _rayDir, head);
      else if (bestRemote) died = bestRemote.damage(dmg, _hitPos, _rayDir, head);
      else died = bestEnemy.damage(dmg, _hitPos, _rayDir, bestPart === 'head');
      hitAny = true; totalDmg += dmg;
      headAny = headAny || head;
      _hitAgg.copy(_hitPos);
      if (died) killAny = true; // pontuação é creditada no die() do alvo
    } else {
      _hitPos.copy(_rayOrig).addScaledVector(_rayDir, 240);
      FX.spawnTracer(_v3, _hitPos, gun.laser ? 0x52ffe6 : 0xffe9a8);
    }
  }
  if (hitAny) {
    DmgNums.spawn(_hitAgg, Math.round(totalDmg), headAny);
    showHitmarker(killAny);
    if (killAny) { SFX.kill(); }
    else if (headAny) SFX.headshot();
    else SFX.hit();
  }
}

function shootUpdate(dt, t) {
  if (gun.reloading && t >= gun.reloadEnd) finishReload();
  if (justPressed.has('KeyR')) startReload(t);
  if (justPressed.has('Digit1')) switchWeapon(0);
  if (justPressed.has('Digit2')) switchWeapon(1);
  if (justPressed.has('Digit3')) switchWeapon(2);
  if (justPressed.has('KeyQ')) useMedkit(t);
  if (justPressed.has('KeyF')) eatMeat();
  if (justPressed.has('Tab')) {
    const open = !ui.invPanel.classList.contains('open');
    ui.invPanel.classList.toggle('open', open);
    if (open) Interact.renderInv();
  }
  if (justPressed.has('KeyT') && gun.parts.sights) { // troca o acessório de mira
    gun.sightIdx = ((gun.sightIdx || 0) + 1) % gun.parts.sights.length;
    for (const s of gun.parts.sights) if (s.mesh) s.mesh.visible = false;
    const s = gun.parts.sights[gun.sightIdx];
    if (s.mesh) s.mesh.visible = true;
    gun.adsFov = s.fov;
    gun.adsV.set(...s.ads);
    centerMsg('Mira: ' + s.name, 1100);
    SFX.switchW();
  }
  if (state.driving || state.flying || state.paused || player.dead || window.__BR_freeze) { mouse.clicked = false; return; }
  if (justPressed.has('KeyG')) Grenades.throwNade(t);
  const interval = 60 / gun.rpm;
  const want = gun.auto ? mouse.shooting : mouse.clicked;
  if (want && !gun.reloading && switchAnim > 0.8 && t - gun.lastShot >= interval) {
    if (gun.mag > 0) {
      gun.lastShot = t;
      fire(t);
    } else if (t - gun.lastShot > 0.25) {
      gun.lastShot = t; SFX.empty(); startReload(t);
    }
  }
  mouse.clicked = false;
}

/* ================== dano no player / morte / HUD de vida ================== */
function updateHealthHUD() {
  const h = Math.max(0, player.health);
  ui.healthFill.style.width = (h / player.maxHealth * 100) + '%';
  ui.healthFill.classList.toggle('low', h < 35);
  ui.healLow.style.opacity = h < 35 ? ((1 - h / 35) * 0.85).toFixed(2) : '0';
}
function updateArmorHUD() {
  ui.armorFill.style.width = (player.armor / player.armorMax * 100) + '%';
}
function playerDamage(dmg, fromPos) {
  // no BR online, pausar NÃO pode dar imunidade (senão vira exploit em tiroteio)
  if (player.dead || (state.paused && !window.__BR_active)) return;
  if (state.gameTime < (player.invulnUntil || 0)) return; // proteção de spawn
  if (player.armor > 0) { // armadura azul absorve 70% do dano até quebrar
    const absorb = Math.min(player.armor, dmg * 0.7);
    player.armor -= absorb;
    dmg -= absorb;
    updateArmorHUD();
  }
  player.health -= dmg;
  player.lastDamageT = state.gameTime;
  damageFlash(1);
  addTrauma(0.32);
  SFX.hurt();
  if (fromPos) { // seta apontando de onde veio o dano
    _euler.setFromQuaternion(camera.quaternion);
    const worldAng = Math.atan2(fromPos.x - player.pos.x, fromPos.z - player.pos.z);
    const deg = (_euler.y + Math.PI - worldAng) * 180 / Math.PI;
    ui.dmgDir.style.transform = `rotate(${deg.toFixed(1)}deg)`;
    dmgDirT = 0.9;
  }
  updateHealthHUD();
  if (player.health <= 0) {
    player.health = 0;
    player.dead = true;
    SFX.deathSting();
    timeScale = 0.35; // câmera lenta enquanto cai
    addKillFeed('<b>Você</b> caiu em combate');
    setTimeout(() => ui.deathScreen.classList.add('show'), 600);
    if (window.__MP_active || window.__BR_active) setTimeout(() => window.__MP_respawn(), 3600); // online: fluxo da sessão
    else setTimeout(() => location.reload(), 3600); // solo: reinicia do zero
  }
}

const Car = createCar({ damp, rand, _v1, _v2, heightAt, SFX, FX, scene, world, csmMat, Structures, ui, state, keys });

const Heli = createHeli({ CFG, clamp, damp, _v1, groundAt, SFX, scene, camera, csmMat, Structures, ui, centerMsg, state, keys, mouse, player, chaseCamPos });

/* ================== entrar/sair + câmera de perseguição ================== */
let driveBlend = 0;
const _camQ = new THREE.Quaternion();
const _lookM = new THREE.Matrix4();

function tryToggleCar() {
  if (state.flying) { Heli.exit(); return; }
  if (state.driving) {
    // sair: posiciona o player ao lado esquerdo do veículo
    _v1.set(0, 0, -2.6).applyQuaternion(Car.group.quaternion).add(Car.group.position);
    const gy = heightAt(_v1.x, _v1.z);
    player.pos.set(_v1.x, Math.max(gy, _v1.y - 0.5), _v1.z);
    player.vel.set(0, 0, 0);
    state.driving = false;
    ui.speedo.style.display = 'none';
    ui.ammoWrap.style.display = '';
    SFX.carDoor();
  } else {
    if (Heli.tryEnter()) return;
    const { v, d } = Car.nearest(player.pos);
    if (d < 4.5) {
      // BR online: carro com outro jogador dentro não aceita segundo motorista
      if (window.__BR_takenCars && window.__BR_takenCars.has(Car.vehicles.indexOf(v))) {
        centerMsg('Veículo ocupado!', 1400);
        return;
      }
      Car.setCur(v);
      // desvira o veículo se estiver capotado
      const up = v.chassisBody.quaternion.vmult(new CANNON.Vec3(0, 1, 0));
      if (up.y < 0.5) {
        const f = v.chassisBody.quaternion.vmult(new CANNON.Vec3(1, 0, 0));
        const yaw = Math.atan2(-f.z, f.x);
        v.chassisBody.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), yaw);
        v.chassisBody.position.y += 1.2;
        v.chassisBody.velocity.set(0, 0, 0);
        v.chassisBody.angularVelocity.set(0, 0, 0);
      }
      state.driving = true;
      ui.speedo.style.display = 'block';
      ui.ammoWrap.style.display = 'none';
      mouse.shooting = false; mouse.aiming = false;
      SFX.carDoor();
      SFX.engineStart();
      chaseCamPos.copy(camera.position); // a câmera parte de onde está (lerp suave)
    }
  }
}

function carCameraUpdate(dt) {
  driveBlend = damp(driveBlend, (state.driving || state.flying) ? 1 : 0, 4.5, dt);
  if (driveBlend < 0.002) return;
  const vg = state.flying ? Heli.group : Car.group;

  // alvo atrás do veículo, sempre acima do terreno
  _v1.set(state.flying ? -10.5 : -7.4, state.flying ? 4.2 : 3.1, 0).applyQuaternion(vg.quaternion).add(vg.position);
  const minY = Math.max(heightAt(_v1.x, _v1.z) + 0.7, vg.position.y + 1.6);
  if (_v1.y < minY) _v1.y = minY;
  chaseCamPos.x = damp(chaseCamPos.x, _v1.x, 5.5, dt);
  chaseCamPos.y = damp(chaseCamPos.y, _v1.y, 5.5, dt);
  chaseCamPos.z = damp(chaseCamPos.z, _v1.z, 5.5, dt);

  const vg2 = state.flying ? Heli.group : Car.group;
  _v2.set(2.6, 1.15, 0).applyQuaternion(vg2.quaternion).add(vg2.position);
  chaseLook.x = damp(chaseLook.x, _v2.x, 9, dt);
  chaseLook.y = damp(chaseLook.y, _v2.y, 9, dt);
  chaseLook.z = damp(chaseLook.z, _v2.z, 9, dt);

  // mistura posição e rotação entre FPS e perseguição
  camera.position.lerp(chaseCamPos, driveBlend);
  _lookM.lookAt(camera.position, chaseLook, _v3.set(0, 1, 0));
  _camQ.setFromRotationMatrix(_lookM);
  camera.quaternion.slerp(_camQ, driveBlend);

  // enquanto dirige, o "player" acompanha o veículo (recentra a grama etc.)
  if (state.driving) {
    player.pos.copy(Car.group.position);
    player.pos.y = heightAt(player.pos.x, player.pos.z);
    player.vel.set(0, 0, 0);
  }
}

/* ================================================================
   INIMIGOS — corpos de cápsulas/esferas, FSM, animação procedural
   Estados: PATRULHA -> ALERTA -> PERSEGUIR -> ATACAR
   ================================================================ */
const Enemies = (() => {
  // dois esquadrões: padrão (verde-oliva) e pesado (cinza-escuro com detalhe laranja)
  const clothG  = csmMat(new THREE.MeshStandardMaterial({ color: 0x4a5240, roughness: 0.75, metalness: 0.05 }));
  const clothH  = csmMat(new THREE.MeshStandardMaterial({ color: 0x363b46, roughness: 0.7, metalness: 0.1 }));
  const armorG  = csmMat(new THREE.MeshStandardMaterial({ color: 0x59626f, roughness: 0.45, metalness: 0.45 }));
  const armorH  = csmMat(new THREE.MeshStandardMaterial({ color: 0x272b34, roughness: 0.4, metalness: 0.55 }));
  const trimH   = csmMat(new THREE.MeshStandardMaterial({ color: 0x9c5018, roughness: 0.5, metalness: 0.3 }));
  const jointMat = csmMat(new THREE.MeshStandardMaterial({ color: 0x22252d, roughness: 0.6, metalness: 0.3 }));
  const visorMat = new THREE.MeshStandardMaterial({ color: 0x200505, emissive: 0xff2417, emissiveIntensity: 2.8, roughness: 0.3 });
  const gunMat   = csmMat(new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.5, metalness: 0.5 }));

  const suitMat  = csmMat(new THREE.MeshStandardMaterial({ color: 0x16181d, roughness: 0.55, metalness: 0.1 }));
  const shirtMat = csmMat(new THREE.MeshStandardMaterial({ color: 0xe8e8ea, roughness: 0.7 }));
  const tieMat   = csmMat(new THREE.MeshStandardMaterial({ color: 0x8a1620, roughness: 0.6 }));
  const skinMat  = csmMat(new THREE.MeshStandardMaterial({ color: 0xc9a182, roughness: 0.75 }));
  function buildBody(heavy, suit) {
    const cloth = suit ? suitMat : heavy ? clothH : clothG;
    const armor = suit ? suitMat : heavy ? armorH : armorG;
    const g = new THREE.Group();
    const cast = m => { m.castShadow = true; return m; };
    const parts = { armL: new THREE.Group(), armR: new THREE.Group(), legL: new THREE.Group(), legR: new THREE.Group(), head: new THREE.Group() };

    // tronco
    const torso = cast(new THREE.Mesh(new THREE.CapsuleGeometry(0.31, 0.52, 6, 14), cloth));
    torso.position.y = 1.12; g.add(torso);
    if (suit) { // paletó aberto: camisa branca + gravata
      const shirt = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.46, 0.1, 1, 0.03), shirtMat);
      shirt.position.set(0, 1.22, 0.26); g.add(shirt);
      const tie = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.34, 0.04, 1, 0.015), tieMat);
      tie.position.set(0, 1.18, 0.31); tie.rotation.x = 0.06; g.add(tie);
    } else {
      const vest = cast(new THREE.Mesh(new RoundedBoxGeometry(0.56, 0.52, 0.42, 2, 0.1), armor));
      vest.position.set(0, 1.22, 0.02); g.add(vest);
      for (let i = 0; i < 3; i++) {
        const pk = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.14, 0.06, 1, 0.02), jointMat);
        pk.position.set(-0.14 + i * 0.14, 1.1, 0.25); g.add(pk);
      }
      const pack = cast(new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.46, 0.2, 2, 0.06), heavy ? trimH : jointMat));
      pack.position.set(0, 1.3, -0.3); g.add(pack);
    }
    const belt = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.12, 0.4, 2, 0.04), jointMat);
    belt.position.set(0, 0.88, 0); g.add(belt);

    // cabeça articulada
    parts.head.position.y = 1.78;
    const skull = cast(new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), suit ? skinMat : jointMat));
    parts.head.add(skull);
    if (suit) { // cabelo + óculos escuros
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.25, 14, 10, 0, TAU, 0, Math.PI * 0.5), suitMat);
      hair.position.y = 0.05; parts.head.add(hair);
      const shades = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.07, 0.1, 1, 0.02), knuckleMat);
      shades.position.set(0, 0.03, 0.19); parts.head.add(shades);
    } else {
      const helmet = cast(new THREE.Mesh(new THREE.SphereGeometry(0.285, 16, 12, 0, TAU, 0, Math.PI * 0.58), armor));
      helmet.position.y = 0.04; parts.head.add(helmet);
      const brim = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.035, 6, 16), armor);
      brim.rotation.x = Math.PI / 2; brim.position.y = 0.03; parts.head.add(brim);
      const visor = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.09, 0.12, 1, 0.03), visorMat);
      visor.position.set(0, 0.0, 0.2); parts.head.add(visor);
      if (heavy) {
        const crest = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.3, 6), trimH);
        crest.position.y = 0.36; parts.head.add(crest);
      }
    }
    g.add(parts.head);

    // braços: ombreira + braço + cotovelo + antebraço dobrado + mão
    for (const [k, s] of [['armL', -1], ['armR', 1]]) {
      const p = parts[k];
      p.position.set(s * 0.42, 1.5, 0);
      const pad = cast(new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 9), armor));
      pad.scale.y = 0.85; p.add(pad);
      const upper = cast(new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.26, 5, 10), cloth));
      upper.position.y = -0.22; p.add(upper);
      const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), jointMat);
      elbow.position.y = -0.4; p.add(elbow);
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.24, 5, 10), jointMat);
      fore.position.set(0, -0.56, 0.07); fore.rotation.x = -0.28; p.add(fore);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 6), jointMat);
      hand.position.set(0, -0.7, 0.14); p.add(hand);
      g.add(p);
    }
    // pernas: coxa + joelheira + canela + bota
    for (const [k, s] of [['legL', -1], ['legR', 1]]) {
      const p = parts[k];
      p.position.set(s * 0.17, 0.82, 0);
      p.add(new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), jointMat));
      const thigh = cast(new THREE.Mesh(new THREE.CapsuleGeometry(0.115, 0.26, 5, 10), cloth));
      thigh.position.y = -0.2; p.add(thigh);
      const knee = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), armor);
      knee.position.set(0, -0.38, 0.03); p.add(knee);
      const shin = cast(new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.24, 5, 10), jointMat));
      shin.position.y = -0.56; p.add(shin);
      const boot = new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.12, 0.3, 1, 0.04), jointMat);
      boot.position.set(0, -0.74, 0.06); p.add(boot);
      g.add(p);
    }
    // arma do inimigo: receiver + cano + carregador + coronha
    const w = new THREE.Group();
    w.position.set(0.02, -0.62, 0.22);
    const recv = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.1, 0.4, 1, 0.02), gunMat); w.add(recv);
    const barr = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.3, 8), gunMat);
    barr.rotation.x = Math.PI / 2; barr.position.set(0, 0.02, 0.32); w.add(barr);
    const mg = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.14, 0.07, 1, 0.02), gunMat);
    mg.position.set(0, -0.1, 0.05); mg.rotation.x = -0.15; w.add(mg);
    const stk = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.07, 0.16, 1, 0.02), gunMat);
    stk.position.set(0, -0.01, -0.26); w.add(stk);
    parts.armR.add(w);
    const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshBasicMaterial({
      color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    flash.position.set(0.02, -0.62, 0.72); parts.armR.add(flash);
    return { g, parts, flash };
  }

  // linha de visão barata: amostra a altura do terreno ao longo do raio
  function hasLOS(from, to) {
    if (Structures.segBlocked(from, to)) return false;
    const steps = 11;
    for (let i = 1; i < steps; i++) {
      const k = i / steps;
      const x = lerp(from.x, to.x, k), z = lerp(from.z, to.z, k);
      if (lerp(from.y, to.y, k) < heightAt(x, z) + 0.25) return false;
    }
    return true;
  }

  const NAMES = ['Sentinela', 'Vigia', 'Caçador', 'Lâmina', 'Falcão', 'Brutamontes'];
  const list = [];

  function randomSpawn() {
    for (let i = 0; i < 40; i++) {
      const a = rand(TAU), r = rand(70, CFG.WORLD_SIZE * 0.42);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.hypot(x - player.pos.x, z - player.pos.z) > 45 && slopeAt(x, z) < 0.5 && heightAt(x, z) > WATER_LEVEL + 0.8) return { x, z };
    }
    return { x: 90, z: 90 };
  }

  function makeEnemy(idx, plan) {
    const heavy = !plan && idx % 4 === 3;
    const suit = !!(plan && plan.suit);
    const { g, parts, flash } = buildBody(heavy, suit);
    if (heavy) g.scale.setScalar(1.16);
    scene.add(g);
    const e = {
      id: idx,
      heavy, suit, plan: plan || null,
      maxHp: heavy ? 180 : suit ? 120 : 100,
      flinchT: 0,
      name: (suit ? 'Executivo' : plan && plan.army ? 'Soldado' : heavy ? 'Brutamontes' : NAMES[idx % NAMES.length]) + '-' + String(idx + 1).padStart(2, '0'),
      group: g, parts, flash,
      alive: true, health: 100,
      fsm: 'PATRULHA',
      home: { x: 0, z: 0 }, waypoints: [], wpIdx: 0,
      yaw: rand(TAU), walkPhase: rand(TAU), speedF: 0,
      lastKnown: new THREE.Vector3(),
      senseAcc: rand(0.15), losT: 0, alertT: 0,
      burstLeft: 0, nextBurst: rand(1, 2), nextShot: 0, flashT: 0,
      ragVel: new THREE.Vector3(), ragSpin: 0, deadT: 0, respawnT: 0,
      sphCache: [{ c: new THREE.Vector3(), r: 0.3, part: 'head' },
                 { c: new THREE.Vector3(), r: 0.43, part: 'body' },
                 { c: new THREE.Vector3(), r: 0.4, part: 'body' },
                 { c: new THREE.Vector3(), r: 0.36, part: 'body' }],
      hitSpheres() {
        const p = this.group.position, s = this.group.scale.y;
        this.sphCache[0].c.set(p.x, p.y + 1.8 * s, p.z);  this.sphCache[0].r = 0.3 * s;
        this.sphCache[1].c.set(p.x, p.y + 1.22 * s, p.z); this.sphCache[1].r = 0.43 * s;
        this.sphCache[2].c.set(p.x, p.y + 0.78 * s, p.z); this.sphCache[2].r = 0.4 * s;
        this.sphCache[3].c.set(p.x, p.y + 0.36 * s, p.z); this.sphCache[3].r = 0.36 * s;
        return this.sphCache;
      },
      damage(dmg, hitPos, dir, head) {
        if (!this.alive) return false;
        this.health -= dmg;
        this.flinchT = 1; // reação de impacto
        // levar tiro acorda o inimigo
        this.lastKnown.copy(player.pos);
        if (this.fsm === 'PATRULHA' || this.fsm === 'ALERTA') this.fsm = 'PERSEGUIR';
        if (this.health <= 0) { this.die(dir, head ? 'na cabeça' : null); return true; }
        return false;
      },
      die(dir, headTag) {
        this.alive = false;
        this.fsm = 'MORTO';
        this.deadT = 0;
        this.respawnT = rand(7, 12);
        this.ragVel.set(dir.x, 0, dir.z).normalize().multiplyScalar(rand(5, 8));
        this.ragVel.y = rand(3, 4.6);
        this.ragSpin = rand(-1, 1) > 0 ? 1 : -1;
        addKillFeed(`<b>Você</b> ▸ ${this.name}${headTag ? ' <b>· ' + headTag + '</b>' : ''}`);
        addScore(headTag ? 150 : 100, true);
        if (Math.random() < 0.62) Pickups.drop(this.group.position, this.heavy);
      },
      respawn() {
        const s = this.plan ? { x: this.plan.x, z: this.plan.z } : randomSpawn();
        this.home = s;
        this.waypoints = [];
        const wr = this.plan ? [2.5, 5] : [9, 17];
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * TAU + rand(0.6);
          this.waypoints.push({ x: s.x + Math.cos(a) * rand(wr[0], wr[1]), z: s.z + Math.sin(a) * rand(wr[0], wr[1]) });
        }
        const gy = this.plan && this.plan.floorY !== undefined ? this.plan.floorY : heightAt(s.x, s.z);
        this.group.position.set(s.x, gy, s.z);
        this.group.rotation.set(0, this.yaw, 0);
        this.group.scale.setScalar(this.heavy ? 1.16 : 1);
        this.health = this.maxHp;
        this.alive = true;
        this.fsm = 'PATRULHA';
      },
    };
    e.respawn();
    list.push(e);
    return e;
  }
  for (let i = 0; i < CFG.ENEMY_COUNT; i++) makeEnemy(i);
  for (const c of Structures.enemyCamps) makeEnemy(list.length, c); // torre + bases militares

  /* tiro do inimigo: hitscan com spread, tracer e chance de errar */
  const _eFrom = new THREE.Vector3(), _eTo = new THREE.Vector3(), _eDir = new THREE.Vector3();
  function enemyFire(e) {
    e.flashT = 0.06;
    SFX.enemyShot();
    _eFrom.copy(e.group.position); _eFrom.y += 1.45;
    _eTo.copy(player.pos); _eTo.y += lerp(1.5, 0.95, player.crouchT);
    _eDir.copy(_eTo).sub(_eFrom).normalize();
    _eDir.x += rand(-0.045, 0.045); _eDir.y += rand(-0.03, 0.03); _eDir.z += rand(-0.045, 0.045);
    _eDir.normalize();
    // aproximação mais próxima do raio ao peito do player
    _v1.copy(_eTo).sub(_eFrom);
    const proj = Math.max(0, _v1.dot(_eDir));
    _v2.copy(_eFrom).addScaledVector(_eDir, proj);
    const miss = _v2.distanceTo(_eTo);
    const range = _eFrom.distanceTo(_eTo);
    if (miss < 0.5 && !player.dead) {
      FX.spawnTracer(_eFrom, _eTo, 0xff8866);
      playerDamage((e.heavy ? rand(9, 14) : rand(6, 11)) | 0, _eFrom);
    } else {
      _v3.copy(_eFrom).addScaledVector(_eDir, range + rand(2, 8));
      _v3.y = Math.max(_v3.y, heightAt(_v3.x, _v3.z));
      FX.spawnTracer(_eFrom, _v3, 0xff8866);
      if (_v3.y <= heightAt(_v3.x, _v3.z) + 0.1) { terrainNormal(_v3.x, _v3.z, _v1); FX.burst(_v3, _v1, 'dirt'); }
    }
  }

  function update(dt, t) {
    const pEye = _v3.copy(player.pos); pEye.y += 1.5;
    for (const e of list) {
      const g = e.group;

      /* ---------- morto: ragdoll falso + fade ---------- */
      if (!e.alive) {
        e.deadT += dt;
        if (e.deadT < 1.5) {
          e.ragVel.y -= 18 * dt;
          g.position.addScaledVector(e.ragVel, dt);
          const gy = heightAt(g.position.x, g.position.z);
          if (g.position.y < gy) { g.position.y = gy; e.ragVel.multiplyScalar(0.6); e.ragVel.y = 0; }
          g.rotation.x = Math.min(Math.PI / 2, g.rotation.x + dt * 5) * 1;
          g.rotation.z += e.ragSpin * dt * 2.4;
          if (e.deadT > 1.1) {
            const k = 1 - (e.deadT - 1.1) / 0.4;
            g.scale.setScalar(Math.max(0.001, k));
          }
        } else {
          g.scale.setScalar(0.001);
          e.respawnT -= dt;
          if (e.respawnT <= 0) { g.rotation.set(0, 0, 0); e.respawn(); }
        }
        continue;
      }

      const dPlayer = g.position.distanceTo(player.pos);

      /* ---------- atropelamento ---------- */
      if (Car.speedKmh() > 24 && g.position.distanceTo(Car.group.position) < 2.4) {
        _v1.copy(Car.chassisBody.velocity).normalize();
        e.die(_v1, null);
        addTrauma(0.2);
        continue;
      }

      /* ---------- sentidos (escalonado p/ performance) ---------- */
      e.senseAcc += dt;
      let sees = false;
      if (e.senseAcc > 0.16) {
        e.senseAcc = 0;
        if (dPlayer < 95 && !player.dead) {
          _v1.copy(g.position); _v1.y += 1.7;
          const inFov = e.fsm !== 'PATRULHA' || (() => {
            _v2.copy(player.pos).sub(g.position); _v2.y = 0; _v2.normalize();
            return _v2.dot(_eDir.set(Math.sin(e.yaw), 0, Math.cos(e.yaw))) > 0.35;
          })();
          sees = inFov && dPlayer < (e.fsm === 'PATRULHA' ? 55 : 85) && hasLOS(_v1, pEye);
          if (sees) { e.lastKnown.copy(player.pos); e.losT = t; }
        }
        // ouviu tiro do player por perto
        if (lastShotInfo.t > t - 0.4 && g.position.distanceTo(lastShotInfo.pos) < 75 && e.fsm === 'PATRULHA') {
          e.fsm = 'ALERTA'; e.alertT = t; e.lastKnown.copy(lastShotInfo.pos);
        }
      } else {
        sees = t - e.losT < 0.25;
      }

      /* ---------- FSM ---------- */
      let moveTarget = null, moveSpeed = 0, aiming = false;
      switch (e.fsm) {
        case 'PATRULHA': {
          const wp = e.waypoints[e.wpIdx];
          if (Math.hypot(wp.x - g.position.x, wp.z - g.position.z) < 1.6) e.wpIdx = (e.wpIdx + 1) % e.waypoints.length;
          moveTarget = wp; moveSpeed = 2.1;
          if (sees) { e.fsm = 'PERSEGUIR'; }
          break;
        }
        case 'ALERTA': {
          moveTarget = e.lastKnown; moveSpeed = 3.2;
          if (sees) e.fsm = 'PERSEGUIR';
          else if (t - e.alertT > 7) e.fsm = 'PATRULHA';
          break;
        }
        case 'PERSEGUIR': {
          moveTarget = sees ? player.pos : e.lastKnown; moveSpeed = 4.6;
          if (sees && dPlayer < 24) e.fsm = 'ATACAR';
          else if (!sees && t - e.losT > 5) { e.fsm = 'ALERTA'; e.alertT = t; }
          break;
        }
        case 'ATACAR': {
          aiming = true; moveSpeed = 0;
          if (!sees || dPlayer > 30) { e.fsm = 'PERSEGUIR'; e.burstLeft = 0; }
          break;
        }
      }

      /* ---------- locomoção + separação ---------- */
      moveSpeed *= e.heavy ? 0.78 : 1;
      let vx = 0, vz = 0;
      if (moveTarget && moveSpeed > 0) {
        const dx = moveTarget.x - g.position.x, dz = moveTarget.z - g.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.5) { vx = dx / d * moveSpeed; vz = dz / d * moveSpeed; }
      }
      if (aiming) { // micro-strafe enquanto atira
        const sa = Math.sin(t * 1.3 + e.id * 2.1) * 1.1;
        vx += Math.cos(e.yaw) * sa * 0.4; vz += -Math.sin(e.yaw) * sa * 0.4;
      }
      for (const o of list) { // separação entre inimigos
        if (o === e || !o.alive) continue;
        const dx = g.position.x - o.group.position.x, dz = g.position.z - o.group.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 1.4 * 1.4 && d2 > 1e-4) { const d = Math.sqrt(d2); vx += dx / d * 2.2; vz += dz / d * 2.2; }
      }
      g.position.x += vx * dt;
      g.position.z += vz * dt;
      for (const o of obstaclesNear(g.position.x, g.position.z)) {
        const dx = g.position.x - o.x, dz = g.position.z - o.z;
        const d = Math.hypot(dx, dz), min = o.r + 0.4;
        if (d < min && d > 1e-4) { g.position.x = o.x + dx / d * min; g.position.z = o.z + dz / d * min; }
      }
      Structures.collide(g.position, 0.45, 1.9);
      g.position.y = e.plan && e.plan.floorY !== undefined
        ? Math.max(heightAt(g.position.x, g.position.z), e.plan.floorY)
        : heightAt(g.position.x, g.position.z);

      /* ---------- orientação + animação procedural ---------- */
      const spd = Math.hypot(vx, vz);
      e.speedF = damp(e.speedF, clamp(spd / 4.6, 0, 1), 8, dt);
      let targetYaw = e.yaw;
      if (aiming || sees) targetYaw = Math.atan2(player.pos.x - g.position.x, player.pos.z - g.position.z);
      else if (spd > 0.2) targetYaw = Math.atan2(vx, vz);
      let dy = targetYaw - e.yaw;
      while (dy > Math.PI) dy -= TAU; while (dy < -Math.PI) dy += TAU;
      e.yaw += dy * Math.min(1, 7 * dt);
      g.rotation.y = e.yaw;

      e.walkPhase += dt * (3 + spd * 2.4);
      const swing = Math.sin(e.walkPhase * 2) * 0.6 * e.speedF;
      e.flinchT = Math.max(0, e.flinchT - dt * 3.2);
      g.rotation.x = e.speedF * 0.14 - e.flinchT * 0.3;        // inclina pra frente ao correr, recua no flinch
      g.rotation.z = Math.sin(e.walkPhase) * 0.045 * e.speedF; // gingado lateral
      e.parts.legL.rotation.x = swing;
      e.parts.legR.rotation.x = -swing;
      // cabeça vasculha no estado de alerta
      if (e.fsm === 'ALERTA') e.parts.head.rotation.y = Math.sin(t * 2.2 + e.id * 1.7) * 0.7;
      else e.parts.head.rotation.y = damp(e.parts.head.rotation.y, 0, 6, dt);
      if (aiming) {
        // as DUAS mãos seguram a arma apontada pro player
        const dyAim = (player.pos.y + 1.4) - (g.position.y + 1.5);
        const pitch = Math.atan2(dyAim, dPlayer);
        const aimX = -Math.PI / 2 + clamp(-pitch, -0.6, 0.6);
        e.parts.armR.rotation.x = damp(e.parts.armR.rotation.x, aimX, 10, dt);
        e.parts.armL.rotation.x = damp(e.parts.armL.rotation.x, aimX + 0.14, 10, dt);
        e.parts.armL.rotation.z = damp(e.parts.armL.rotation.z, 0.6, 10, dt);
      } else {
        e.parts.armR.rotation.x = swing * 0.8;
        e.parts.armL.rotation.x = -swing * 0.8;
        e.parts.armL.rotation.z = damp(e.parts.armL.rotation.z, 0, 8, dt);
      }
      g.position.y += Math.abs(Math.sin(e.walkPhase)) * 0.06 * e.speedF; // quica ao andar

      /* ---------- ataque em rajadas ---------- */
      if (aiming) {
        if (e.burstLeft > 0) {
          if (t >= e.nextShot) { e.burstLeft--; e.nextShot = t + 0.13; enemyFire(e); }
        } else if (t >= e.nextBurst) {
          e.burstLeft = 3;
          e.nextShot = t + rand(0.1);
          e.nextBurst = t + rand(1.0, 1.9);
        }
      }
      e.flashT = Math.max(0, e.flashT - dt);
      e.flash.material.opacity = e.flashT > 0 ? 0.95 : 0;
      if (e.flashT > 0) e.flash.rotation.z = rand(TAU);
    }
  }

  return { list, update };
})();

/* registro do último tiro do player (os inimigos "ouvem") */
const lastShotInfo = { pos: new THREE.Vector3(), t: -99 };
/* alvos extras (animais, zumbis, fantasmas) e lista de bosses */
const extraTargets = [];
const Bosses = [];
const MFlags = { colosso: false, alien: false, night: false }; // marcos de missão

const Grenades = createGrenades({ clamp, rand, _v1, heightAt, terrainNormal, SFX, FX, scene, camera, updateInvHUD, state, player, playerDamage, addTrauma, recoil, inventory, Car, Enemies, Bosses, extraTargets });


const Pickups = createPickups({ heightAt, SFX, scene, Structures, showBanner, centerMsg, getGun: () => gun, updateAmmoHUD, updateInvHUD, updateArmorHUD, player, inventory });

/* ================================================================
   BOSS — COLOSSO, guardião do forte (o núcleo brilhante é o ponto fraco)
   ================================================================ */
let timeScale = 1; // câmera lenta cinematográfica na morte do boss
const Boss = (() => {
  const HOME = Structures.FORT_POS;
  const mArmor = csmMat(new THREE.MeshStandardMaterial({ color: 0x2e333d, roughness: 0.5, metalness: 0.45 }));
  const mDark  = csmMat(new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: 0.6, metalness: 0.35 }));
  const mCore  = new THREE.MeshStandardMaterial({ color: 0x1a0500, emissive: 0xff5a1e, emissiveIntensity: 3, roughness: 0.3 });
  const mEye   = new THREE.MeshStandardMaterial({ color: 0x200505, emissive: 0xff2417, emissiveIntensity: 3, roughness: 0.3 });

  const group = new THREE.Group();
  const parts = {};
  {
    const cast = m => { m.castShadow = true; return m; };
    const torso = cast(new THREE.Mesh(new THREE.CapsuleGeometry(0.95, 1.1, 6, 16), mArmor));
    torso.position.y = 2.9; group.add(torso);
    const plate = cast(new THREE.Mesh(new RoundedBoxGeometry(1.5, 1.3, 0.6, 3, 0.18), mDark));
    plate.position.set(0, 3.1, 0.42); group.add(plate);
    parts.core = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), mCore);
    parts.core.position.set(0, 3.05, 0.82); group.add(parts.core);
    parts.head = new THREE.Group(); parts.head.position.y = 4.35;
    parts.head.add(cast(new THREE.Mesh(new THREE.SphereGeometry(0.48, 18, 14), mArmor)));
    const visor = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.16, 0.2, 2, 0.06), mEye);
    visor.position.set(0, 0.05, 0.4); parts.head.add(visor);
    const crest = cast(new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.7, 6), mDark));
    crest.position.y = 0.62; parts.head.add(crest);
    group.add(parts.head);
    for (const s of [-1, 1]) {
      const pad = cast(new THREE.Mesh(new THREE.SphereGeometry(0.62, 14, 10), mDark));
      pad.position.set(s * 1.25, 3.85, 0); pad.scale.y = 0.8; group.add(pad);
      const arm = new THREE.Group(); arm.position.set(s * 1.3, 3.7, 0);
      const upper = cast(new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.9, 5, 12), mArmor));
      upper.position.y = -0.6; arm.add(upper);
      const fist = cast(new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 9), mDark));
      fist.position.y = -1.35; arm.add(fist);
      parts[s < 0 ? 'armL' : 'armR'] = arm; group.add(arm);
      const leg = new THREE.Group(); leg.position.set(s * 0.55, 1.95, 0);
      const thigh = cast(new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 0.9, 5, 12), mArmor));
      thigh.position.y = -0.65; leg.add(thigh);
      const boot = cast(new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.5, 1, 2, 0.14), mDark));
      boot.position.set(0, -1.6, 0.1); leg.add(boot);
      parts[s < 0 ? 'legL' : 'legR'] = leg; group.add(leg);
    }
    const cannon = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.1, 10), mDark));
    cannon.rotation.x = Math.PI / 2; cannon.position.set(0, -1.3, 0.5);
    parts.armR.add(cannon);
    // armadura samurai: sode (ombreiras laminadas), kusazuri (saiote) e kuwagata no elmo
    const mLacq = csmMat(new THREE.MeshStandardMaterial({ color: 0x8c1c14, metalness: 0.4, roughness: 0.35 }));
    const mGold = csmMat(new THREE.MeshStandardMaterial({ color: 0xc9a04e, metalness: 0.85, roughness: 0.3 }));
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const pl = new THREE.Mesh(new RoundedBoxGeometry(0.7 + i * 0.12, 0.16, 0.8, 1, 0.05), mLacq);
        pl.position.set(s * (1.32 + i * 0.06), 3.95 - i * 0.18, 0);
        pl.rotation.z = s * (0.25 + i * 0.08);
        group.add(pl);
      }
    }
    for (let i = 0; i < 5; i++) { // saiote
      const a = (i - 2) * 0.55;
      const sk = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.75, 0.1, 1, 0.04), mLacq);
      sk.position.set(Math.sin(a) * 0.85, 1.75, Math.cos(a) * 0.85);
      sk.rotation.y = a;
      sk.rotation.x = 0.18;
      group.add(sk);
    }
    const kw1 = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.85, 0.18, 1, 0.03), mGold);
    kw1.position.set(-0.25, 4.95, 0.25); kw1.rotation.z = 0.45; group.add(kw1);
    const kw2 = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.85, 0.18, 1, 0.03), mGold);
    kw2.position.set(0.25, 4.95, 0.25); kw2.rotation.z = -0.45; group.add(kw2);
    group.scale.setScalar(1.18); // ~5.5m de altura
  }
  group.position.set(HOME.x, heightAt(HOME.x, HOME.z), HOME.z);
  scene.add(group);

  const B = {
    alive: true, active: false, enraged: false,
    hpMax: 2800, hp: 2800,
    yaw: 0, walkPhase: 0,
    nextVolley: 0, volleyLeft: 0, nextOrb: 0, nextStomp: 0,
    stompT: -1, stompHit: false, deadT: -1, respawnT: 0,
    flinch: 0,
  };

  /* orbes de plasma (pool) */
  const orbs = [];
  const orbMat = new THREE.MeshStandardMaterial({ color: 0x301000, emissive: 0xff7a22, emissiveIntensity: 4, roughness: 0.3 });
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 9), orbMat);
    m.visible = false; scene.add(m);
    orbs.push({ mesh: m, vel: new THREE.Vector3(), live: false });
  }
  function fireOrb() {
    const o = orbs.find(o => !o.live);
    if (!o) return;
    o.live = true;
    const fs = Math.sin(B.yaw), fc = Math.cos(B.yaw);
    o.mesh.position.set(group.position.x + fs * 1.2 - fc * 1.5, group.position.y + 2.9, group.position.z + fc * 1.2 + fs * 1.5);
    _v2.copy(player.pos); _v2.y += 1.2;
    _v2.addScaledVector(player.vel, _v2.distanceTo(o.mesh.position) / 26 * 0.65); // predição
    o.vel.copy(_v2).sub(o.mesh.position).normalize().multiplyScalar(26);
    o.mesh.visible = true;
    SFX.bossShot();
  }
  function orbExplode(o) {
    o.live = false;
    o.mesh.visible = false;
    FX.burst(o.mesh.position, _v1.set(0, 1, 0), 'spark');
    FX.burst(o.mesh.position, _v1.set(0, 1, 0), 'dirt');
    const d = o.mesh.position.distanceTo(player.pos);
    if (d < 4.5) playerDamage(Math.round(20 * (1 - d / 5)) + 6, o.mesh.position);
    addTrauma(clamp(0.55 - d * 0.025, 0, 0.55));
  }

  const sph = [
    { c: new THREE.Vector3(), r: 0.46, part: 'core' },
    { c: new THREE.Vector3(), r: 0.62, part: 'head' },
    { c: new THREE.Vector3(), r: 1.3, part: 'body' },
    { c: new THREE.Vector3(), r: 0.95, part: 'body' },
  ];
  function hitSpheres() {
    const p = group.position;
    const fs = Math.sin(B.yaw), fc = Math.cos(B.yaw);
    sph[0].c.set(p.x + fs * 0.97, p.y + 3.6, p.z + fc * 0.97); // núcleo
    sph[1].c.set(p.x, p.y + 5.15, p.z);                         // cabeça
    sph[2].c.set(p.x, p.y + 3.45, p.z);                         // torso
    sph[3].c.set(p.x, p.y + 1.9, p.z);                          // pernas
    return sph;
  }

  function updateBar() {
    ui.bossFill.style.width = clamp(B.hp / B.hpMax * 100, 0, 100) + '%';
  }
  function activate() {
    B.active = true;
    SFX.roar();
    addTrauma(0.45);
    showBanner('COLOSSO DESPERTOU<small>destrua o núcleo brilhante no peito</small>', 3400);
  }
  function damage(dmg, hitPos, dir, part) {
    if (!B.alive || B.deadT >= 0) return false;
    if (!B.active) activate();
    B.hp -= dmg * (part === 'core' ? 1.5 : 1); // núcleo: 2x do tiro + 1.5x aqui = 3x
    B.flinch = Math.min(1, B.flinch + 0.12);
    if (part === 'core') parts.core.material.emissiveIntensity = 7;
    updateBar();
    if (B.hp <= 0) { die(); return true; }
    if (!B.enraged && B.hp < B.hpMax * 0.35) {
      B.enraged = true;
      mEye.emissiveIntensity = 5.5;
      SFX.roar();
      showBanner('COLOSSO ENFURECIDO', 1800);
    }
    return false;
  }
  function die() {
    B.alive = false;
    B.deadT = 0;
    B.respawnT = 120;
    addScore(2500, true);
    addKillFeed('<b>Você</b> ▸ <b>COLOSSO</b>');
    SFX.explosion();
    SFX.victory();
    addTrauma(1);
    timeScale = 0.25; // câmera lenta
    setTimeout(() => { timeScale = 1; }, 1000);
    showBanner('COLOSSO ELIMINADO<small>+2500 pontos · pegue a ARMADURA do guardião</small>', 4500);
    for (let i = 0; i < 5; i++) {
      FX.burst(_v1.set(group.position.x + rand(-2, 2), group.position.y + rand(1, 4), group.position.z + rand(-2, 2)), _v2.set(0, 1, 0), 'spark');
      Pickups.drop({ x: group.position.x + rand(-5, 5), z: group.position.z + rand(-5, 5) }, true);
    }
    Pickups.spawn({ x: group.position.x, z: group.position.z + 3 }, 'armor'); // recompensa: armadura azul
    MFlags.colosso = true;
    ui.bossWrap.style.opacity = '0';
  }
  function respawn() {
    B.alive = true; B.active = false; B.enraged = false;
    B.hp = B.hpMax; B.stompT = -1; B.deadT = -1; B.flinch = 0;
    group.visible = true;
    group.rotation.set(0, 0, 0);
    group.scale.setScalar(1.18);
    group.position.set(HOME.x, heightAt(HOME.x, HOME.z), HOME.z);
    mEye.emissiveIntensity = 3;
    updateBar();
  }

  function update(dt, t) {
    // orbes sempre voam, mesmo com o boss morto
    for (const o of orbs) {
      if (!o.live) continue;
      o.vel.y -= 3 * dt;
      o.mesh.position.addScaledVector(o.vel, dt);
      o.mesh.scale.setScalar(1 + Math.sin(t * 30) * 0.12);
      if (o.mesh.position.y < heightAt(o.mesh.position.x, o.mesh.position.z) + 0.3 ||
          o.mesh.position.distanceTo(player.pos) < 1.3) orbExplode(o);
    }
    parts.core.material.emissiveIntensity =
      damp(parts.core.material.emissiveIntensity, B.enraged ? 4.5 : 3, 4, dt) + Math.sin(t * 6) * 0.25;
    B.flinch = Math.max(0, B.flinch - dt * 2);

    if (!B.alive) {
      if (B.deadT >= 0) { // tomba e afunda
        B.deadT += dt;
        group.rotation.x = -Math.min(1.35, B.deadT * 1.3);
        if (B.deadT > 1.2) group.position.y = heightAt(group.position.x, group.position.z) - (B.deadT - 1.2) * 1.1;
        if (B.deadT > 3.6) { B.deadT = -1; group.visible = false; }
      } else {
        B.respawnT -= dt;
        if (B.respawnT <= 0) respawn();
      }
      return;
    }

    const dPlayer = group.position.distanceTo(player.pos);
    ui.bossWrap.style.opacity = (B.active && dPlayer < 140) ? '1' : '0';
    if (!B.active) {
      if (dPlayer < 60 && !player.dead) activate();
      else {
        group.position.y = heightAt(group.position.x, group.position.z) + Math.sin(t * 0.9) * 0.04; // respira
        return;
      }
    }

    const dHome = Math.hypot(group.position.x - HOME.x, group.position.z - HOME.z);
    const leashing = dHome > 70 || player.dead;
    const speed = B.enraged ? 4.6 : 3.1;
    const tx = leashing ? HOME.x : player.pos.x;
    const tz = leashing ? HOME.z : player.pos.z;
    if (leashing) { B.hp = Math.min(B.hpMax, B.hp + 30 * dt); updateBar(); }

    if (B.stompT >= 0) {
      /* ---- PISÃO: agacha, esmaga, onda de choque ---- */
      B.stompT += dt;
      const k = B.stompT / 1.05;
      if (k < 0.6) {
        group.scale.y = 1.18 * (1 - k * 0.28);
        parts.armL.rotation.x = parts.armR.rotation.x = -k * 1.6;
      } else {
        group.scale.y = damp(group.scale.y, 1.18, 14, dt);
        parts.armL.rotation.x = damp(parts.armL.rotation.x, 0, 10, dt);
        parts.armR.rotation.x = damp(parts.armR.rotation.x, 0, 10, dt);
      }
      if (!B.stompHit && k >= 0.62) {
        B.stompHit = true;
        SFX.stomp();
        addTrauma(0.8);
        for (let i = 0; i < 10; i++) { // anel de poeira
          const a = i / 10 * TAU;
          _v1.set(group.position.x + Math.cos(a) * 2, group.position.y + 0.4, group.position.z + Math.sin(a) * 2);
          _v2.set(Math.cos(a) * 6, 2.5, Math.sin(a) * 6);
          FX.spawnParticle(_v1, _v2, 0x9a8a6a, rand(0.3, 0.5), 0.7, 8);
        }
        const d = group.position.distanceTo(player.pos);
        if (d < 11) {
          playerDamage(Math.round(32 * (1 - d / 13)), group.position);
          _v2.copy(player.pos).sub(group.position).normalize();
          player.vel.x += _v2.x * 13; player.vel.z += _v2.z * 13; player.vel.y = 7;
          player.onGround = false;
        }
      }
      if (k >= 1) { B.stompT = -1; B.stompHit = false; group.scale.y = 1.18; }
    } else {
      /* ---- locomoção + ataques ---- */
      const dx = tx - group.position.x, dz = tz - group.position.z;
      const dd = Math.hypot(dx, dz);
      let spd = 0;
      if (dd > (leashing ? 2 : 5.5)) {
        spd = speed;
        group.position.x += dx / dd * speed * dt;
        group.position.z += dz / dd * speed * dt;
      }
      Structures.collide(group.position, 1.5, 5); // entra/sai só pelo portão
      const targetYaw = Math.atan2(dx, dz);
      let dy = targetYaw - B.yaw;
      while (dy > Math.PI) dy -= TAU;
      while (dy < -Math.PI) dy += TAU;
      B.yaw += dy * Math.min(1, 3.5 * dt);
      group.rotation.y = B.yaw;
      B.walkPhase += dt * (1.2 + spd * 0.9);
      const sw = Math.sin(B.walkPhase * 2) * 0.5 * (spd > 0 ? 1 : 0);
      parts.legL.rotation.x = sw;
      parts.legR.rotation.x = -sw;
      parts.armL.rotation.x = -sw * 0.5;
      parts.armR.rotation.x = sw * 0.5 - 0.25;
      group.position.y = heightAt(group.position.x, group.position.z) + Math.abs(Math.sin(B.walkPhase)) * 0.12 * (spd > 0 ? 1 : 0);
      group.rotation.x = -B.flinch * 0.1 + (spd > 0 ? 0.05 : 0);

      if (!leashing && !player.dead) {
        if (dPlayer < 8.5 && t >= B.nextStomp) {
          B.stompT = 0; B.stompHit = false;
          B.nextStomp = t + 5;
        } else if (dPlayer < 80 && dPlayer > 9 && t >= B.nextVolley) {
          B.volleyLeft = B.enraged ? 5 : 3;
          B.nextVolley = t + (B.enraged ? 1.7 : 2.8);
          B.nextOrb = t;
        }
      }
      if (B.volleyLeft > 0 && t >= B.nextOrb) {
        B.volleyLeft--;
        B.nextOrb = t + 0.22;
        fireOrb();
      }
    }
  }
  updateBar();
  const api = { update, damage, hitSpheres, get alive() { return B.alive; }, pos: () => group.position, state: B, name: 'COLOSSO' };
  Bosses.push(api);
  return api;
})();
/* Rockets criado APOS o Boss (dependencia declarada) — só é usado em runtime */
const Rockets = createRockets({ rand, _v1, _v2, heightAt, FX, scene, Structures, player, Enemies, Grenades, Boss });

const Env = createEnv({ CFG, clamp, lerp, damp, rand, TAU, SFX, scene, camera, renderer, csm, sky, sunDir, hemiLight, ambLight, Water, Grass, Structures, _euler });

/* ================================================================
   VIDA AMBIENTE — borboletas, pássaros, pólen, fogueira, fumaça,
   bandeiras tremulando e canto de passarinhos
   ================================================================ */
const Amb = (() => {
  /* ---- borboletas perto do player ---- */
  const bflies = [];
  const wingGeo = new THREE.PlaneGeometry(0.16, 0.12);
  wingGeo.translate(0.08, 0, 0); // dobradiça no corpo
  const bColors = [0xffd24d, 0xff8ac2, 0x9ad9ff, 0xfff3c4, 0xcf9aff];
  for (let i = 0; i < 22; i++) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: bColors[i % bColors.length], side: THREE.DoubleSide, transparent: true, opacity: 0.95 });
    const w1 = new THREE.Mesh(wingGeo, mat);
    const w2 = new THREE.Mesh(wingGeo, mat); w2.scale.x = -1;
    g.add(w1, w2);
    scene.add(g);
    bflies.push({ g, w1, w2, anchor: new THREE.Vector3(), phase: rand(TAU), speed: rand(0.5, 1.2), life: 0 });
  }
  function reanchor(b) {
    const a = rand(TAU), r = rand(7, 42);
    b.anchor.set(player.pos.x + Math.cos(a) * r, 0, player.pos.z + Math.sin(a) * r);
    b.anchor.y = heightAt(b.anchor.x, b.anchor.z) + rand(0.5, 1.6);
    b.life = rand(7, 15);
  }
  bflies.forEach(reanchor);

  /* ---- bandos de pássaros circulando alto ---- */
  const birds = [];
  const birdMat = new THREE.MeshBasicMaterial({ color: 0x1d2126, side: THREE.DoubleSide });
  const birdGeo = new THREE.PlaneGeometry(0.95, 0.22);
  for (let f = 0; f < 3; f++) {
    const center = new THREE.Vector3(rand(-260, 260), 0, rand(-260, 260));
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(birdGeo, birdMat);
      m.rotation.x = -0.35;
      scene.add(m);
      birds.push({ m, center, r: rand(16, 42), h: rand(26, 46), a: rand(TAU), sp: rand(0.22, 0.4) * (f % 2 ? 1 : -1), ph: rand(TAU) });
    }
  }

  /* ---- pólen dourado flutuando (1 draw call) ---- */
  const MOTES = 70;
  const moteGeo = new THREE.BufferGeometry();
  const motePos = new Float32Array(MOTES * 3);
  for (let i = 0; i < MOTES; i++) {
    motePos[i * 3] = rand(-22, 22); motePos[i * 3 + 1] = rand(0.3, 3.4); motePos[i * 3 + 2] = rand(-22, 22);
  }
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({
    color: 0xffe9b0, size: 0.055, transparent: true, opacity: 0.45,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
  motes.frustumCulled = false;
  scene.add(motes);

  /* ---- acampamento do spawn: fogueira, pedras, banco e tenda ---- */
  const campY = heightAt(2, -2);
  {
    const wood = csmMat(new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.8 }));
    const stone = csmMat(new THREE.MeshStandardMaterial({ color: 0x7e7a73, roughness: 0.9 }));
    const canvasM = csmMat(new THREE.MeshStandardMaterial({ color: 0xc26b3a, roughness: 0.85, side: THREE.DoubleSide }));
    for (let i = 0; i < 3; i++) { // lenha em tripé
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.95, 7), wood);
      log.position.set(2, campY + 0.28, -2);
      log.rotation.set(0.5, i * TAU / 3, 0.45);
      log.castShadow = true;
      scene.add(log);
    }
    for (let i = 0; i < 7; i++) { // círculo de pedras
      const st = new THREE.Mesh(new THREE.SphereGeometry(rand(0.09, 0.15), 7, 5), stone);
      const a = i / 7 * TAU;
      st.position.set(2 + Math.cos(a) * 0.78, campY + 0.06, -2 + Math.sin(a) * 0.78);
      scene.add(st);
    }
    const bench = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.7, 8), wood);
    bench.rotation.z = Math.PI / 2;
    bench.position.set(2.2, campY + 0.18, -0.2);
    bench.castShadow = true;
    scene.add(bench);
    // tenda em A
    const s1 = new THREE.PlaneGeometry(1.5, 2.3); s1.rotateX(-Math.PI / 2); s1.rotateZ(0.96);  s1.translate(-0.44, 0.62, 0);
    const s2 = new THREE.PlaneGeometry(1.5, 2.3); s2.rotateX(-Math.PI / 2); s2.rotateZ(-0.96); s2.translate(0.44, 0.62, 0);
    const tent = new THREE.Mesh(BufferGeometryUtils.mergeGeometries([s1, s2]), canvasM);
    tent.position.set(5.6, campY, -4.2);
    tent.rotation.y = 0.5;
    tent.castShadow = true;
    scene.add(tent);
    addObstacle(5.6, -4.2, 1.3);
  }
  // chamas da fogueira (3 quads aditivos cruzados)
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa53d, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const fireFlames = [];
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.85), flameMat);
    f.position.set(2, campY + 0.5, -2);
    f.rotation.y = i * Math.PI / 3;
    scene.add(f);
    fireFlames.push(f);
  }
  const fireLight = new THREE.PointLight(0xff9a40, 2.2, 15, 2);
  fireLight.position.set(2, campY + 1, -2);
  scene.add(fireLight);

  let smokeAcc = 0, chirpAcc = rand(3, 7);

  function update(dt, t) {
    // borboletas vagueiam em volta de uma âncora
    for (const b of bflies) {
      b.life -= dt;
      if (b.life <= 0 || b.anchor.distanceToSquared(player.pos) > 85 * 85) reanchor(b);
      b.phase += dt * b.speed;
      const px = b.anchor.x + Math.sin(b.phase * 1.3) * 1.7 + Math.sin(b.phase * 0.7) * 1.1;
      const pz = b.anchor.z + Math.cos(b.phase * 1.1) * 1.7;
      const py = b.anchor.y + Math.sin(b.phase * 2.1) * 0.35;
      b.g.rotation.y = Math.atan2(px - b.g.position.x, pz - b.g.position.z);
      b.g.position.set(px, py, pz);
      const flap = 0.3 + Math.abs(Math.sin(t * 16 + b.phase * 7)) * 1.0;
      b.w1.rotation.y = flap;
      b.w2.rotation.y = -flap;
    }
    // pássaros circulam batendo asas
    for (const b of birds) {
      b.a += b.sp * dt;
      b.m.position.set(b.center.x + Math.cos(b.a) * b.r, b.h + Math.sin(t * 0.6 + b.ph) * 2, b.center.z + Math.sin(b.a) * b.r);
      b.m.rotation.y = -b.a + (b.sp > 0 ? 0 : Math.PI);
      b.m.scale.y = 0.45 + Math.abs(Math.sin(t * 7 + b.ph)) * 0.85;
    }
    // pólen acompanha o player
    motes.position.set(player.pos.x, player.pos.y, player.pos.z);
    motes.rotation.y += dt * 0.025;
    // fogueira tremeluz
    for (let i = 0; i < fireFlames.length; i++) {
      const f = fireFlames[i];
      const k = 0.82 + Math.sin(t * 11 + i * 2.1) * 0.18 + Math.sin(t * 23 + i) * 0.08;
      f.scale.set(k, k * (1 + Math.sin(t * 17 + i * 3) * 0.16), 1);
      f.position.y = campY + 0.5 + Math.sin(t * 13 + i) * 0.05;
    }
    fireLight.intensity = 2 + Math.sin(t * 9.3) * 0.5 + Math.sin(t * 23.7) * 0.3;
    // fumaça: fogueira + chaminés visíveis
    smokeAcc += dt;
    if (smokeAcc > 0.4) {
      smokeAcc = 0;
      _v1.set(2 + rand(-0.15, 0.15), campY + 0.9, -2 + rand(-0.15, 0.15));
      _v2.set(rand(-0.2, 0.2), rand(0.8, 1.3), rand(-0.2, 0.2));
      FX.spawnParticle(_v1, _v2, 0x6a6661, rand(0.25, 0.5), rand(1.4, 2.2), -0.55);
      for (const s of Structures.smokeSpots) {
        if (Math.random() < 0.55) continue;
        if (Math.hypot(s.x - player.pos.x, s.z - player.pos.z) > 140) continue;
        _v1.set(s.x, s.y, s.z);
        _v2.set(rand(-0.3, 0.3), rand(0.7, 1.2), rand(-0.3, 0.3));
        FX.spawnParticle(_v1, _v2, 0x8d8983, rand(0.3, 0.6), rand(1.6, 2.6), -0.5);
      }
    }
    // bandeiras do forte tremulam
    for (let i = 0; i < Structures.flags.length; i++) {
      const fl = Structures.flags[i];
      fl.rotation.y = fl.userData.ry + Math.sin(t * 2.6 + i * 1.3) * 0.3 + Math.sin(t * 5.1 + i) * 0.12;
      fl.scale.x = 1 + Math.sin(t * 7 + i * 2) * 0.09;
    }
    // braseiros do forte pulsam
    for (let i = 0; i < Structures.flames.length; i++) {
      const f = Structures.flames[i];
      f.scale.setScalar(1 + Math.sin(t * 9 + i * 1.9) * 0.16);
    }
    // canto de passarinhos quando fora do deserto
    chirpAcc -= dt;
    if (chirpAcc <= 0) {
      chirpAcc = rand(3.5, 9);
      if (biomeAt(player.pos.x, player.pos.z) > -0.15) SFX.chirp();
    }
  }
  return { update };
})();

/* ================================================================
   ANIMAIS — cervos (carne) e lobos (selvagens, mordem)
   ================================================================ */
const Animals = (() => {
  const list = [];
  function quadruped(color, size, predator) {
    const g = new THREE.Group();
    const mat = csmMat(new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26 * size, 0.6 * size, 5, 10), mat);
    body.rotation.z = Math.PI / 2;
    body.position.y = 0.62 * size;
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17 * size, 10, 8), mat);
    head.position.set(0.48 * size, 0.85 * size, 0);
    g.add(head);
    const snout = new THREE.Mesh(new THREE.CapsuleGeometry(0.07 * size, 0.14 * size, 4, 8), mat);
    snout.rotation.z = Math.PI / 2;
    snout.position.set(0.64 * size, 0.8 * size, 0);
    g.add(snout);
    for (const se of [-1, 1]) { // orelhas
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.045 * size, 0.14 * size, 6), mat);
      ear.position.set(0.42 * size, 1.0 * size, se * 0.1 * size);
      g.add(ear);
    }
    if (!predator) { // chifres do cervo
      for (const se of [-1, 1]) {
        const h1 = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.3, 5), csmMat(new THREE.MeshStandardMaterial({ color: 0x9a7e54, roughness: 0.7 })));
        h1.position.set(0.42 * size, 1.12 * size, se * 0.08 * size);
        h1.rotation.z = -0.3; h1.rotation.x = se * 0.5;
        g.add(h1);
      }
    }
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.07 * size, 6, 5), mat);
    tail.position.set(-0.55 * size, 0.72 * size, 0);
    g.add(tail);
    const legs = [];
    for (const [lx, lz] of [[0.32, 0.14], [0.32, -0.14], [-0.32, 0.14], [-0.32, -0.14]]) {
      const lg = new THREE.Group();
      lg.position.set(lx * size, 0.5 * size, lz * size);
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.045 * size, 0.04 * size, 0.5 * size, 6), mat);
      l.position.y = -0.25 * size;
      lg.add(l);
      g.add(lg);
      legs.push(lg);
    }
    return { g, legs };
  }
  function spawnPos() {
    for (let i = 0; i < 30; i++) {
      const a = rand(TAU), r = rand(60, 420);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (heightAt(x, z) > WATER_LEVEL + 1 && slopeAt(x, z) < 0.4 && Math.hypot(x - CITY.x, z - CITY.z) > 100) return { x, z };
    }
    return { x: 120, z: 60 };
  }
  function makeAnimal(predator) {
    const size = predator ? 0.85 : rand(0.9, 1.15);
    const { g, legs } = quadruped(predator ? 0x4a4a52 : 0x9a6b42, size, predator);
    scene.add(g);
    const s = spawnPos();
    g.position.set(s.x, heightAt(s.x, s.z), s.z);
    const a = {
      predator, size, group: g, legs,
      alive: true, hp: predator ? 70 : 40,
      yaw: rand(TAU), phase: rand(TAU), speedF: 0,
      wander: rand(3, 8), biteT: 0, deadT: 0,
      sph: [{ c: new THREE.Vector3(), r: 0.55 * size, part: 'body' }, { c: new THREE.Vector3(), r: 0.24 * size, part: 'head' }],
      pos() { return g.position; },
      hitSpheres() {
        const p = g.position;
        this.sph[0].c.set(p.x, p.y + 0.62 * size, p.z);
        const fs = Math.sin(this.yaw), fc = Math.cos(this.yaw);
        this.sph[1].c.set(p.x + fs * 0.5 * size, p.y + 0.85 * size, p.z + fc * 0.5 * size);
        return this.sph;
      },
      damage(dmg, hitPos, dir, head) {
        if (!this.alive) return false;
        this.hp -= dmg;
        this.fleeing = 6; // tomou tiro: foge (ou ataca, se lobo)
        if (this.hp <= 0) {
          this.alive = false;
          this.deadT = 0;
          addScore(40, false);
          Pickups.spawn({ x: g.position.x, z: g.position.z }, 'meat');
          return true;
        }
        return false;
      },
    };
    list.push(a);
    extraTargets.push(a);
    return a;
  }
  for (let i = 0; i < 8; i++) makeAnimal(false);
  for (let i = 0; i < 5; i++) makeAnimal(true);

  function update(dt, t) {
    for (const a of list) {
      const g = a.group;
      if (!a.alive) { // tomba de lado e some
        a.deadT += dt;
        g.rotation.z = Math.min(Math.PI / 2, a.deadT * 3);
        if (a.deadT > 5) {
          const s = spawnPos();
          g.position.set(s.x, heightAt(s.x, s.z), s.z);
          g.rotation.z = 0;
          a.hp = a.predator ? 70 : 40;
          a.alive = true;
        }
        continue;
      }
      const dP = g.position.distanceTo(player.pos);
      let tx = null, tz = null, speed = 0;
      if (a.predator && dP < 24 && !player.dead) { // lobo caça
        tx = player.pos.x; tz = player.pos.z; speed = 4.4;
        if (dP < 1.7 && a.biteT <= 0) {
          a.biteT = 1.2;
          playerDamage(8 + (Math.random() * 5 | 0), g.position);
        }
      } else if (!a.predator && (dP < 12 || a.fleeing > 0)) { // cervo foge
        tx = g.position.x + (g.position.x - player.pos.x);
        tz = g.position.z + (g.position.z - player.pos.z);
        speed = 5.2;
      } else { // vagueia
        a.wander -= dt;
        if (a.wander <= 0) { a.wander = rand(4, 9); a.wyaw = rand(TAU); }
        if (a.wyaw !== undefined && a.wander > 2) {
          tx = g.position.x + Math.sin(a.wyaw) * 10;
          tz = g.position.z + Math.cos(a.wyaw) * 10;
          speed = a.predator ? 1.6 : 1.2;
        }
      }
      a.fleeing = Math.max(0, (a.fleeing || 0) - dt);
      a.biteT = Math.max(0, a.biteT - dt);
      let spd = 0;
      if (tx !== null) {
        const dx = tx - g.position.x, dz = tz - g.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.5) {
          spd = speed;
          g.position.x += dx / d * speed * dt;
          g.position.z += dz / d * speed * dt;
          const targetYaw = Math.atan2(dx, dz);
          let dy = targetYaw - a.yaw;
          while (dy > Math.PI) dy -= TAU; while (dy < -Math.PI) dy += TAU;
          a.yaw += dy * Math.min(1, 6 * dt);
        }
      }
      g.position.y = heightAt(g.position.x, g.position.z);
      g.rotation.y = a.yaw;
      a.phase += dt * (2 + spd * 2.6);
      const sw = Math.sin(a.phase * 2.4) * 0.55 * clamp(spd / 4, 0.12, 1);
      a.legs[0].rotation.x = sw; a.legs[3].rotation.x = sw;
      a.legs[1].rotation.x = -sw; a.legs[2].rotation.x = -sw;
    }
  }
  return { update, list };
})();

/* ================================================================
   CRIATURAS DA NOITE — zumbis e fantasmas (somem ao amanhecer)
   ================================================================ */
const Night = (() => {
  const zMat = csmMat(new THREE.MeshStandardMaterial({ color: 0x5a7a3e, roughness: 0.85 }));
  const zRag = csmMat(new THREE.MeshStandardMaterial({ color: 0x3c3a30, roughness: 0.9 }));
  const gMat = new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.28, depthWrite: false });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x100000, emissive: 0xff3214, emissiveIntensity: 3 });
  const list = [];
  function makeZombie() {
    const g = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.5, 5, 10), zRag);
    torso.position.y = 1.1; torso.castShadow = true; g.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 9), zMat);
    head.position.y = 1.75; g.add(head);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 5), eyeMat);
      eye.position.set(s * 0.09, 1.78, 0.2); g.add(eye);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.55, 4, 8), zMat);
      arm.position.set(s * 0.38, 1.35, 0.3);
      arm.rotation.x = -Math.PI / 2 + 0.2; g.add(arm); // braços esticados
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.5, 4, 8), zRag);
      leg.position.set(s * 0.16, 0.45, 0); g.add(leg);
    }
    return g;
  }
  function makeGhost() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 10), gMat);
    body.scale.y = 1.3; body.position.y = 1.4; g.add(body);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.9, 10, 1, true), gMat);
    tail.rotation.x = Math.PI; tail.position.y = 0.75; g.add(tail);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), eyeMat);
      eye.position.set(s * 0.13, 1.5, 0.32); g.add(eye);
    }
    return g;
  }
  function makeCreature(ghost) {
    const g = ghost ? makeGhost() : makeZombie();
    g.visible = false;
    scene.add(g);
    const c = {
      ghost, group: g,
      alive: false, hp: 0, yaw: 0, phase: rand(TAU), hitT: 0, groanT: rand(4),
      sph: [{ c: new THREE.Vector3(), r: 0.45, part: 'body' }, { c: new THREE.Vector3(), r: 0.3, part: 'head' }],
      pos() { return g.position; },
      hitSpheres() {
        this.sph[0].c.set(g.position.x, g.position.y + 1.1, g.position.z);
        this.sph[1].c.set(g.position.x, g.position.y + (this.ghost ? 1.4 : 1.75), g.position.z);
        return this.sph;
      },
      damage(dmg) {
        if (!this.alive) return false;
        this.hp -= dmg;
        if (this.hp <= 0) {
          this.alive = false;
          this.group.visible = false;
          addScore(this.ghost ? 120 : 80, true);
          addKillFeed(`<b>Você</b> ▸ ${this.ghost ? 'Fantasma' : 'Zumbi'}`);
          if (!this.ghost && Math.random() < 0.4) Pickups.drop(g.position);
          return true;
        }
        return false;
      },
    };
    list.push(c);
    extraTargets.push(c);
    return c;
  }
  for (let i = 0; i < 9; i++) makeCreature(false);
  for (let i = 0; i < 5; i++) makeCreature(true);
  let wasDeepNight = false;

  function update(dt, t) {
    const nk = Env.nightK;
    if (nk > 0.8) wasDeepNight = true;
    if (wasDeepNight && nk < 0.2 && state.started) { MFlags.night = true; }
    for (const c of list) {
      const g = c.group;
      if (!c.alive) {
        // só nascem na noite fechada, perto do player
        if (nk > 0.65 && Math.random() < dt * 0.25 && !player.dead) {
          const a = rand(TAU), r = rand(26, 55);
          const x = player.pos.x + Math.cos(a) * r, z = player.pos.z + Math.sin(a) * r;
          if (heightAt(x, z) < WATER_LEVEL + 0.5) continue;
          c.alive = true;
          c.hp = c.ghost ? 50 : 70;
          g.position.set(x, heightAt(x, z), z);
          g.visible = true;
          if (c.ghost) SFX.whisper(); else SFX.groan();
        }
        continue;
      }
      if (nk < 0.4) { // amanheceu: derretem
        g.scale.y = Math.max(0.01, g.scale.y - dt * 0.8);
        g.position.y -= dt * 1.2;
        if (g.scale.y <= 0.02) { c.alive = false; g.visible = false; g.scale.y = 1; }
        continue;
      }
      const dP = g.position.distanceTo(player.pos);
      const speed = c.ghost ? 3.6 : 2.3;
      if (dP > 1.4 && !player.dead) {
        const dx = player.pos.x - g.position.x, dz = player.pos.z - g.position.z;
        const d = Math.hypot(dx, dz);
        g.position.x += dx / d * speed * dt;
        g.position.z += dz / d * speed * dt;
        c.yaw = Math.atan2(dx, dz);
      }
      c.hitT = Math.max(0, c.hitT - dt);
      if (dP < 1.6 && c.hitT <= 0 && !player.dead) {
        c.hitT = c.ghost ? 0.8 : 1.2;
        playerDamage(c.ghost ? 7 : 13, g.position);
        if (c.ghost) SFX.whisper();
      }
      c.phase += dt * 4;
      if (c.ghost) {
        g.position.y = heightAt(g.position.x, g.position.z) + 0.5 + Math.sin(c.phase) * 0.25;
        g.children[0].material.opacity = 0.2 + Math.sin(t * 3 + c.phase) * 0.1;
      } else {
        Structures.collide(g.position, 0.4, 1.8); // zumbis respeitam paredes
        g.position.y = heightAt(g.position.x, g.position.z) + Math.abs(Math.sin(c.phase)) * 0.04;
        g.rotation.z = Math.sin(c.phase * 0.7) * 0.08; // cambaleia
      }
      g.rotation.y = c.yaw;
      c.groanT -= dt;
      if (c.groanT <= 0 && dP < 30) {
        c.groanT = rand(4, 9);
        if (c.ghost) SFX.whisper(); else SFX.groan();
      }
    }
  }
  return { update, list };
})();

/* ================================================================
   BOSS 2 — O VISITANTE (alien na cratera do deserto) -> arma PLASMA
   ================================================================ */
const Alien = (() => {
  // acha um ponto de deserto para a queda do disco
  let SITE = { x: 260, z: 260 };
  for (let i = 0; i < 200; i++) {
    const a = rand(TAU), r = rand(180, 430);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (biomeAt(x, z) < -0.3 && heightAt(x, z) > WATER_LEVEL + 1.5 && Math.hypot(x - CITY.x, z - CITY.z) > 110) { SITE = { x, z }; break; }
  }
  const sy = heightAt(SITE.x, SITE.z);
  // disco voador acidentado
  {
    const hull = csmMat(new THREE.MeshStandardMaterial({ color: 0x7d8894, metalness: 0.85, roughness: 0.3 }));
    const saucer = new THREE.Mesh(new THREE.SphereGeometry(7, 24, 12), hull);
    saucer.scale.set(1, 0.22, 1);
    saucer.position.set(SITE.x, sy + 0.8, SITE.z);
    saucer.rotation.z = 0.28;
    saucer.castShadow = true;
    scene.add(saucer);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(2.4, 16, 10, 0, TAU, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x4dffd2, transparent: true, opacity: 0.35, emissive: 0x2affd0, emissiveIntensity: 0.6 }));
    dome.position.set(SITE.x, sy + 2.0, SITE.z);
    dome.rotation.z = 0.28;
    scene.add(dome);
    const ringG = new THREE.Mesh(new THREE.TorusGeometry(5.6, 0.25, 8, 28),
      new THREE.MeshStandardMaterial({ color: 0x0a2a22, emissive: 0x35ffc8, emissiveIntensity: 2.2 }));
    ringG.rotation.x = Math.PI / 2 + 0.28;
    ringG.position.set(SITE.x, sy + 1.1, SITE.z);
    scene.add(ringG);
  }
  // o Visitante
  const skin = csmMat(new THREE.MeshStandardMaterial({ color: 0x9fb8a8, roughness: 0.6 }));
  const eyeM = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.15, metalness: 0.6 });
  const group = new THREE.Group();
  const parts = {};
  {
    const cast = m => { m.castShadow = true; return m; };
    const torso = cast(new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1.0, 6, 12), skin));
    torso.position.y = 2.2; group.add(torso);
    parts.head = new THREE.Group();
    parts.head.position.y = 3.35;
    const skull = cast(new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), skin));
    skull.scale.set(1, 1.25, 1.05);
    parts.head.add(skull);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 9), eyeM);
      eye.scale.set(1, 1.5, 0.6);
      eye.position.set(s * 0.26, 0.05, 0.42);
      eye.rotation.z = s * 0.4;
      parts.head.add(eye);
    }
    group.add(parts.head);
    for (const s of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(s * 0.5, 2.85, 0);
      const a1 = cast(new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.9, 4, 8), skin));
      a1.position.y = -0.55; arm.add(a1);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), skin);
      hand.position.y = -1.1; arm.add(hand);
      parts[s < 0 ? 'armL' : 'armR'] = arm;
      group.add(arm);
      const leg = cast(new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.9, 4, 8), skin));
      leg.position.set(s * 0.22, 0.85, 0);
      group.add(leg);
    }
  }
  group.position.set(SITE.x + 6, sy, SITE.z + 6);
  scene.add(group);

  const B = { alive: true, active: false, hp: 1900, hpMax: 1900, yaw: 0, phase: 0, nextShot: 0, blinkT: 6, deadT: -1, respawnT: 0 };
  const orbs = [];
  const orbMat = new THREE.MeshStandardMaterial({ color: 0x03130f, emissive: 0x35ffc8, emissiveIntensity: 4, roughness: 0.3 });
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), orbMat);
    m.visible = false; scene.add(m);
    orbs.push({ m, vel: new THREE.Vector3(), live: false });
  }
  const sph = [
    { c: new THREE.Vector3(), r: 0.75, part: 'head' },
    { c: new THREE.Vector3(), r: 0.62, part: 'body' },
    { c: new THREE.Vector3(), r: 0.45, part: 'body' },
  ];
  function hitSpheres() {
    const p = group.position;
    sph[0].c.set(p.x, p.y + 3.35, p.z);
    sph[1].c.set(p.x, p.y + 2.2, p.z);
    sph[2].c.set(p.x, p.y + 1.0, p.z);
    return sph;
  }
  function damage(dmg, hitPos, dir, part) {
    if (!B.alive || B.deadT >= 0) return false;
    B.active = true;
    B.hp -= dmg * (part === 'head' ? 1.4 : 1);
    if (B.hp <= 0) {
      B.alive = false; B.deadT = 0; B.respawnT = 150;
      addScore(2000, true);
      addKillFeed('<b>Você</b> ▸ <b>O VISITANTE</b>');
      SFX.victory();
      timeScale = 0.3;
      setTimeout(() => { timeScale = 1; }, 900);
      showBanner('VISITANTE ELIMINADO<small>tecnologia alienígena recuperada</small>', 4200);
      unlockWeapon(4, 'rifle de plasma equipável na tecla 5');
      for (let i = 0; i < 4; i++) Pickups.drop({ x: group.position.x + rand(-4, 4), z: group.position.z + rand(-4, 4) }, true);
      MFlags.alien = true;
      return true;
    }
    return false;
  }
  function update(dt, t) {
    for (const o of orbs) {
      if (!o.live) continue;
      o.m.position.addScaledVector(o.vel, dt);
      o.m.scale.setScalar(1 + Math.sin(t * 26) * 0.15);
      const d = o.m.position.distanceTo(player.pos);
      if (d < 1.2 || o.m.position.y < heightAt(o.m.position.x, o.m.position.z) + 0.2) {
        o.live = false; o.m.visible = false;
        FX.burst(o.m.position, _v1.set(0, 1, 0), 'spark');
        if (d < 4) playerDamage(Math.round(16 * (1 - d / 5)) + 5, o.m.position);
      }
    }
    if (!B.alive) {
      if (B.deadT >= 0) {
        B.deadT += dt;
        group.rotation.x = -Math.min(1.4, B.deadT * 1.5);
        if (B.deadT > 1) group.position.y = heightAt(group.position.x, group.position.z) - (B.deadT - 1) * 0.8;
        if (B.deadT > 3) { B.deadT = -1; group.visible = false; }
      } else {
        B.respawnT -= dt;
        if (B.respawnT <= 0) {
          B.alive = true; B.active = false; B.hp = B.hpMax;
          group.visible = true; group.rotation.set(0, 0, 0);
          group.position.set(SITE.x + 6, heightAt(SITE.x + 6, SITE.z + 6), SITE.z + 6);
        }
      }
      return;
    }
    const dP = group.position.distanceTo(player.pos);
    if (!B.active) {
      if (dP < 45 && !player.dead) { B.active = true; SFX.roar(); showBanner('O VISITANTE<small>algo saiu dos destroços...</small>', 3000); }
      group.position.y = heightAt(group.position.x, group.position.z) + Math.sin(t * 1.2) * 0.1;
      return;
    }
    B.phase += dt;
    // teleporte lateral (blink)
    B.blinkT -= dt;
    if (B.blinkT <= 0 && dP < 60) {
      B.blinkT = rand(4, 7);
      FX.burst(group.position, _v1.set(0, 1, 0), 'spark');
      const a = rand(TAU);
      group.position.x += Math.cos(a) * 10;
      group.position.z += Math.sin(a) * 10;
      FX.burst(group.position, _v1.set(0, 1, 0), 'spark');
    }
    // persegue flutuando
    const dx = player.pos.x - group.position.x, dz = player.pos.z - group.position.z;
    const d = Math.hypot(dx, dz);
    if (d > 12) {
      group.position.x += dx / d * 3.4 * dt;
      group.position.z += dz / d * 3.4 * dt;
    }
    B.yaw = Math.atan2(dx, dz);
    group.rotation.y = B.yaw;
    group.position.y = heightAt(group.position.x, group.position.z) + 0.25 + Math.sin(B.phase * 2) * 0.15;
    parts.armR.rotation.x = -1.2; // mão erguida disparando
    parts.armL.rotation.x = Math.sin(B.phase * 1.5) * 0.3;
    // tiro triplo de plasma
    if (dP < 70 && state.gameTime >= B.nextShot && !player.dead) {
      B.nextShot = state.gameTime + 1.6;
      for (let i = 0; i < 3; i++) {
        const o = orbs.find(o => !o.live);
        if (!o) break;
        o.live = true; o.m.visible = true;
        o.m.position.set(group.position.x, group.position.y + 2.8, group.position.z);
        _v2.copy(player.pos); _v2.y += 1.2;
        _v2.x += rand(-2, 2) * i; _v2.z += rand(-2, 2) * i;
        o.vel.copy(_v2).sub(o.m.position).normalize().multiplyScalar(22);
        SFX.bossShot();
      }
    }
  }
  const api = { update, damage, hitSpheres, get alive() { return B.alive; }, pos: () => group.position, state: B, name: 'VISITANTE', SITE };
  Bosses.push(api);
  return api;
})();

/* ================================================================
   MISSÕES — cadeia com recompensas
   ================================================================ */
const Missions = (() => {
  function baseCleared() {
    for (const b of Structures.baseSites) {
      const guards = Enemies.list.filter(e => e.plan && e.plan.army && Math.hypot(e.plan.x - b.x, e.plan.z - b.z) < 30);
      if (guards.length && guards.every(e => !e.alive)) return true;
    }
    return false;
  }
  const list = [
    { text: 'Elimine 6 inimigos', ok: () => kills >= 6,
      rw() { inventory.nades = Math.min(inventory.nadesMax, inventory.nades + 2); updateInvHUD(); addScore(300); }, rt: '+2 granadas · +300 pts' },
    { text: 'Limpe uma base militar (■ no radar)', ok: baseCleared,
      rw() { inventory.medkits = inventory.medkitsMax; updateInvHUD(); addScore(500); }, rt: 'kits médicos cheios · +500 pts' },
    { text: 'Chegue ao topo da TORRE NEXUS (cidade)', ok: () => player.pos.y > Structures.towerTopY - 1.5,
      rw() { addScore(800); }, rt: 'BAZUCA e helicóptero no telhado · +800 pts' },
    { text: 'Derrote o COLOSSO no forte oriental', ok: () => MFlags.colosso,
      rw() { addScore(600); }, rt: 'ARMADURA azul do guardião · +600 pts' },
    { text: 'Investigue a queda no deserto: O VISITANTE', ok: () => MFlags.alien,
      rw() { addScore(800); }, rt: 'rifle de PLASMA · +800 pts' },
    { text: 'Sobreviva a uma noite inteira', ok: () => MFlags.night,
      rw() { inventory.meat = inventory.meatMax; updateInvHUD(); addScore(1000); }, rt: 'provisões cheias · +1000 pts' },
  ];
  let idx = 0;
  function refresh() {
    ui.missionText.textContent = idx < list.length ? list[idx].text : 'Mundo livre — cace, dirija, explore!';
  }
  function update() {
    if (idx >= list.length) return;
    if (list[idx].ok()) {
      const m = list[idx];
      m.rw();
      showBanner('MISSÃO CONCLUÍDA<small>' + m.rt + '</small>', 4200);
      SFX.unlock();
      idx++;
      refresh();
    }
  }
  refresh();
  return { update, get idx() { return idx; }, set idx(v) { idx = clamp(v, 0, list.length); refresh(); } };
})();

/* ================================================================
   INTERAÇÃO — baús, bazuca, veículos (tecla E)
   ================================================================ */
const Interact = (() => {
  const chestWood = csmMat(new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.7 }));
  const chestGold = csmMat(new THREE.MeshStandardMaterial({ color: 0xc9a04e, metalness: 0.8, roughness: 0.35 }));
  for (const s of Structures.chestSpots) {
    const y = heightAt(s.x, s.z);
    const b = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.5, 0.55, 2, 0.06), chestWood);
    b.position.set(s.x, y + 0.25, s.z); b.castShadow = true;
    scene.add(b);
    const lid = new THREE.Mesh(new RoundedBoxGeometry(0.94, 0.2, 0.6, 2, 0.06), chestWood);
    lid.position.set(s.x, y + 0.58, s.z);
    scene.add(lid);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.08, 0.12), chestGold);
    trim.position.set(s.x, y + 0.46, s.z + 0.24);
    scene.add(trim);
  }
  const chest = { medkits: 0, nades: 0, meat: 0 };

  function chestSwap() {
    const stored = chest.medkits + chest.nades + chest.meat;
    if (stored > 0) {
      const tm = Math.min(inventory.medkitsMax - inventory.medkits, chest.medkits);
      inventory.medkits += tm; chest.medkits -= tm;
      const tn = Math.min(inventory.nadesMax - inventory.nades, chest.nades);
      inventory.nades += tn; chest.nades -= tn;
      const tc = Math.min(inventory.meatMax - inventory.meat, chest.meat);
      inventory.meat += tc; chest.meat -= tc;
      centerMsg('Baú: itens retirados', 1300);
    } else {
      const dm = Math.max(0, inventory.medkits - 1); chest.medkits += dm; inventory.medkits -= dm;
      const dn = Math.max(0, inventory.nades - 1); chest.nades += dn; inventory.nades -= dn;
      chest.meat += inventory.meat; inventory.meat = 0;
      centerMsg('Baú: excedente guardado (mantém 1 de cada)', 1600);
    }
    SFX.pickup();
    updateInvHUD();
  }
  function current() {
    if (state.flying) return { txt: 'SAIR DO HELICÓPTERO', fn: () => Heli.exit() };
    if (state.driving) return { txt: 'SAIR DO VEÍCULO', fn: tryToggleCar };
    if (!window.__BR_active) { // BR: sem baú de guardar, sem bazuca grátis (loot vem dos baús BR)
      const bz = Structures.bazookaSpot;
      if (arsenal[3].locked && Math.hypot(player.pos.x - bz.x, player.pos.z - bz.z) < 2.8 && Math.abs(player.pos.y - bz.y) < 3.5)
        return { txt: 'PEGAR BAZUCA', fn: () => unlockWeapon(3, 'tecla 4 para equipar') };
      for (const s of Structures.chestSpots)
        if (Math.hypot(player.pos.x - s.x, player.pos.z - s.z) < 2.4) return { txt: 'USAR BAÚ', fn: chestSwap };
    }
    if (player.pos.distanceTo(Heli.group.position) < 5) return { txt: 'PILOTAR HELICÓPTERO', fn: tryToggleCar };
    const near = Car.nearest(player.pos);
    if (near.d < 4.5) return { txt: 'ENTRAR — ' + near.v.cfg.name, fn: tryToggleCar };
    return null;
  }
  function update(dt, t) {
    // BR: na nave/queda/espectador (freeze) não existe interação com o mundo
    if (window.__BR_freeze) { ui.prompt.style.opacity = '0'; return; }
    const c = current();
    if (c) ui.prompt.innerHTML = `<b>E</b> &nbsp;${c.txt}`;
    ui.prompt.style.opacity = c ? '1' : '0';
    if (c && justPressed.has('KeyE') && !player.dead) c.fn();
  }
  function renderInv() {
    ui.invList.innerHTML =
      `<div class="invRow"><span>✚ Kit médico × ${inventory.medkits}</span><span class="k">[Q] usar</span></div>
       <div class="invRow"><span>● Granada × ${inventory.nades}</span><span class="k">[G] lançar</span></div>
       <div class="invRow"><span>🍖 Carne × ${inventory.meat}</span><span class="k">[F] comer</span></div>
       <div class="invRow"><span>🛡 Armadura ${Math.round(player.armor)}/${player.armorMax}</span><span class="k">do COLOSSO</span></div>
       <div class="invRow"><span>Arsenal ${arsenal.filter(w => !w.locked).length}/5</span><span class="k">[T] troca mira</span></div>
       <div class="invRow"><span>Baú: ${chest.medkits}✚ ${chest.nades}● ${chest.meat}🍖</span><span class="k">guarde em baús</span></div>`;
  }
  return { update, renderInv, chest };
})();

/* ================== minimapa / radar (canvas 2D) ================== */
const MiniMap = (() => {
  const S = 168, C = S / 2, RANGE = 95;
  const cv = ui.minimap;
  let worker = null, legacyCtx = null;
  /* PARALELISMO: o radar é desenhado num Web Worker via OffscreenCanvas —
     o jogo só posta um Float32Array compacto de posições (15x/s). Sem suporte
     do navegador, cai no desenho clássico na thread principal. */
  if (window.Worker && cv.transferControlToOffscreen) {
    try {
      const off = cv.transferControlToOffscreen();
      worker = new Worker('js/minimap-worker.js');
      worker.postMessage({ type: 'init', canvas: off,
        sites: Structures.sites.flatMap(s => [s.x, s.z]) }, [off]);
      worker.onerror = e => console.warn('[minimap] worker falhou:', e.message);
    } catch (e) { worker = null; }
  }
  if (!worker) legacyCtx = cv.getContext('2d');

  function pack() {
    const picks = Pickups.actives();
    const ens = Enemies.list.filter(e => e.alive);
    const bs = Bosses.filter(b => b.alive);
    const buf = new Float32Array(6 + picks.length * 2 + 1 + ens.length * 3 + 1 + bs.length * 3);
    let i = 0;
    _euler.setFromQuaternion(camera.quaternion);
    buf[i++] = _euler.y; buf[i++] = player.pos.x; buf[i++] = player.pos.z;
    buf[i++] = Car.group.position.x; buf[i++] = Car.group.position.z;
    buf[i++] = picks.length;
    for (const p of picks) { buf[i++] = p.root.position.x; buf[i++] = p.root.position.z; }
    buf[i++] = ens.length;
    for (const e of ens) {
      buf[i++] = e.group.position.x; buf[i++] = e.group.position.z;
      buf[i++] = (e.fsm === 'PERSEGUIR' || e.fsm === 'ATACAR') ? 1 : 0;
    }
    buf[i++] = bs.length;
    for (const b of bs) { buf[i++] = b.pos().x; buf[i++] = b.pos().z; buf[i++] = b.name === 'VISITANTE' ? 1 : 0; }
    return buf;
  }
  function draw() {
    if (worker) { const b = pack(); worker.postMessage({ type: 'draw', b }, [b.buffer]); return; }
    drawLegacy();
  }
  function drawLegacy() {
    const ctx = legacyCtx;
    ctx.clearRect(0, 0, S, S);
    _euler.setFromQuaternion(camera.quaternion);
    const yaw = _euler.y;
    ctx.save();
    ctx.translate(C, C);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    for (const r of [C * 0.45, C * 0.85]) { ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(-C, 0); ctx.lineTo(C, 0); ctx.moveTo(0, -C); ctx.lineTo(0, C); ctx.stroke();
    ctx.rotate(yaw);
    const px = player.pos.x, pz = player.pos.z;
    const put = (wx, wz) => [ (wx - px) / RANGE * C, (wz - pz) / RANGE * C ];
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('N', 0, -C + 14);
    {
      const [x, y] = put(Car.group.position.x, Car.group.position.z);
      if (x * x + y * y < C * C * 0.92) { ctx.fillStyle = '#4dd8ff'; ctx.fillRect(x - 3.5, y - 3.5, 7, 7); }
    }
    ctx.fillStyle = 'rgba(225,225,225,0.45)';
    for (const s of Structures.sites) {
      const [x, y] = put(s.x, s.z);
      if (x * x + y * y < C * C * 0.92) ctx.fillRect(x - 2, y - 2, 4, 4);
    }
    ctx.fillStyle = '#7dff8a';
    for (const p of Pickups.actives()) {
      const [x, y] = put(p.root.position.x, p.root.position.z);
      if (x * x + y * y < C * C * 0.92) ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    for (const e of Enemies.list) {
      if (!e.alive) continue;
      const [x, y] = put(e.group.position.x, e.group.position.z);
      if (x * x + y * y > C * C * 0.92) continue;
      const hot = e.fsm === 'PERSEGUIR' || e.fsm === 'ATACAR';
      ctx.fillStyle = hot ? '#ff4030' : 'rgba(255,120,90,0.8)';
      ctx.beginPath(); ctx.arc(x, y, hot ? 4 : 3, 0, TAU); ctx.fill();
    }
    for (const B2 of Bosses) {
      if (!B2.alive) continue;
      let [bx, by] = put(B2.pos().x, B2.pos().z);
      const dEdge = Math.hypot(bx, by), maxR = C * 0.84;
      if (dEdge > maxR) { bx *= maxR / dEdge; by *= maxR / dEdge; }
      ctx.fillStyle = B2.name === 'VISITANTE' ? '#35ffc8' : '#ff7a1e';
      ctx.beginPath();
      ctx.moveTo(bx, by - 7); ctx.lineTo(bx + 5.5, by); ctx.lineTo(bx, by + 7); ctx.lineTo(bx - 5.5, by);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke();
    }
    ctx.restore();
    ctx.save();
    ctx.translate(C, C);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  return { draw };
})();

/* ================== loop principal ================== */
let lastNow = performance.now();
let treeAcc = 9, fpsFrames = 0, fpsAcc = 0, fpsVal = 0, miniAcc = 0;
const carPosV = new THREE.Vector3();
let menuT = 0;

function animate() {
  requestAnimationFrame(animate);
  tick();
}
function tick(forceDt) {
  const now = performance.now();
  const dt = (forceDt !== undefined ? forceDt : Math.min((now - lastNow) / 1000, 0.05)) * timeScale;
  lastNow = now;

  if (!state.started || state.paused) {
    // menu / pausa: mundo vivo ao fundo, câmera orbitando devagar
    menuT += dt;
    if (!state.started) {
      const a = menuT * 0.07;
      camera.position.set(Math.sin(a) * 16, heightAt(Math.sin(a) * 16, Math.cos(a) * 16) + 4.5, Math.cos(a) * 16);
      camera.lookAt(Car.group.position.x, Car.group.position.y + 1.2, Car.group.position.z);
      camera.updateProjectionMatrix();
    }
    Grass.update(camera.position, carPosV.copy(Car.group.position), menuT);
    Env.update(dt, menuT);
    Car.update(dt, menuT);
    Heli.update(dt, menuT);
    Animals.update(dt, menuT);
    FX.update(dt);
    Amb.update(dt, menuT);
    Water.update(menuT);
    if (sky.material.uniforms.time) sky.material.uniforms.time.value = menuT;
    camera.updateMatrixWorld();
    csm.update();
    composer.render();
    return;
  }

  const t = (state.gameTime += dt);
  menuT = t;

  /* simulação */
  Env.update(dt, t);
  if (!state.driving && !state.flying && !window.__BR_freeze) playerUpdate(dt, t);
  shootUpdate(dt, t);
  world.step(1 / 60, dt, 3);
  Car.update(dt, t);
  Heli.update(dt, t);
  if (!window.__BR_active) Enemies.update(dt, t); // BR: sem inimigos comuns
  Animals.update(dt, t);
  if (!window.__BR_active) Night.update(dt, t);   // BR: sem zumbis/fantasmas
  Grenades.update(dt, t);
  Rockets.update(dt, t);
  Pickups.update(dt, t);
  if (!window.__BR_active) { Boss.update(dt, t); Alien.update(dt, t); Missions.update(); }
  Interact.update(dt, t);
  FX.update(dt);
  Amb.update(dt, t);
  Water.update(t);

  /* áudio de clima (chuva) */
  SFX.musicUpdate();

  /* câmera + arma + HUD dinâmico */
  applyFpsCamera(dt, t);
  carCameraUpdate(dt);

  /* grama reativa: player E carro dobram as lâminas */
  carPosV.copy(Car.group.position);
  Grass.update(state.driving ? carPosV : player.pos, carPosV, t);

  /* LOD das árvores */
  treeAcc += dt;
  if (treeAcc > 0.45) { treeAcc = 0; rebucketTrees(player.pos.x, player.pos.z); }

  miniAcc += dt; // PERF: radar a 15 Hz basta (era todo frame)
  if (miniAcc > 1 / 15) { miniAcc = 0; MiniMap.draw(); }

  /* render */
  if (sky.material.uniforms.time) sky.material.uniforms.time.value = t; // nuvens andando
  camera.updateMatrixWorld();
  if (csmDirty) { csm.updateFrustums(); csmDirty = false; }
  csm.update();
  composer.render();

  /* contador de FPS (+ ping quando online e habilitado) */
  fpsFrames++; fpsAcc += dt;
  if (fpsAcc >= 0.5) {
    fpsVal = Math.round(fpsFrames / fpsAcc);
    const png = (SETTINGS.ping !== 0 && window.__MP_ping != null) ? ' · ' + window.__MP_ping + ' ms' : '';
    ui.fps.textContent = fpsVal + ' FPS' + png;
    fpsFrames = 0; fpsAcc = 0;
  }
  justPressed.clear();
}

/* ================== boot ================== */
window.addEventListener('pointerlockerror', () => {
  state.lockFailed = true;
  centerMsg('Pointer lock indisponível — rodando sem travar o mouse', 2600);
  setPaused(false);
});

function startGame(trusted) {
  if (state.started) return;
  SFX.init(); SFX.resume(); SFX.musicStart(); SFX.setVolumes();
  state.started = true;
  updateHealthHUD(); updateAmmoHUD(); updateInvHUD(); updateSlotsHUD(); updateArmorHUD();
  setTimeout(() => showBanner('CALL OF AI<small>siga as missões · cuidado com a noite</small>', 5200), 700);
  setPaused(false);
  if (trusted) {
    try { controls.lock(); } catch (err) { state.lockFailed = true; }
  } else {
    state.lockFailed = true;
  }
}
/* ---- menu: botões + configurações ---- */
$('btnNew').addEventListener('click', e => { e.stopPropagation(); startGame(e.isTrusted); });
$('btnSettings').addEventListener('click', e => { e.stopPropagation(); $('settings').classList.add('open'); });
$('btnBack').addEventListener('click', e => { e.stopPropagation(); $('settings').classList.remove('open'); });
$('settings').addEventListener('click', e => e.stopPropagation());
{ // bindings das configurações (aplicam ao vivo + persistem)
  const sv = $('setVol'), sr = $('setRes'), ss = $('setShadow'), sb = $('setBloom'), sp = $('setPing');
  sv.value = SETTINGS.vol * 100;
  sr.value = String(SETTINGS.res); ss.value = String(SETTINGS.shadow); sb.value = String(SETTINGS.bloom);
  sp.value = String(SETTINGS.ping === 0 ? 0 : 1);
  sv.oninput = () => { SETTINGS.vol = sv.value / 100; SFX.setVolumes(); persistSettings(); };
  sr.onchange = () => { SETTINGS.res = +sr.value; renderer.setPixelRatio(Math.min(devicePixelRatio, SETTINGS.res)); composer.setSize(window.innerWidth, window.innerHeight); persistSettings(); };
  ss.onchange = () => { SETTINGS.shadow = +ss.value; renderer.shadowMap.enabled = SETTINGS.shadow === 1; csmMaterials.forEach(m => m.needsUpdate = true); persistSettings(); };
  sb.onchange = () => { SETTINGS.bloom = +sb.value; bloomPass.enabled = SETTINGS.bloom === 1; persistSettings(); };
  sp.onchange = () => { SETTINGS.ping = +sp.value; persistSettings(); };
}
ui.overlay.addEventListener('click', (e) => {
  if (e.target.closest('#menuBtns') || e.target.closest('#settings')) return;
  if (state.started && state.paused) { // clique retoma quando pausado
    SFX.resume();
    setPaused(false);
    if (e.isTrusted) { try { controls.lock(); } catch (err) { state.lockFailed = true; } }
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  csm.updateFrustums();
});

/* hooks de depuração (inofensivos em produção) */
const __errors = [];
window.addEventListener('error', e => __errors.push(String(e.message)));
window.__game = {
  state, player, Car, Heli, Enemies, arsenal, Boss, Alien, Bosses, Grenades, Rockets, Pickups, Structures,
  inventory, keys, mouse, camera, Env, Missions, Interact, Animals, Night, MFlags,
  switchWeapon, unlockWeapon, startGame, tryToggleCar,
  get gun() { return gun; },
  get fps() { return fpsVal; },
  get errors() { return __errors; },
  tick, // passo manual do loop (testes/depuração): __game.tick(1/60)
  heightAt, biomeAt, groundAt,
  forceStart() { startGame(false); },
  teleportToCar() {
    player.pos.set(Car.group.position.x + 3, heightAt(Car.group.position.x + 3, Car.group.position.z), Car.group.position.z);
  },
};

/* MULTIPLAYER: referências pro multiplayer-client.js (aditivo) */
window.__MP = {
  THREE, scene, camera, renderer, composer, player, state, CFG,
  heightAt, groundAt, addKillFeed, showHitmarker, playerDamage,
  updateHealthHUD, updateArmorHUD, updateAmmoHUD, updateInvHUD, updateSlotsHUD,
  setTimeScale: v => { timeScale = v; },
  FX, DmgNums, SFX, rayBlockedAt, weaponRoot, centerMsg, showBanner,
  WATER_LEVEL, slopeAt, justPressed,
  socket: __mpSocket, spawn: __mpSpawn,
};

buildHeightGrid(CFG.WORLD_SIZE); // PERF: consultas de altura via grade bilinear daqui em diante
rebucketTrees(0, 0);
animate();
