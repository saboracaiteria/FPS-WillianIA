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
import { CFG, SETTINGS, persistSettings, isMobileDevice, isSmallScreen } from './js/config.js';
import { clamp, lerp, damp, rand, TAU, _v1, _v2, _v3, _q1, _m1, chaseCamPos, chaseLook } from './js/utils.js';
import { createTerrain } from './js/terrain.js';
import { createSFX } from './js/sfx.js';
import { createStructures } from './js/structures.js';
import { createFX } from './js/fx.js';
import { createDmgNums } from './js/dmgnums.js';
import { createWeapons } from './js/weapons.js';
import { createWeaponModels } from './js/weaponmodels.js';
import { createFpBody } from './js/fpbody.js';
import { createCharModels } from './js/charmodels.js';
import { createScenery } from './js/scenery.js';
import { createCar } from './js/car.js';
import { createHeli } from './js/heli.js';
import { createGrenades } from './js/grenades.js';
import { createRockets } from './js/rockets.js';
import { createPickups } from './js/pickups.js';
import { createEnv } from './js/env.js';
import { createWater } from './js/water.js';
import { createGrass } from './js/grass.js';
import { createEnemies } from './js/enemies.js';
import { createBoss } from './js/boss.js';
import { createAmb } from './js/amb.js';
import { createAnimals } from './js/animals.js';
import { createNight } from './js/night.js';
import { createAlien } from './js/alien.js';
import { createInteract } from './js/interact.js';
import { createTraining } from './js/training.js';
import { createCityModel } from './js/citymodel.js';
import { createClouds } from './js/clouds.js';
import { createDropship } from './js/dropship.js';
import { createParachute } from './js/parachute.js';
import { TouchControls } from './js/touch-controls.js';

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
// Azul atmosférico menos lavado: mantém profundidade sem transformar o
// horizonte e a introdução da nave em uma tela branca.
const FOG_COLOR = new THREE.Color(0x9fbacf);
scene.fog = new THREE.Fog(FOG_COLOR, CFG.VIEW_DIST * 0.5, CFG.VIEW_DIST);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, CFG.VIEW_DIST + 600);
camera.position.set(0, 3, 8);

// Touch Controls para Android + mobile detection
const touchControls = new TouchControls(camera, canvas);
if (touchControls.isTouchDevice || isMobileDevice() || isSmallScreen()) {
  touchControls.enable();
  // Esconde touch controls até o jogo começar (overlay do menu tem z-index 100, touch tem 10000)
  if (touchControls._container) touchControls._container.style.display = 'none';
  if (touchControls._editOverlay) touchControls._editOverlay.style.display = 'none';
  // Mostra botão "EDITAR HUD" nas configurações (apenas mobile/touch)
  const editHudBtn = document.getElementById('btnEditHud');
  if (editHudBtn) {
    editHudBtn.style.display = '';
    editHudBtn.addEventListener('click', () => {
      touchControls.toggleEditMode();
    });
  }
}
window.__touch = touchControls;

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
    'gl_FragColor = vec4( texColor / ( 1.0 + 1.05 * texColor ), 1.0 );'
  );
}

/* ---- luzes ---- */
const hemiLight = new THREE.HemisphereLight(0xa9cdf2, 0x687a4d, 0.42);
scene.add(hemiLight);
const ambLight = new THREE.AmbientLight(0xffffff, 0.16);
scene.add(ambLight);

// Cascaded Shadow Maps — 3 cascatas para sombra nítida perto e barata longe
const csm = new CSM({
  maxFar: CFG.CSM_MAX_FAR,
  cascades: 3,
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
// SMAA é pesado no mobile — desabilita para ganhar FPS
const isMobile = isMobileDevice() || isSmallScreen();
if (!isMobile) {
  const smaaPass = new SMAAPass(window.innerWidth * renderer.getPixelRatio(), window.innerHeight * renderer.getPixelRatio());
  composer.addPass(smaaPass);
}
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
  hfBody.updateAABB();
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
const Water = createWater({ CFG, WATER_LEVEL, scene, sunDir });

/* ================================================================
   GRAMA REATIVA — InstancedMesh em chunks que acompanham o player.
   Vento no vertex shader + dobra quando player/carro passam.
   ================================================================ */
const Grass = createGrass({ CFG, rand, TAU, heightAt, biomeAt, WATER_LEVEL, simplex, scene, sunDir, CITY });

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

const Structures = createStructures({ clamp, rand, TAU, heightAt, slopeAt, platforms, WATER_LEVEL, CITY, scene, csmMat, paintGeometry });
const CityModel = createCityModel({ scene, renderer, Structures, CITY, heightAt, slopeAt });

/* paredes das construções também são sólidas pra física dos veículos —
   sem isso carro/caminhão atravessavam prédios, fortes e muros */
for (const b of Structures.walls) {
  if (b.noCollide) continue;
  const hx = (b.x1 - b.x0) / 2, hy = (b.y1 - b.y0) / 2, hz = (b.z1 - b.z0) / 2;
  if (hx < 0.04 || hy < 0.04 || hz < 0.04) continue;
  const wb = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)) });
  wb.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
  wb.updateAABB(); // CANNON calcula o AABB na criação (origem) e nunca mais — sem isto o broadphase não enxerga o corpo
  world.addBody(wb);
  if (b.city) Structures.city.registerBody(wb); // destruição da cidade remove estes
}
Structures.city.bindPhysics(world);

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
    body.updateAABB(); // idem paredes: AABB ficava na origem
    world.addBody(body);
  }
}

/* re-balanceia LOD por distância (perto = detalhada, longe = barata) */
const TREE_LOD_DIST = 70;
const _dummy = new THREE.Object3D();
let treeVariantMeshes = null; // [InstancedMesh] quando os GLBs chegam
function rebucketTrees(px, pz) {
  let lo = 0;
  if (treeVariantMeshes) {
    const counts = treeVariantMeshes.map(() => 0);
    for (const t of treeSpots) {
      _dummy.position.set(t.x, t.y - 0.15, t.z);
      _dummy.rotation.set(0, t.rot, 0);
      _dummy.scale.setScalar(t.s);
      _dummy.updateMatrix();
      const d = Math.hypot(t.x - px, t.z - pz);
      if (d < TREE_LOD_DIST) {
        const m = treeVariantMeshes[t.variant || 0];
        m.setColorAt(counts[t.variant || 0], _c.setHex(t.tint));
        m.setMatrixAt(counts[t.variant || 0]++, _dummy.matrix);
      } else if (d < CFG.VIEW_DIST) { treeLoMesh.setColorAt(lo, _c.setHex(t.tint)); treeLoMesh.setMatrixAt(lo++, _dummy.matrix); }
    }
    treeVariantMeshes.forEach((m, i) => {
      m.count = counts[i];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
  } else {
    let hi = 0;
    for (const t of treeSpots) {
      _dummy.position.set(t.x, t.y - 0.15, t.z);
      _dummy.rotation.set(0, t.rot, 0);
      _dummy.scale.setScalar(t.s);
      _dummy.updateMatrix();
      const d = Math.hypot(t.x - px, t.z - pz);
      if (d < TREE_LOD_DIST) { treeHiMesh.setColorAt(hi, _c.setHex(t.tint)); treeHiMesh.setMatrixAt(hi++, _dummy.matrix); }
      else if (d < CFG.VIEW_DIST) { treeLoMesh.setColorAt(lo, _c.setHex(t.tint)); treeLoMesh.setMatrixAt(lo++, _dummy.matrix); }
    }
    treeHiMesh.count = hi;
    treeHiMesh.instanceMatrix.needsUpdate = true;
    if (treeHiMesh.instanceColor) treeHiMesh.instanceColor.needsUpdate = true;
  }
  treeLoMesh.count = lo;
  treeLoMesh.instanceMatrix.needsUpdate = true;
  if (treeLoMesh.instanceColor) treeLoMesh.instanceColor.needsUpdate = true;
}

/* ---- cenário 3D dos assets: árvores reais instanciadas + pontos de interesse ---- */
const Scenery = createScenery();
(async () => {
  try {
    // três famílias de árvore (a "assets" é um bosquete inteiro por instância)
    const geos = await Promise.all([
      Scenery.bakedGeometry('./assets/models/Cenários/giant_low_poly_tree.glb', { height: 12 }),
      Scenery.bakedGeometry('./assets/models/Cenários/low_poly_tree_with_twisting_branches.glb', { height: 8.5 }),
      Scenery.bakedGeometry('./assets/models/Cenários/low_poly__tree_assets.glb', { height: 7 }),
      Scenery.bakedGeometry('./assets/models/Cenários/low_poly_tree_log_and_stump.glb', { height: 1.3 }),
    ]);
    treeVariantMeshes = geos.map(g => {
      const m = new THREE.InstancedMesh(g, treeMat, CFG.TREE_COUNT);
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false;
      scene.add(m);
      return m;
    });
    treeHiMesh.count = 0;
    treeHiMesh.visible = false;
    for (let i = 0; i < treeSpots.length; i++) {
      const t = treeSpots[i];
      const bio = biomeAt(t.x, t.z);
      // campo: retorcidas; floresta: bosquetes densos; 8% tocos;
      // a "giant tree" é uma ILHA FLUTUANTE com bonsai — vira marco raro (1/40)
      t.variant = (i % 40 === 0 && bio > 0.3) ? 0
        : (i % 12 === 0) ? 3
          : bio > 0.34 ? (i % 2 ? 1 : 2) : (i % 3 === 0 ? 2 : 1);
      // escala pelo índice (sem rand(): este bloco roda em timing assíncrono e
      // o stream semeado precisa ficar idêntico entre os clientes)
      if (t.variant === 3) t.s = 0.8 + (i % 5) * 0.1;  // toco não vira arbusto gigante
      if (t.variant === 0) t.s = 1.2 + (i % 5) * 0.1;  // ilha flutuante imponente
    }
    rebucketTrees(player.pos.x, player.pos.z);
  } catch (err) { console.error('Árvores GLB falharam — mantendo procedurais:', err); }
})();

/* pontos de interesse novos: MERCADO na beira da cidade, REFÚGIO NA ÁRVORE na
   floresta e barris espalhados — com colisão (player + veículos) e, por serem
   sites, os baús do Battle Royale nascem neles automaticamente.
   RNG PRÓPRIO e determinístico: este bloco roda depois do load assíncrono dos
   GLBs — se usasse o rand() semeado global, cada cliente consumiria a sequência
   num ponto diferente (timing de rede) e o refúgio nasceria em lugares
   DIFERENTES pra cada jogador, quebrando o mundo compartilhado */
(async () => {
  let poiSeed = ((window.__MP_init && window.__MP_init.worldSeed) >>> 0 || 424242) ^ 0xBEEF;
  const poiRand = (a = 1, b) => {
    poiSeed = (poiSeed + 0x6D2B79F5) | 0;
    let x = Math.imul(poiSeed ^ (poiSeed >>> 15), 1 | poiSeed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    const r = ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    return b === undefined ? r * a : a + r * (b - a);
  };
  const placeProp = (p, x, z, ry) => {
    p.root.position.set(x, heightAt(x, z), z);
    p.root.rotation.y = ry || 0;
    scene.add(p.root);
    const hx = p.size.x / 2 * 0.72, hy = p.size.y / 2, hz = p.size.z / 2 * 0.72;
    const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)) });
    body.position.set(x, heightAt(x, z) + hy, z);
    body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), ry || 0);
    body.updateAABB();
    world.addBody(body);
    addObstacle(x, z, Math.max(hx, hz) * 0.9); // player não atravessa
  };
  try {
    const cidade = Structures.sites.find(s => s.type === 'cidade');
    const mx = cidade ? cidade.x + cidade.r + 16 : 60, mz = cidade ? cidade.z - 18 : 60;
    const mercado = await Scenery.prop('./assets/models/Cenários/mercado.glb', { height: 7 });
    placeProp(mercado, mx, mz, 0.4);
    Structures.sites.push({ x: mx, z: mz, r: Math.max(mercado.size.x, mercado.size.z) / 2 + 3, type: 'mercado' });

    // refúgio na árvore: primeiro canto de floresta plano que achar
    let tx = 0, tz = 0;
    for (let i = 0; i < 300; i++) {
      const a = poiRand(TAU), r = poiRand(150, 420);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (biomeAt(x, z) > 0.4 && slopeAt(x, z) < 0.3 && heightAt(x, z) > WATER_LEVEL + 1.5 &&
          !Structures.sites.some(s => Math.hypot(x - s.x, z - s.z) < s.r + 20)) { tx = x; tz = z; break; }
    }
    if (tx || tz) {
      const casa = await Scenery.prop('./assets/models/Cenários/low_poly_tree_house.glb', { height: 13 });
      placeProp(casa, tx, tz, poiRand(TAU));
      Structures.sites.push({ x: tx, z: tz, r: Math.max(casa.size.x, casa.size.z) / 2 + 3, type: 'refúgio' });
    }

    // barris de madeira: cobertura leve perto dos POIs novos
    const barril = await Scenery.prop('./assets/models/Cenários/wooden_barrel.glb', { height: 1.05 });
    const spots = [[mx + 5, mz + 4], [mx - 6, mz + 2], [mx + 3, mz - 6],
      [tx + 4, tz + 2], [tx - 3, tz - 4], [tx + 2, tz - 5]];
    for (const [bx, bz] of spots) {
      if (!bx && !bz) continue;
      const b = barril.root.clone(true);
      b.position.set(bx, heightAt(bx, bz), bz);
      b.rotation.y = poiRand(TAU);
      scene.add(b);
      addObstacle(bx, bz, 0.55);
    }
    // tira árvores que nasceram dentro dos POIs novos e refaz o LOD
    for (let i = treeSpots.length - 1; i >= 0; i--) {
      const t = treeSpots[i];
      for (const s of Structures.sites) {
        if ((s.type === 'mercado' || s.type === 'refúgio') && Math.hypot(t.x - s.x, t.z - s.z) < s.r + 2) {
          treeSpots.splice(i, 1);
          break;
        }
      }
    }
    rebucketTrees(player.pos.x, player.pos.z);
  } catch (err) { console.error('POIs GLB falharam — mundo segue como era:', err); }
})();

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
      body.updateAABB(); // idem paredes: AABB ficava na origem
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
function muzzleFlash(scale = 1, color = 0xffd9a0) {
  muzzleT = 0.05;
  muzzleMatFlash.color.setHex(color);
  muzzleLight.color.setHex(color);
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
  cinematic: false, // destruição da cidade: timeline assume a câmera/input
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
  // lock funcionou: ESC volta a pausar normalmente (partida iniciada via
  // socket nasce com lockFailed=true e deixava o ESC num limbo sem menu)
  state.lockFailed = false;
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
  // display síncrono: a transição de opacity trava junto com o hitch da
  // geração da partida e o menu ficava na tela por cima do jogo
  ui.overlay.style.display = p ? 'flex' : 'none';
  ui.hud.classList.toggle('on', !p);
  // Esconde touch controls quando o menu está visível (z-index 10000 bloqueava cliques)
  if (window.__touch && window.__touch._container) {
    window.__touch._container.style.display = p ? 'none' : '';
    // Edit overlay só aparece quando edit mode está ativo
    if (window.__touch._editOverlay && !window.__touch._editMode) {
      window.__touch._editOverlay.style.display = 'none';
    }
  }
  // Mostra/esconde título "PAUSADO", botão "RESUMIR" e "ENCERRAR PARTIDA"
  const pauseTitle = document.getElementById('pauseTitle');
  const btnResume = document.getElementById('btnResume');
  const btnEndGame = document.getElementById('btnEndGame');
  if (pauseTitle) pauseTitle.style.display = (p && state.started) ? '' : 'none';
  if (btnResume) btnResume.style.display = (p && state.started) ? '' : 'none';
  if (btnEndGame) btnEndGame.style.display = (p && state.started) ? '' : 'none';
  // Pausa inimigos no modo offline (não BR)
  if (window.__Enemies && !window.__BR_active) {
    window.__Enemies.paused = p;
  }
}
window.__setPaused = setPaused;

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
  shotSeq: 0, // contador de ações para animar disparos remotos mesmo em pacote volatile
  landDip: 0, landDipVel: 0,
  stepAcc: 0,
  slideT: -1, slideDir: new THREE.Vector3(),
  healPool: 0, invulnUntil: 0,
  armor: 0, armorMax: 50, // escudo azul (recompensa do COLOSSO)
};
const WALK_SPEED = 5.2, RUN_SPEED = 8.6, CROUCH_SPEED = 2.6, ADS_SPEED = 3.4;
const GRAVITY = 22, JUMP_VEL = 8.4;

/* modelos 3D reais: armas GLB nas mãos + corpo rigado em primeira pessoa
   (as âncoras procedurais viram alvos de IK — coreografia de recarga intacta) */
const WeaponModels = createWeaponModels({ arsenal });
const FpBody = createFpBody({ camera, player, state, getGun: () => gun, weaponRoot, arsenal });

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
  const usingTouch = window.__touch && window.__touch.enabled;
  const sprintHeld = usingTouch ? (window.__touch.moveY > 0.5 && Math.abs(window.__touch.moveX) < 0.3) : (keys['ShiftLeft'] || keys['ShiftRight']);
  const crouchHeld = usingTouch ? window.__touch.crouch : (keys['ControlLeft'] || keys['ControlRight']);
  const fwd = usingTouch ? window.__touch.moveY : ((keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0));
  const str = usingTouch ? window.__touch.moveX : ((keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0));

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
  if (!window.__TRAINING_active) {
    for (const o of obstaclesNear(player.pos.x, player.pos.z)) {
      const dx = player.pos.x - o.x, dz = player.pos.z - o.z;
      const d = Math.hypot(dx, dz), min = o.r + player.radius;
      if (d < min && d > 1e-4) {
        player.pos.x = o.x + dx / d * min;
        player.pos.z = o.z + dz / d * min;
      }
    }
    Structures.collide(player.pos, player.radius, 1.7); // paredes das construções
  }
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

  // Machado nao tem ADS: manter a pose de quadril evita separar as duas maos
  // e jogar o cabo contra a camera quando o botao direito e pressionado.
  adsT = damp(adsT, (mouse.aiming && !state.driving && !gun.melee) ? 1 : 0, 13, dt);
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
  // hip um tico mais alto/perto: as MÃOS do rig entram no quadro (ADS intacto)
  _v3.copy(gun.hipV); _v3.y += 0.05; _v3.z += 0.06;
  weaponRoot.position.lerpVectors(_v3, gun.adsV, ads);
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

  // ciclo pós-tiro (bomba / ferrolho / golpe corpo-a-corpo)
  gun.cycleT = Math.max(0, gun.cycleT - dt);
  if (gun.parts.pump && !gun.reloading) {
    const pumpDuration = gun.cycleDuration || 0.55;
    const ph = gun.cycleT > 0 ? Math.sin((1 - gun.cycleT / pumpDuration) * Math.PI) : 0;
    gun.parts.pump.position.z = gun.parts.pump.userData.z0 + ph * 0.09;
  }
  const boltDuration = gun.cycleDuration || 0.32;
  const boltPhase = gun.cycleT > 0 ? Math.sin((1 - gun.cycleT / boltDuration) * Math.PI) : 0;
  if (gun.parts.bolt) {
    gun.parts.bolt.position.z = gun.parts.bolt.userData.z0 + (boltPhase + boltK) * 0.05;
  }
  if (gun.parts.boltVisual) {
    const bv = gun.parts.boltVisual;
    bv.position.z = bv.userData.z0 + (boltPhase + boltK) * bv.userData.travel;
    bv.rotation.x = boltPhase * 0.42;
  }
  if (gun.boltAction && gun.boltSoundPending && gun.cycleT <= boltDuration * 0.62) {
    gun.boltSoundPending = false;
    SFX.bolt();
  }
  if (gun.melee && gun.cycleT > 0) {
    const swing = Math.sin((1 - gun.cycleT / (gun.meleeDuration || 0.45)) * Math.PI);
    weaponRoot.rotation.x += swing * 0.48;
    weaponRoot.rotation.y -= swing * 0.2;
    weaponRoot.rotation.z -= swing * 0.92;
    weaponRoot.position.x -= swing * 0.15;
    weaponRoot.position.y += swing * 0.08;
  }

  weaponKick.position.z = recoil.kickZ;
  weaponKick.position.y = -slap * 0.03;
  weaponKick.rotation.x = recoil.kickRot + slap * 0.07;
  weaponRoot.visible = !state.driving && !state.flying && scopedK < 0.85; // na luneta, vê só o retículo

  // modelos GLB: animações embutidas da arma + corpo/braços rigados (IK)
  WeaponModels.update(dt);
  FpBody.update(dt, t);

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
  player.shotSeq = (player.shotSeq + 1) & 0x7fffffff;
  // machado/melee: golpe curto, sem munição/flash/som de tiro
  if (gun.melee) {
    gun.cycleT = gun.meleeDuration || 0.45;
    addTrauma(0.06);
    recoil.kickZ += 0.12; recoil.kickRot += 0.1;
    SFX.melee();
    camera.getWorldPosition(_rayOrig);
    camera.getWorldDirection(_rayDir);
    if (window.__TRAINING_melee) window.__TRAINING_melee(_rayOrig, _rayDir, gun.dmg);
    else if (window.__BR_melee) window.__BR_melee(_rayOrig, _rayDir, gun.dmg);
    return;
  }
  if (window.__TRAINING_active && window.__game && window.__game.Training)
    window.__game.Training.recordShot();
  gun.mag--;
  updateAmmoHUD();
  muzzleFlash(gun.pellets > 1 ? 1.5 : 1, gun.plasma ? 0x52ffe6 : 0xffd9a0);
  if (gun.laser) SFX.laser();
  else SFX.shot(gun.pellets > 1 ? 'shotgun' : gun.adsFov < 40 ? 'dmr' : 'rifle');
  addTrauma(0.08 + gun.kick * 1.1);
  lastShotInfo.pos.copy(player.pos);
  lastShotInfo.t = t;
  if (!gun.auto) {
    gun.cycleT = gun.cycleDuration || (gun.pellets > 1 ? 0.55 : 0.32);
    gun.boltSoundPending = !!gun.boltAction;
  }

  // bazuca: dispara foguete físico em vez de hitscan
  if (gun.rocket) {
    SFX.rocket();
    addTrauma(0.5);
    recoil.pitchVel += 2.3;
    recoil.kickZ += 0.28;
    recoil.kickRot += 0.2;
    camera.getWorldDirection(_rayDir);
    muzzle.getWorldPosition(_v3);
    Rockets.fire(_v3, _rayDir, gun.rocketSplash);
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
      if (gun.plasma) FX.spawnPlasmaBolt(_v3, _hitPos);
      else FX.spawnTracer(_v3, _hitPos, gun.laser ? 0x52ffe6 : 0xffe9a8);
    } else if (bestEnemy || bestBoss || bestExtra || bestRemote) {
      _hitPos.copy(_rayOrig).addScaledVector(_rayDir, bestT);
      FX.burst(_hitPos, _rayDir.clone().negate(), bestBoss ? 'spark' : 'blood');
      if (gun.plasma) FX.spawnPlasmaBolt(_v3, _hitPos);
      else FX.spawnTracer(_v3, _hitPos, gun.laser ? 0x52ffe6 : 0xffe9a8);
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
      if (gun.plasma) FX.spawnPlasmaBolt(_v3, _hitPos);
      else FX.spawnTracer(_v3, _hitPos, gun.laser ? 0x52ffe6 : 0xffe9a8);
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
    /* O GLB já traz sua própria óptica. As miras procedurais continuam
       servindo como fallback, mas não podem reaparecer sobre o asset ao
       apertar T; nesse caso T altera apenas ampliação/nome da mira. */
    if (s.mesh && gun.modelStatus !== 'ready') s.mesh.visible = true;
    gun.adsFov = s.fov;
    gun.adsV.set(...s.ads);
    centerMsg('Mira: ' + s.name, 1100);
    SFX.switchW();
  }
  if (state.driving || state.flying || state.paused || player.dead || window.__BR_freeze || state.cinematic) { mouse.clicked = false; return; }
  if (justPressed.has('KeyG')) Grenades.throwNade(t);
  const interval = 60 / gun.rpm;
  const want = gun.auto ? mouse.shooting : mouse.clicked;
  if (want && !gun.reloading && gun.cycleT <= 0 && switchAnim > 0.8 && t - gun.lastShot >= interval) {
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
const lastShotInfo = { pos: new THREE.Vector3(), t: -99 };
function setTimeScale(v) { timeScale = v; }
const Pickups = createPickups({ heightAt, SFX, scene, Structures, showBanner, centerMsg, getGun: () => gun, updateAmmoHUD, updateInvHUD, updateArmorHUD, player, inventory }); // criado antes: Enemies dropa loot
const Chars = createCharModels();
const Enemies = createEnemies({ CFG, clamp, lerp, damp, rand, TAU, _v1, _v2, _v3, heightAt, slopeAt, terrainNormal, WATER_LEVEL, obstaclesNear, SFX, FX, scene, csmMat, Structures, addScore, addKillFeed, player, playerDamage, addTrauma, Car, Pickups, knuckleMat, lastShotInfo, Chars });
window.__Enemies = Enemies; // Expõe para setPaused pausar inimigos

/* registro do último tiro do player (os inimigos "ouvem") */
/* alvos extras (animais, zumbis, fantasmas) e lista de bosses */
const extraTargets = [];
const Bosses = [];
const MFlags = { colosso: false, alien: false, night: false }; // marcos de missão

const Grenades = createGrenades({ clamp, rand, _v1, heightAt, groundAt, terrainNormal, SFX, FX, scene, camera, updateInvHUD, state, player, playerDamage, addTrauma, recoil, inventory, Car, Enemies, Bosses, extraTargets });



/* ================================================================
   BOSS — COLOSSO, guardião do forte (o núcleo brilhante é o ponto fraco)
   ================================================================ */
let timeScale = 1; // câmera lenta cinematográfica na morte do boss
const Boss = createBoss({ clamp, damp, rand, TAU, _v1, _v2, heightAt, SFX, FX, scene, csmMat, Structures, ui, addScore, addKillFeed, showBanner, player, playerDamage, addTrauma, Bosses, Pickups, MFlags, setTimeScale });
/* Rockets criado APOS o Boss (dependencia declarada) — só é usado em runtime */
const Rockets = createRockets({
  rand, _v1, _v2, heightAt, FX, scene, Structures, player, Enemies, Grenades,
  Boss, Bosses, extraTargets, platforms, DmgNums, showHitmarker, SFX,
});

const Env = createEnv({ CFG, clamp, lerp, damp, rand, TAU, SFX, scene, camera, renderer, csm, sky, sunDir, hemiLight, ambLight, Water, Grass, Structures, _euler });
const Clouds = createClouds({ scene, Env, worldSize: CFG.WORLD_SIZE });
const DropShip = createDropship({ scene });
const Parachute = createParachute({ scene, player });

/* ================================================================
   VIDA AMBIENTE — borboletas, pássaros, pólen, fogueira, fumaça,
   bandeiras tremulando e canto de passarinhos
   ================================================================ */
const Amb = createAmb({ rand, TAU, _v1, _v2, heightAt, biomeAt, addObstacle, SFX, FX, scene, csmMat, Structures, player });

/* ================================================================
   ANIMAIS — cervos (carne) e lobos (selvagens, mordem)
   ================================================================ */
const Animals = createAnimals({ clamp, rand, TAU, heightAt, slopeAt, WATER_LEVEL, CITY, scene, csmMat, addScore, player, playerDamage, extraTargets, Pickups });

/* ================================================================
   CRIATURAS DA NOITE — zumbis e fantasmas (somem ao amanhecer)
   ================================================================ */
const Night = createNight({ rand, TAU, heightAt, WATER_LEVEL, SFX, scene, csmMat, Structures, addScore, addKillFeed, state, player, playerDamage, extraTargets, Pickups, Env, MFlags });

/* ================================================================
   BOSS 2 — O VISITANTE (alien na cratera do deserto) -> arma PLASMA
   ================================================================ */
const Alien = createAlien({ rand, TAU, _v1, _v2, heightAt, biomeAt, WATER_LEVEL, CITY, SFX, FX, scene, csmMat, addScore, addKillFeed, showBanner, unlockWeapon, state, player, playerDamage, addTrauma, Bosses, Pickups, MFlags, setTimeScale, Chars });

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
const Interact = createInteract({ heightAt, SFX, scene, csmMat, Structures, ui, centerMsg, arsenal, unlockWeapon, updateInvHUD, state, justPressed, player, inventory, Car, Heli, tryToggleCar });

/* Campo de Tiro: sessão local e isolada, construída apenas quando escolhida. */
const Training = createTraining({
  scene, world, platforms, heightAt, player, state, camera, arsenal, inventory,
  Enemies, Alien, Boss, Animals, Night, Car, Pickups, extraTargets, ui,
  switchWeapon, updateHealthHUD, updateArmorHUD, updateAmmoHUD, updateInvHUD,
  updateSlotsHUD, showBanner, centerMsg, showHitmarker, DmgNums, SFX, FX,
  tryToggleCar, socket: __mpSocket,
});

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
    Clouds.update(dt, menuT);
    Parachute.update(dt, menuT);
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
  Clouds.update(dt, t);
  Parachute.update(dt, t);
  // ========== TOUCH CONTROLS UPDATE ==========
  if (window.__touch && window.__touch.enabled) {
    window.__touch.update(dt);
    const tc = window.__touch;
    if (tc.jump) { justPressed.add('Space'); tc.jump = false; }
    if (tc.reload) { justPressed.add('KeyR'); tc.reload = false; }
    if (tc.interact) { justPressed.add('KeyE'); tc.interact = false; }
    if (tc.grenade) { justPressed.add('KeyG'); tc.grenade = false; }
    if (tc.medkit) { justPressed.add('KeyQ'); tc.medkit = false; }
    if (tc.switchWeapon >= 0) {
      justPressed.add('Digit' + (tc.switchWeapon + 1));
      tc.switchWeapon = -1;
    }
    if (tc.inventory) { justPressed.add('Tab'); tc.inventory = false; }
    if (tc.toggleSight) { justPressed.add('KeyT'); tc.toggleSight = false; }
    mouse.aiming = tc.aim;
    if (tc.shoot) { mouse.shooting = true; mouse.clicked = true; }
    else { mouse.shooting = false; mouse.clicked = false; }
  }
  if (!state.driving && !state.flying && !window.__BR_freeze && !state.cinematic) playerUpdate(dt, t);
  shootUpdate(dt, t);
  world.step(1 / 60, dt, 3);
  Car.update(dt, t);
  Heli.update(dt, t);
  if (!window.__BR_active) Enemies.update(dt, t); // BR: sem inimigos comuns
  if (!Training.active) Animals.update(dt, t);
  if (!Training.active && (!window.__BR_active || window.__BR_zumbis)) Night.update(dt, t); // BR: zumbis só se a sala ligar
  Grenades.update(dt, t);
  Rockets.update(dt, t);
  Pickups.update(dt, t);
  if (Training.active) Alien.update(dt, t);
  else if (!window.__BR_active) { Boss.update(dt, t); Alien.update(dt, t); Missions.update(); }
  Training.update(dt, t);
  Interact.update(dt, t);
  FX.update(dt);
  Amb.update(dt, t);
  Water.update(t);

  /* áudio de clima (chuva) */
  SFX.musicUpdate();

  /* câmera + arma + HUD dinâmico (a cinemática assume a câmera sozinha) */
  if (!state.cinematic) {
    applyFpsCamera(dt, t);
    carCameraUpdate(dt);
    if (typeof window.__BR_cameraOverride === 'function') window.__BR_cameraOverride(camera, dt, t);
  }
  if (window.__CityDestruction) window.__CityDestruction.tick(dt);

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
  // banner de boas-vindas é do modo solo; no BR o lobby já anuncia a partida
  setTimeout(() => { if (!window.__BR_active) showBanner('CALL OF AI<small>siga as missões · cuidado com a noite</small>', 5200); }, 700);
  setPaused(false);
  // Fullscreen automático no mobile
  if ((isMobileDevice() || isSmallScreen()) && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
  // Pointer lock NÃO funciona no mobile — pula direto para evitar loop lock/unlock
  const isTouch = window.__touch && window.__touch.enabled;
  if (trusted && !isTouch && !isMobileDevice()) {
    try { controls.lock(); } catch (err) { state.lockFailed = true; }
  } else {
    state.lockFailed = true;
  }
  history.pushState({ screen: 'game' }, '');
}
function startTraining(trusted) {
  if (Training.active) return;
  SFX.init(); SFX.resume(); SFX.musicStart(); SFX.setVolumes();
  state.started = true;
  Training.enter();
  setPaused(false);
  // Fullscreen automático no mobile
  if ((isMobileDevice() || isSmallScreen()) && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
  // Pointer lock NÃO funciona no mobile
  const isTouch = window.__touch && window.__touch.enabled;
  if (trusted && !isTouch && !isMobileDevice()) {
    try { controls.lock(); } catch (err) { state.lockFailed = true; }
  } else {
    state.lockFailed = true;
  }
  history.pushState({ screen: 'game' }, '');
}
/* ---- menu: botões + configurações ---- */
// Botão RESUMIR (só aparece quando pausado)
$('btnResume').addEventListener('click', e => {
  e.stopPropagation();
  SFX.resume();
  setPaused(false);
  const isTouch = window.__touch && window.__touch.enabled;
  if (!isTouch && !isMobileDevice()) { try { controls.lock(); } catch (err) { state.lockFailed = true; } }
  else { state.lockFailed = true; }
});

// Função de confirmação para novo jogo/modo quando pausado
function confirmAction(action) {
  if (state.started && state.paused) {
    if (confirm('Tem certeza que deseja sair? O progresso não salvo será perdido.')) {
      action();
    }
  } else {
    action();
  }
}

$('btnNew').addEventListener('click', e => {
  e.stopPropagation();
  if (__mpSocket) return; // sala online: o lobby BR assume — nada de solo por cima
  confirmAction(() => startGame(e.isTrusted));
});
$('btnTraining').addEventListener('click', e => {
  e.stopPropagation();
  confirmAction(() => startTraining(e.isTrusted));
});
$('btnExitTraining').addEventListener('click', e => {
  e.stopPropagation();
  Training.exitToMenu();
});

// Botão ENCERRAR PARTIDA - volta ao menu principal
$('btnEndGame').addEventListener('click', e => {
  e.stopPropagation();
  if (confirm('Tem certeza que deseja encerrar a partida? Todo o progresso será perdido.')) {
    // Volta ao menu principal
    state.started = false;
    state.paused = false;
    setPaused(false);
    ui.overlay.style.display = 'flex';
    ui.overlay.classList.remove('paused');
    // Esconde botão de pausa e resume
    const pauseTitle = document.getElementById('pauseTitle');
    const btnResume = document.getElementById('btnResume');
    const btnEndGame = document.getElementById('btnEndGame');
    if (pauseTitle) pauseTitle.style.display = 'none';
    if (btnResume) btnResume.style.display = 'none';
    if (btnEndGame) btnEndGame.style.display = 'none';
    // Sai do fullscreen se estiver
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    history.pushState({ screen: 'menu' }, '');
  }
});
if (__mpSocket) { // multiplayer no ar: o botão vira aviso até o lobby abrir
  $('btnNew').classList.add('disabled');
  $('btnNew').textContent = '🌐 SALA ONLINE — ABRINDO LOBBY...';
}
$('btnSettings').addEventListener('click', e => { e.stopPropagation(); $('settings').classList.add('open'); });
$('btnBack').addEventListener('click', e => { e.stopPropagation(); $('settings').classList.remove('open'); });
$('settings').addEventListener('click', e => e.stopPropagation());
{ // bindings das configurações (aplicam ao vivo + persistem)
  const sv = $('setVol'), sp2 = $('setPerf'), sr = $('setRes'), sg = $('setGrass'), ss = $('setShadow'), sb = $('setBloom'), sp = $('setPing');
  sv.value = SETTINGS.vol * 100;
  sp2.value = String(SETTINGS.perf); sr.value = String(SETTINGS.res); sg.value = String(SETTINGS.grass); ss.value = String(SETTINGS.shadow); sb.value = String(SETTINGS.bloom);
  sp.value = String(SETTINGS.ping === 0 ? 0 : 1);
  sv.oninput = () => { SETTINGS.vol = sv.value / 100; SFX.setVolumes(); persistSettings(); };
  sp2.onchange = () => {
    SETTINGS.perf = +sp2.value;
    if (SETTINGS.perf === 0) {
      // Modo Desempenho: desliga CSM, environment, bloom
      csm.enabled = false;
      scene.environment = null;
      bloomPass.enabled = false;
      renderer.shadowMap.enabled = false;
    } else {
      // Modo Qualidade: reabilita tudo
      csm.enabled = true;
      csmMaterials.forEach(m => csm.setupMaterial(m));
      bloomPass.enabled = SETTINGS.bloom === 1;
      renderer.shadowMap.enabled = SETTINGS.shadow === 1;
    }
    csmMaterials.forEach(m => m.needsUpdate = true);
    persistSettings();
  };
  sr.onchange = () => { SETTINGS.res = +sr.value; renderer.setPixelRatio(Math.min(devicePixelRatio, SETTINGS.res)); composer.setSize(window.innerWidth, window.innerHeight); persistSettings(); };
  sg.onchange = () => {
    SETTINGS.grass = +sg.value;
    Grass.setDensity(SETTINGS.grass);
    persistSettings();
  };
  ss.onchange = () => { SETTINGS.shadow = +ss.value; renderer.shadowMap.enabled = SETTINGS.shadow === 1 && SETTINGS.perf === 1; csmMaterials.forEach(m => m.needsUpdate = true); persistSettings(); };
  sb.onchange = () => { SETTINGS.bloom = +sb.value; bloomPass.enabled = SETTINGS.bloom === 1 && SETTINGS.perf === 1; persistSettings(); };
  sp.onchange = () => { SETTINGS.ping = +sp.value; persistSettings(); };
  // Aplica ao iniciar
  Grass.setDensity(SETTINGS.grass);
  if (SETTINGS.perf === 0) {
    csm.enabled = false;
    scene.environment = null;
    bloomPass.enabled = false;
    renderer.shadowMap.enabled = false;
  }
}
ui.overlay.addEventListener('click', (e) => {
  if (e.target.closest('#menuBtns') || e.target.closest('#settings')) return;
  if (state.started && state.paused) { // clique retoma quando pausado
    SFX.resume();
    setPaused(false);
    // No mobile, não tenta pointer lock
    const isTouch = window.__touch && window.__touch.enabled;
    if (e.isTrusted && !isTouch && !isMobileDevice()) { try { controls.lock(); } catch (err) { state.lockFailed = true; } }
    else { state.lockFailed = true; }
  }
});

/* ---- Pré-init de áudio no primeiro toque/clique no overlay (reduz travada ao iniciar) ---- */
{
  let audioPreInited = false;
  const preInitAudio = () => {
    if (audioPreInited) return;
    audioPreInited = true;
    try { SFX.init(); SFX.resume(); } catch (e) {}
  };
  ui.overlay.addEventListener('touchstart', preInitAudio, { once: true, passive: true });
  ui.overlay.addEventListener('mousedown', preInitAudio, { once: true });
}

/* ---- Mobile: resume áudio em QUALQUER toque (iOS requer interação) ---- */
if (isMobileDevice() || isSmallScreen()) {
  document.addEventListener('touchstart', () => {
    try { SFX.resume(); } catch (e) {}
  }, { passive: true });
}

/* ---- Botão voltar do mobile: navega menus e pausa o jogo ---- */
window.addEventListener('popstate', () => {
  const settingsEl = $('settings');
  // Configurações abertas: fecha
  if (settingsEl && settingsEl.classList.contains('open')) {
    settingsEl.classList.remove('open');
    history.pushState({ screen: 'menu' }, '');
    return;
  }
  // Jogo em andamento: pausa e volta ao menu
  if (state.started && !state.paused) {
    setPaused(true);
    if (document.pointerLockElement) document.exitPointerLock();
    // Sai do fullscreen se estiver
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    history.pushState({ screen: 'paused' }, '');
    return;
  }
  // Jogo pausado: volta ao menu principal
  if (state.started && state.paused) {
    // Volta ao menu (reset do jogo seria complexo, apenas mantém pausado)
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    return;
  }
});
// Empilha estado inicial para o botão voltar funcionar no menu
history.pushState({ screen: 'menu' }, '');

/* ---- Fullscreen: se sair, reentra na próxima interação (mobile) ---- */
let __fullscreenLost = false;
if (isMobileDevice() || isSmallScreen()) {
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && state.started) {
      __fullscreenLost = true;
    }
  });
  // Na próxima interação com a tela, reentra no fullscreen
  const reenterFullscreen = () => {
    if (__fullscreenLost && state.started && !state.paused) {
      __fullscreenLost = false;
      if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    }
  };
  document.addEventListener('touchstart', reenterFullscreen, { passive: true });
  document.addEventListener('click', reenterFullscreen, { passive: true });
}

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
  state, player, Car, Heli, Chars, Enemies, arsenal, Boss, Alien, Bosses, Grenades, Rockets, Pickups, Structures, Grass,
  inventory, keys, mouse, camera, Env, Missions, Interact, Animals, Night, MFlags,
  WeaponModels, FpBody, CityModel, Clouds, DropShip, Parachute,
  switchWeapon, unlockWeapon, startGame, tryToggleCar,
  get gun() { return gun; },
  get fps() { return fpsVal; },
  get errors() { return __errors; },
  tick, // passo manual do loop (testes/depuração): __game.tick(1/60)
  heightAt, biomeAt, groundAt, obstaclesNear,
  forceStart() { startGame(false); },
  teleportToCar() {
    player.pos.set(Car.group.position.x + 3, heightAt(Car.group.position.x + 3, Car.group.position.z), Car.group.position.z);
  },
};
window.__game.Training = Training;
window.__game.startTraining = startTraining;

/* Hooks pequenos para playtest automatizado e acessibilidade por estado textual. */
window.advanceTime = ms => {
  const steps = Math.max(1, Math.round(Math.max(0, Number(ms) || 0) / (1000 / 60)));
  for (let i = 0; i < steps; i++) tick(1 / 60);
};
window.render_game_to_text = () => {
  const br = window.__BR_debug;
  const visibleCrates = br ? br.crates.filter(c => !c.opened)
    .sort((a, b) => Math.hypot(player.pos.x - a.x, player.pos.z - a.z) - Math.hypot(player.pos.x - b.x, player.pos.z - b.z))
    .slice(0, 8).map(c => ({ key: c.key, x: +c.x.toFixed(1), z: +c.z.toFixed(1) })) : [];
  return JSON.stringify({
    coordinates: 'origin=center; +x=east; +y=up; +z=south',
    mode: Training.active ? 'TRAINING'
      : window.__BR_active ? (br ? br.S.phase : 'BR_LOADING') : (state.started ? (state.paused ? 'PAUSED' : 'SOLO') : 'MENU'),
    player: {
      x: +player.pos.x.toFixed(2), y: +player.pos.y.toFixed(2), z: +player.pos.z.toFixed(2),
      health: +player.health.toFixed(1), armor: +player.armor.toFixed(1), dead: player.dead,
      driving: state.driving, flying: state.flying,
    },
    vehicles: Car.vehicles.map((v, i) => ({
      id: i, type: v.cfg.name, model: v.modelStatus,
      x: +v.group.position.x.toFixed(1), y: +v.group.position.y.toFixed(1), z: +v.group.position.z.toFixed(1),
    })),
    unopenedCrates: visibleCrates,
    training: Training.active ? Training.debugState() : null,
  });
};

/* MULTIPLAYER: referências pro multiplayer-client.js (aditivo) */
window.__MP = {
  THREE, scene, camera, renderer, composer, player, state, CFG,
  heightAt, groundAt, addKillFeed, showHitmarker, playerDamage,
  updateHealthHUD, updateArmorHUD, updateAmmoHUD, updateInvHUD, updateSlotsHUD,
  setTimeScale,
  FX, DmgNums, SFX, rayBlockedAt, weaponRoot, centerMsg, showBanner,
  WATER_LEVEL, slopeAt, justPressed, world,
  socket: __mpSocket, spawn: __mpSpawn,
};

buildHeightGrid(CFG.WORLD_SIZE); // PERF: consultas de altura via grade bilinear daqui em diante
rebucketTrees(0, 0);
animate();
