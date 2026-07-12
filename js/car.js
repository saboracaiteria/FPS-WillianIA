import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export function createCar(deps) {
  const { damp, rand, _v1, _v2, heightAt, SFX, FX, scene, world, csmMat, Structures, ui, state, keys } = deps;
  const DRIVE_SIGN = 1; // sinal do engineForce p/ andar pra frente (validado em teste)
  const _cv1 = new CANNON.Vec3();
  const modelLoader = new GLTFLoader();
  const modelCache = new Map();
  /* ---- fábrica de veículos (RaycastVehicle) ---- */
  function createPhysics(cfg, x, z) {
    const chassisBody = new CANNON.Body({
      mass: cfg.mass,
      shape: new CANNON.Box(new CANNON.Vec3(...cfg.half)),
      // nasce já assentado (cair de alto capotava os carros baixos)
      position: new CANNON.Vec3(x, heightAt(x, z) + cfg.wheelR + cfg.half[1] + 0.32, z),
    });
    chassisBody.angularDamping = 0.42;
    chassisBody.linearDamping = 0.02;
    // PERF: carro parado dorme (o solver pula o corpo); acorda ao entrar/colidir
    chassisBody.allowSleep = true;
    chassisBody.sleepSpeedLimit = 0.4;
    chassisBody.sleepTimeLimit = 1.2;
    const vehicle = new CANNON.RaycastVehicle({ chassisBody, indexRightAxis: 2, indexForwardAxis: 0, indexUpAxis: 1 });
    for (const [wx, wy, wz] of cfg.wheels) {
      vehicle.addWheel({
        radius: cfg.wheelR,
        directionLocal: new CANNON.Vec3(0, -1, 0),
        suspensionStiffness: 30,
        suspensionRestLength: 0.3,
        frictionSlip: cfg.grip || 1.4,
        dampingRelaxation: 2.3,
        dampingCompression: 4.4,
        maxSuspensionForce: 100000,
        rollInfluence: 0.01,
        axleLocal: new CANNON.Vec3(0, 0, 1),
        chassisConnectionPointLocal: new CANNON.Vec3(wx, wy, wz),
        maxSuspensionTravel: 0.3,
        customSlidingRotationalSpeed: -30,
        useCustomSlidingRotationalSpeed: true,
      });
    }
    vehicle.addToWorld(world);
    return { chassisBody, vehicle };
  }

  /* Proxies sem geometria: preservam suspensão/poeira sem duplicar as rodas dos GLBs. */
  function makeWheelProxies(n = 4) {
    const ws = [];
    for (let i = 0; i < n; i++) {
      const w = new THREE.Object3D();
      scene.add(w);
      ws.push(w);
    }
    return ws;
  }

  // Visual barato enquanto o GLB chega (e fallback se houver erro de rede).
  function buildPlaceholder(half, color) {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(half[0] * 2, half[1] * 2, half[2] * 2),
      csmMat(new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.5 })),
    );
    mesh.castShadow = true;
    group.add(mesh);
    scene.add(group);
    return group;
  }

  function cachedModel(url) {
    if (!modelCache.has(url)) modelCache.set(url, modelLoader.loadAsync(url).then(gltf => gltf.scene));
    return modelCache.get(url);
  }

  function removeAuxiliaryNodes(root) {
    const remove = [];
    root.traverse(obj => {
      if (/^floor$/i.test(obj.name)) remove.push(obj);
    });
    for (const obj of remove) if (obj.parent) obj.parent.remove(obj);
  }

  function normalizedModel(source, cfg) {
    const imported = source.clone(true);
    removeAuxiliaryNodes(imported);
    imported.traverse(obj => {
      if (!obj.isMesh) return;
      // pintura fosca nos materiais sem textura: com o sol do deserto + bloom,
      // lataria clara e lisa estourava num clarão branco
      for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) {
        if (m && m.isMeshStandardMaterial && !m.map) {
          m.roughness = 0.85; m.metalness = 0.05;
          // albedo 1.0 sob o sol estoura o limiar do bloom (carro vira clarão):
          // rebaixa só os tons quase-brancos pra um branco de tinta
          const l = m.color.r * 0.299 + m.color.g * 0.587 + m.color.b * 0.114;
          if (l > 0.72) m.color.multiplyScalar(0.72 / l);
        }
      }
      // cor por veículo SÓ na lataria (material nomeado no cfg): o clone é
      // obrigatório — o GLB fica em cache e é compartilhado entre os carros
      if (cfg.bodyTint != null && obj.material && obj.material.name === cfg.bodyMaterial) {
        obj.material = obj.material.clone();
        obj.material.color.setHex(cfg.bodyTint);
      }
      obj.castShadow = false; // CSM tem 4 cascatas: sombra por submalha quadruplicaria draw calls.
      obj.receiveShadow = false;
      obj.userData.importedCarModel = true;
    });

    // O jogo usa +X como frente. Alguns Sketchfab vêm com o comprimento em Z.
    const oriented = new THREE.Group();
    oriented.rotation.y = cfg.modelYaw || 0;
    oriented.add(imported);
    oriented.updateMatrixWorld(true);
    const raw = new THREE.Box3().setFromObject(oriented);
    const rawSize = raw.getSize(new THREE.Vector3());
    if (rawSize.x < 1e-4 || rawSize.y < 1e-4 || rawSize.z < 1e-4)
      throw new Error(`Modelo de veículo sem volume: ${cfg.modelUrl}`);

    // X/Z acompanham exatamente o collider; Y preserva a proporção longitudinal.
    const targetX = cfg.half[0] * 2 * 0.98;
    const targetZ = cfg.half[2] * 2 * 0.98;
    const scaled = new THREE.Group();
    scaled.scale.set(targetX / rawSize.x, targetX / rawSize.x, targetZ / rawSize.z);
    scaled.add(oriented);
    scaled.updateMatrixWorld(true);

    let box = new THREE.Box3().setFromObject(scaled);
    const groundOffset = -(cfg.wheelR + cfg.half[1] + 0.32);
    scaled.position.set(
      -(box.min.x + box.max.x) * 0.5,
      groundOffset - box.min.y,
      -(box.min.z + box.max.z) * 0.5,
    );
    scaled.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(scaled);
    const size = box.getSize(new THREE.Vector3());
    return {
      root: scaled,
      metrics: { sizeX: size.x, sizeY: size.y, sizeZ: size.z, minY: box.min.y, maxY: box.max.y },
    };
  }

  async function attachModel(v) {
    try {
      const source = await cachedModel(v.cfg.modelUrl);
      const { root, metrics } = normalizedModel(source, v.cfg);
      // Remove só o placeholder; o grupo é a identidade usada pela física/multiplayer.
      v.group.traverse(obj => { if (obj.isMesh && !obj.userData.importedCarModel) obj.geometry.dispose(); });
      v.group.clear();
      v.group.add(root);
      for (const wheel of v.wheelMeshes) wheel.visible = false; // o GLB já contém suas rodas.
      v.modelMetrics = metrics;
      v.modelRoot = root;
      v.modelAlignPending = true; // altura final vem das rodas físicas (raycast)
      v.modelStatus = 'ready';
    } catch (err) {
      v.modelStatus = 'fallback';
      v.modelError = err instanceof Error ? err.message : String(err);
      console.error(`Falha ao carregar ${v.cfg.modelUrl}:`, err);
    }
  }
  /* ---- frota ---- */
  const vehicles = [];
  function makeVehicle(cfg, x, z, ry) {
    const { chassisBody, vehicle } = createPhysics(cfg, x, z);
    if (ry) chassisBody.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), ry);
    const v = {
      cfg, chassisBody, vehicle, group: cfg.build(), wheelMeshes: makeWheelProxies(),
      steerCur: 0, lastThrottle: 0, modelStatus: 'loading', modelUrl: cfg.modelUrl, modelMetrics: null,
    };
    vehicles.push(v);
    return v;
  }
  const CFG_BUGGY = { name: 'BUGGY', mass: 280, half: [1.8, 0.38, 0.85],
    wheels: [[1.28, -0.1, 0.8], [1.28, -0.1, -0.8], [-1.28, -0.1, 0.8], [-1.28, -0.1, -0.8]],
    wheelR: 0.5, wheelW: 0.34, force: 1650, steer: 0.55, brake: 32, engine: 'normal',
    modelUrl: '/assets/models/gumball-car.optimized.glb', modelYaw: Math.PI / 2,
    build: () => buildPlaceholder([1.8, 0.38, 0.85], 0xe8562a) };
  const CFG_TRUCK = { name: 'CAMINHÃO MILITAR', mass: 680, half: [2.7, 0.55, 1.05],
    wheels: [[1.9, -0.18, 1], [1.9, -0.18, -1], [-1.7, -0.18, 1], [-1.7, -0.18, -1]],
    wheelR: 0.6, wheelW: 0.45, force: 3600, steer: 0.45, brake: 55, grip: 1.6, engine: 'truck',
    modelUrl: '/assets/models/truck-drifter.optimized.glb', modelYaw: 0,
    build: () => buildPlaceholder([2.7, 0.55, 1.05], 0x46523a) };
  const mkSport = c => ({ name: 'ESPORTIVO GT', mass: 420, half: [1.9, 0.32, 0.88],
    wheels: [[1.35, -0.02, 0.82], [1.35, -0.02, -0.82], [-1.3, -0.02, 0.82], [-1.3, -0.02, -0.82]],
    wheelR: 0.42, wheelW: 0.3, force: 5200, steer: 0.5, brake: 60, grip: 2.2, awd: true, engine: 'sport',
    modelUrl: '/assets/models/mazda-rx7.v2.glb', modelYaw: Math.PI,
    bodyTint: c, bodyMaterial: '02_-_Default', // pinta a carroceria, preserva o resto
    build: () => buildPlaceholder([1.9, 0.32, 0.88], c) });
  let cur = makeVehicle(CFG_BUGGY, 7.5, -6);
  for (const s of Structures.carSpots) {
    if (s.type === 'truck') makeVehicle(CFG_TRUCK, s.x, s.z, s.ry);
    else makeVehicle(mkSport(s.type === 'sport2' ? 0x2a6de8 : 0xd61f30), s.x, s.z, s.ry);
  }
  const ready = Promise.all(vehicles.map(attachModel));
  let dustAcc = 0;

  function update(dt, t) {
    for (const v of vehicles) {
      const driven = state.driving && v === cur && !state.paused;
      if (driven) {
        const fwdIn = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);
        const steerIn = (keys['KeyA'] ? 1 : 0) - (keys['KeyD'] ? 1 : 0); // +steer vira à esquerda
        v.steerCur = damp(v.steerCur, steerIn * v.cfg.steer, 6, dt);
        v.vehicle.setSteeringValue(v.steerCur, 0);
        v.vehicle.setSteeringValue(v.steerCur, 1);
        v.chassisBody.quaternion.vmult(new CANNON.Vec3(1, 0, 0), _cv1);
        const fwdSpeed = v.chassisBody.velocity.dot(_cv1);
        let force = 0, brake = 0;
        if (fwdIn > 0) force = v.cfg.force;
        else if (fwdIn < 0) {
          if (fwdSpeed > 2) brake = v.cfg.brake;       // freia antes de dar ré
          else force = -v.cfg.force * 0.55;
        }
        if (keys['Space']) { brake = v.cfg.brake; force = 0; } // freio de mão
        for (let i = 0; i < 4; i++) v.vehicle.setBrake(brake, i);
        if (v.cfg.awd) { // tração integral: divide a força nas 4 rodas
          for (let i = 0; i < 4; i++) v.vehicle.applyEngineForce(DRIVE_SIGN * force * 0.5, i);
        } else {
          v.vehicle.applyEngineForce(DRIVE_SIGN * force, 2);
          v.vehicle.applyEngineForce(DRIVE_SIGN * force, 3);
        }
      } else {
        for (let i = 0; i < 4; i++) { v.vehicle.setBrake(8, i); v.vehicle.applyEngineForce(0, i); }
      }
      v.group.position.copy(v.chassisBody.position);
      v.group.quaternion.copy(v.chassisBody.quaternion);
      for (let i = 0; i < 4; i++) {
        v.vehicle.updateWheelTransform(i);
        const wt = v.vehicle.wheelInfos[i].worldTransform;
        v.wheelMeshes[i].position.copy(wt.position);
        v.wheelMeshes[i].quaternion.copy(wt.quaternion);
      }
      /* altura real: o offset teórico ignorava o curso da suspensão e o
         modelo afundava ~0,5m. Referência = RODAS físicas (não o terreno:
         na rua da cidade o asfalto fica acima do heightAt e o modelo
         afundava no slab). Roda uma vez, com o chassi em repouso. */
      if (v.modelAlignPending && v.chassisBody.velocity.lengthSquared() < 0.04) {
        v.modelAlignPending = false;
        v.group.updateMatrixWorld(true);
        let wy = 0;
        for (const w of v.vehicle.wheelInfos) wy += w.worldTransform.position.y;
        const chao = wy / 4 - v.cfg.wheelR; // fundo dos pneus = chão real da física
        const box = new THREE.Box3().setFromObject(v.modelRoot);
        v.modelRoot.position.y += (chao + 0.04 - box.min.y);
        v.modelRoot.updateMatrixWorld(true);
      }
    }
    // poeira + áudio do veículo atual
    const kmh = speedKmh();
    if (state.driving && kmh > 24) {
      dustAcc += dt;
      if (dustAcc > 0.06) {
        dustAcc = 0;
        const wi = 2 + ((Math.random() * 2) | 0);
        _v1.copy(cur.wheelMeshes[wi].position);
        _v1.y -= 0.3;
        _v2.set(rand(-1, 1), rand(2, 3.4), rand(-1, 1));
        FX.spawnParticle(_v1, _v2, 0xb9a77c, rand(0.25, 0.5), rand(0.5, 0.9), 3.2);
      }
    }
    const throttle = state.driving && (keys['KeyW'] || keys['KeyS']) ? 1 : 0;
    if (state.driving && cur.cfg.engine === 'sport' && cur.lastThrottle && !throttle && kmh > 40) {
      setTimeout(() => SFX.pop(), 50);  // pipoco do escapamento
      setTimeout(() => SFX.pop(), 170);
      if (Math.random() < 0.5) setTimeout(() => SFX.pop(), 300);
    }
    cur.lastThrottle = throttle;
    SFX.engineUpdate(kmh, state.driving, throttle, cur.cfg.engine);
    if (state.driving) ui.speedVal.textContent = Math.round(kmh);
  }

  function speedKmh() { return cur.chassisBody.velocity.length() * 3.6; }
  function nearest(p) {
    let best = vehicles[0], bd = 1e9;
    for (const v of vehicles) {
      const d = p.distanceTo(v.group.position);
      if (d < bd) { bd = d; best = v; }
    }
    return { v: best, d: bd };
  }

  return {
    vehicles, nearest, update, speedKmh, ready,
    setCur(v) { cur = v; v.chassisBody.wakeUp(); },
    get cfg() { return cur.cfg; },
    get vehicle() { return cur.vehicle; },
    get chassisBody() { return cur.chassisBody; },
    get group() { return cur.group; },
  };
}
