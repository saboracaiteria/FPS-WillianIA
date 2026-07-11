import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export function createCar(deps) {
  const { damp, rand, _v1, _v2, heightAt, SFX, FX, scene, world, csmMat, Structures, ui, state, keys } = deps;
  const DRIVE_SIGN = 1; // sinal do engineForce p/ andar pra frente (validado em teste)
  const _cv1 = new CANNON.Vec3();
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

  /* ---- modelos ---- */
  const darkM = csmMat(new THREE.MeshStandardMaterial({ color: 0x22252b, metalness: 0.4, roughness: 0.6 }));
  const chrome = csmMat(new THREE.MeshStandardMaterial({ color: 0xb9c2cc, metalness: 0.9, roughness: 0.2 }));
  const glass = new THREE.MeshStandardMaterial({ color: 0xa8d8f0, metalness: 0.85, roughness: 0.08, transparent: true, opacity: 0.6 });
  const lightOnG = new THREE.MeshStandardMaterial({ color: 0xfff6cc, emissive: 0xffeeaa, emissiveIntensity: 2.6 });
  const lightRedG = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff2211, emissiveIntensity: 2.4 });
  function makeWheels(r, w2, n = 4) {
    const tireGeo = new THREE.CylinderGeometry(r, r, w2, 16); tireGeo.rotateX(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(r * 0.6, r * 0.6, w2 + 0.02, 9); hubGeo.rotateX(Math.PI / 2);
    const tireMat = csmMat(new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.9 }));
    const hubMat = csmMat(new THREE.MeshStandardMaterial({ color: 0xd9c06a, metalness: 0.7, roughness: 0.3 }));
    const ws = [];
    for (let i = 0; i < n; i++) {
      const w = new THREE.Group();
      const tire = new THREE.Mesh(tireGeo, tireMat); tire.castShadow = true;
      w.add(tire, new THREE.Mesh(hubGeo, hubMat));
      scene.add(w);
      ws.push(w);
    }
    return ws;
  }
  /* buggy (frente = +X): RoundedBox + arcos de para-lama */
  function buildBuggyModel(colorHex) {
  const group = new THREE.Group();
  const paint = csmMat(new THREE.MeshStandardMaterial({ color: colorHex, metalness: 0.55, roughness: 0.25 }));
  function part(geo, mat, x, y, z, o = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
    m.castShadow = true;
    group.add(m); return m;
  }
  part(new RoundedBoxGeometry(3.85, 0.78, 1.8, 3, 0.24), paint, 0, 0.16, 0);             // monobloco
  part(new RoundedBoxGeometry(1.25, 0.5, 1.6, 3, 0.18), paint, 1.32, 0.42, 0, { rz: -0.09 }); // capô caído
  part(new RoundedBoxGeometry(1.85, 0.74, 1.56, 3, 0.3), paint, -0.32, 0.82, 0);         // cabine
  part(new RoundedBoxGeometry(0.07, 0.56, 1.34, 2, 0.03), glass, 0.62, 0.78, 0, { rz: -0.45 }); // para-brisa
  part(new RoundedBoxGeometry(0.06, 0.46, 1.28, 2, 0.03), glass, -1.22, 0.82, 0, { rz: 0.35 }); // vidro traseiro
  part(new RoundedBoxGeometry(1.1, 0.36, 0.05, 2, 0.02), glass, -0.32, 0.86, 0.79);      // janelas laterais
  part(new RoundedBoxGeometry(1.1, 0.36, 0.05, 2, 0.02), glass, -0.32, 0.86, -0.79);
  part(new RoundedBoxGeometry(0.55, 0.32, 1.92, 2, 0.13), darkM, 1.9, -0.08, 0);         // para-choque diant.
  part(new RoundedBoxGeometry(0.45, 0.32, 1.92, 2, 0.13), darkM, -1.9, -0.08, 0);        // para-choque tras.
  part(new RoundedBoxGeometry(0.09, 0.2, 0.95, 2, 0.04), darkM, 2.05, 0.16, 0);          // grade
  part(new RoundedBoxGeometry(1.5, 0.16, 0.16, 2, 0.06), darkM, 0, -0.22, 0.92);         // saia lateral
  part(new RoundedBoxGeometry(1.5, 0.16, 0.16, 2, 0.06), darkM, 0, -0.22, -0.92);
  // para-lamas: arcos de toro sobre cada roda
  const archGeo = new THREE.TorusGeometry(0.6, 0.14, 8, 16, Math.PI);
  for (const [wx, wz] of [[1.28, 0.86], [1.28, -0.86], [-1.28, 0.86], [-1.28, -0.86]])
    part(archGeo, paint, wx, -0.12, wz);
  // santantônio (roll bar) atrás da cabine
  part(new THREE.TorusGeometry(0.78, 0.07, 8, 14, Math.PI), chrome, -1.32, 0.55, 0, { ry: Math.PI / 2 });
  // aerofólio + suportes
  part(new RoundedBoxGeometry(0.5, 0.07, 1.7, 2, 0.03), paint, -1.8, 1.06, 0, { rz: 0.12 });
  part(new RoundedBoxGeometry(0.1, 0.3, 0.1, 1, 0.03), darkM, -1.78, 0.85, 0.6);
  part(new RoundedBoxGeometry(0.1, 0.3, 0.1, 1, 0.03), darkM, -1.78, 0.85, -0.6);
  // espelhos retrovisores
  part(new RoundedBoxGeometry(0.1, 0.12, 0.22, 1, 0.04), darkM, 0.62, 1.02, 0.92);
  part(new RoundedBoxGeometry(0.1, 0.12, 0.22, 1, 0.04), darkM, 0.62, 1.02, -0.92);
  // escapamento duplo
  const exhGeo = new THREE.CylinderGeometry(0.07, 0.08, 0.3, 10);
  part(exhGeo, chrome, -2.05, -0.18, 0.45, { rz: Math.PI / 2 });
  part(exhGeo, chrome, -2.05, -0.18, 0.62, { rz: Math.PI / 2 });
  // antena
  part(new THREE.CylinderGeometry(0.012, 0.02, 0.7, 6), darkM, -1.1, 1.45, 0.7);
  const lightOn = new THREE.MeshStandardMaterial({ color: 0xfff6cc, emissive: 0xffeeaa, emissiveIntensity: 2.6 });
  const lightRed = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff2211, emissiveIntensity: 2.4 });
  part(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 12), lightOn, 2.06, 0.22, 0.58, { rz: Math.PI / 2 });   // faróis redondos
  part(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 12), lightOn, 2.06, 0.22, -0.58, { rz: Math.PI / 2 });
  part(new RoundedBoxGeometry(0.08, 0.14, 0.4, 1, 0.04), lightRed, -2.08, 0.24, 0.6);    // lanternas
  part(new RoundedBoxGeometry(0.08, 0.14, 0.4, 1, 0.04), lightRed, -2.08, 0.24, -0.6);
  scene.add(group);
  return group;
  }

  /* caminhão militar: cabine + caçamba com lona */
  function buildTruckModel() {
    const group = new THREE.Group();
    const army = csmMat(new THREE.MeshStandardMaterial({ color: 0x46523a, metalness: 0.3, roughness: 0.55 }));
    const armyD = csmMat(new THREE.MeshStandardMaterial({ color: 0x333d2b, roughness: 0.7 }));
    function p2(geo, mat, x, y, z, o = {}) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
      m.castShadow = true;
      group.add(m); return m;
    }
    p2(new RoundedBoxGeometry(5.4, 0.7, 2.1, 2, 0.12), army, 0, 0.1, 0);                 // chassi
    p2(new RoundedBoxGeometry(1.6, 1.3, 2.0, 2, 0.18), army, 1.9, 0.95, 0);              // cabine
    p2(new RoundedBoxGeometry(0.08, 0.55, 1.7, 2, 0.03), glass, 2.55, 1.25, 0, { rz: -0.25 });
    p2(new RoundedBoxGeometry(0.9, 0.5, 2.0, 2, 0.1), army, 2.9, 0.45, 0);               // capô
    p2(new RoundedBoxGeometry(3.1, 1.35, 2.1, 2, 0.1), armyD, -0.95, 1.05, 0);           // lona da caçamba
    p2(new RoundedBoxGeometry(0.5, 0.3, 1.9, 1, 0.08), darkM, 3.3, 0.2, 0);              // para-choque
    p2(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 10), lightOnG, 3.42, 0.55, 0.7, { rz: Math.PI / 2 });
    p2(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 10), lightOnG, 3.42, 0.55, -0.7, { rz: Math.PI / 2 });
    p2(new RoundedBoxGeometry(0.08, 0.12, 0.3, 1, 0.03), lightRedG, -2.65, 0.4, 0.8);
    p2(new RoundedBoxGeometry(0.08, 0.12, 0.3, 1, 0.03), lightRedG, -2.65, 0.4, -0.8);
    const star = new THREE.Mesh(new THREE.CircleGeometry(0.3, 5), csmMat(new THREE.MeshStandardMaterial({ color: 0xe8eef4, roughness: 0.6 })));
    star.position.set(-0.95, 1.05, 1.07); group.add(star);
    scene.add(group);
    return group;
  }
  /* esportivo: baixo, largo, aerofólio grande, escapamento que pipoca */
  function buildSportModel(colorHex) {
    const group = new THREE.Group();
    const paint = csmMat(new THREE.MeshStandardMaterial({ color: colorHex, metalness: 0.75, roughness: 0.18 }));
    function p2(geo, mat, x, y, z, o = {}) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
      m.castShadow = true;
      group.add(m); return m;
    }
    p2(new RoundedBoxGeometry(3.9, 0.5, 1.85, 3, 0.2), paint, 0, 0.02, 0);                // corpo baixo
    p2(new RoundedBoxGeometry(1.45, 0.42, 1.55, 3, 0.21), paint, -0.2, 0.42, 0);          // cabine rente
    p2(new RoundedBoxGeometry(0.07, 0.4, 1.4, 2, 0.03), glass, 0.55, 0.4, 0, { rz: -0.55 });
    p2(new RoundedBoxGeometry(0.06, 0.32, 1.34, 2, 0.03), glass, -0.95, 0.42, 0, { rz: 0.45 });
    p2(new RoundedBoxGeometry(1.1, 0.16, 1.7, 2, 0.07), paint, 1.55, 0.18, 0, { rz: -0.08 }); // bico
    p2(new RoundedBoxGeometry(0.5, 0.24, 1.9, 2, 0.1), darkM, 1.95, -0.12, 0);            // splitter
    p2(new RoundedBoxGeometry(0.6, 0.08, 1.95, 2, 0.04), darkM, -1.85, 0.78, 0, { rz: 0.1 }); // aerofólio
    p2(new RoundedBoxGeometry(0.09, 0.34, 0.09, 1, 0.03), darkM, -1.82, 0.55, 0.7);
    p2(new RoundedBoxGeometry(0.09, 0.34, 0.09, 1, 0.03), darkM, -1.82, 0.55, -0.7);
    p2(new THREE.CylinderGeometry(0.085, 0.095, 0.25, 10), chrome, -2.0, -0.1, 0.35, { rz: Math.PI / 2 });
    p2(new THREE.CylinderGeometry(0.085, 0.095, 0.25, 10), chrome, -2.0, -0.1, -0.35, { rz: Math.PI / 2 });
    p2(new RoundedBoxGeometry(0.1, 0.08, 0.5, 1, 0.03), lightOnG, 2.07, 0.2, 0.55, { ry: 0.2 });
    p2(new RoundedBoxGeometry(0.1, 0.08, 0.5, 1, 0.03), lightOnG, 2.07, 0.2, -0.55, { ry: -0.2 });
    p2(new RoundedBoxGeometry(0.07, 0.1, 1.5, 1, 0.03), lightRedG, -2.02, 0.3, 0);
    scene.add(group);
    return group;
  }

  /* ---- frota ---- */
  const vehicles = [];
  function makeVehicle(cfg, x, z, ry) {
    const { chassisBody, vehicle } = createPhysics(cfg, x, z);
    if (ry) chassisBody.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), ry);
    const v = { cfg, chassisBody, vehicle, group: cfg.build(), wheelMeshes: makeWheels(cfg.wheelR, cfg.wheelW), steerCur: 0, lastThrottle: 0 };
    vehicles.push(v);
    return v;
  }
  const CFG_BUGGY = { name: 'BUGGY', mass: 280, half: [1.8, 0.38, 0.85],
    wheels: [[1.28, -0.1, 0.8], [1.28, -0.1, -0.8], [-1.28, -0.1, 0.8], [-1.28, -0.1, -0.8]],
    wheelR: 0.5, wheelW: 0.34, force: 1650, steer: 0.55, brake: 32, engine: 'normal', build: () => buildBuggyModel(0xe8562a) };
  const CFG_TRUCK = { name: 'CAMINHÃO MILITAR', mass: 680, half: [2.7, 0.55, 1.05],
    wheels: [[1.9, -0.18, 1], [1.9, -0.18, -1], [-1.7, -0.18, 1], [-1.7, -0.18, -1]],
    wheelR: 0.6, wheelW: 0.45, force: 3600, steer: 0.45, brake: 55, grip: 1.6, engine: 'truck', build: buildTruckModel };
  const mkSport = c => ({ name: 'ESPORTIVO GT', mass: 420, half: [1.9, 0.32, 0.88],
    wheels: [[1.35, -0.02, 0.82], [1.35, -0.02, -0.82], [-1.3, -0.02, 0.82], [-1.3, -0.02, -0.82]],
    wheelR: 0.42, wheelW: 0.3, force: 5200, steer: 0.5, brake: 60, grip: 2.2, awd: true, engine: 'sport', build: () => buildSportModel(c) });
  let cur = makeVehicle(CFG_BUGGY, 7.5, -6);
  for (const s of Structures.carSpots) {
    if (s.type === 'truck') makeVehicle(CFG_TRUCK, s.x, s.z, s.ry);
    else makeVehicle(mkSport(s.type === 'sport2' ? 0x2a6de8 : 0xd61f30), s.x, s.z, s.ry);
  }
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
    vehicles, nearest, update, speedKmh,
    setCur(v) { cur = v; v.chassisBody.wakeUp(); },
    get cfg() { return cur.cfg; },
    get vehicle() { return cur.vehicle; },
    get chassisBody() { return cur.chassisBody; },
    get group() { return cur.group; },
  };
}
