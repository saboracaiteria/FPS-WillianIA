/* ================================================================
   AMBIENTE DINÂMICO — ciclo dia/noite, estrelas, chuva e neve
   ================================================================ */
const _dummy2 = new THREE.Object3D();
import * as THREE from 'three';

export function createEnv(deps) {
  const { CFG, clamp, lerp, damp, rand, TAU, SFX, scene, camera, renderer, csm, sky, sunDir, hemiLight, ambLight, Water, Grass, Structures, _euler } = deps;
  const _dummy2 = new THREE.Object3D();
  const DAY_LEN = 420; // segundos por ciclo completo
  let tod = 0.33; // 0 = meia-noite, 0.5 = meio-dia
  let weather = 'limpo', weatherK = 0, nextWeather = 75, thunderT = 9, flashT = 0;
  let nightK = 0, dayK = 1;

  // estrelas no domo
  const starGeo = new THREE.BufferGeometry();
  const sp = new Float32Array(520 * 3);
  for (let i = 0; i < 520; i++) {
    const v = new THREE.Vector3().randomDirection();
    if (v.y < 0.06) v.y = Math.abs(v.y) + 0.08;
    sp[i * 3] = v.x * 1500; sp[i * 3 + 1] = v.y * 1500; sp[i * 3 + 2] = v.z * 1500;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xcfe2ff, size: 2.0, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false }));
  stars.frustumCulled = false;
  scene.add(stars);

  // chuva: hastes instanciadas que acompanham a câmera
  const RN = 450;
  const rainMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.015, 0.85, 0.015),
    new THREE.MeshBasicMaterial({ color: 0x9fc2e8, transparent: true, opacity: 0.42, depthWrite: false }), RN);
  rainMesh.visible = false; rainMesh.frustumCulled = false;
  scene.add(rainMesh);
  const rainP = [];
  for (let i = 0; i < RN; i++) rainP.push({ x: rand(-22, 22), y: rand(0, 26), z: rand(-22, 22) });
  // neve: flocos hexagonais derivando (billboard — quad girando ficava "riscado")
  const SN = 350;
  const snowMesh = new THREE.InstancedMesh(new THREE.CircleGeometry(0.055, 6),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }), SN);
  snowMesh.visible = false; snowMesh.frustumCulled = false;
  scene.add(snowMesh);
  const snowP = [];
  for (let i = 0; i < SN; i++) snowP.push({ x: rand(-20, 20), y: rand(0, 18), z: rand(-20, 20), ph: rand(TAU) });

  const FOG_DAY = new THREE.Color(0xb9d1e4), FOG_NIGHT = new THREE.Color(0x0c1422), FOG_RAIN = new THREE.Color(0x76828e);
  const SUN_DAY = new THREE.Color(0xffe7c0), HEMI_DAY = new THREE.Color(0xa9cdf2), HEMI_NIGHT = new THREE.Color(0x2a3c5e);
  const _f = new THREE.Color(), _sd2 = new THREE.Vector3();

  function update(dt, t) {
    // dia passa devagar, noite passa rápido: dia dura ~3x mais que a noite
    const dayNow = tod > 0.25 && tod < 0.75;
    tod = (tod + dt * (dayNow ? 0.62 : 1.9) / DAY_LEN) % 1;
    const ang = (tod - 0.25) * TAU; // nascer do sol ~6h
    const elevDeg = Math.sin(ang) * 58;
    const azimDeg = 155 + Math.cos(ang) * 55;
    dayK = clamp((elevDeg + 4) / 14, 0, 1);
    nightK = 1 - dayK;
    // sol em movimento: céu, CSM, grama e água acompanham
    _sd2.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - Math.max(elevDeg, 2)), THREE.MathUtils.degToRad(azimDeg));
    sunDir.copy(_sd2);
    sky.material.uniforms.sunPosition.value.copy(_sd2);
    if (elevDeg > -2) csm.lightDirection.copy(_sd2).negate().normalize();
    for (const l of csm.lights) l.intensity = 1.8 * dayK * (1 - weatherK * 0.55);
    hemiLight.intensity = 0.42 * dayK + 0.09;
    hemiLight.color.copy(HEMI_DAY).lerp(HEMI_NIGHT, nightK);
    ambLight.intensity = 0.16 * dayK + 0.05;
    renderer.toneMappingExposure = lerp(0.34, CFG.EXPOSURE, dayK);
    scene.environmentIntensity = 0.38 * dayK + 0.05;
    const u = sky.material.uniforms;
    u.rayleigh.value = lerp(0.55, 1.15, dayK);
    u.mieCoefficient.value = 0.0008 + weatherK * 0.0035;
    if (u.cloudCoverage) u.cloudCoverage.value = 0.38 + weatherK * 0.45;
    _f.copy(FOG_DAY).lerp(FOG_NIGHT, nightK).lerp(FOG_RAIN, weatherK * 0.7 * dayK);
    scene.fog.color.copy(_f);
    scene.fog.near = CFG.VIEW_DIST * (0.5 - weatherK * 0.28);
    stars.material.opacity = nightK * (1 - weatherK) * 0.9;
    stars.position.copy(camera.position);
    Grass.material.uniforms.uSunDir.value.copy(_sd2);
    Grass.material.uniforms.uSunColor.value.copy(SUN_DAY).multiplyScalar(0.22 + dayK * 0.92);
    Grass.material.uniforms.uSkyColor.value.copy(HEMI_DAY).lerp(HEMI_NIGHT, nightK);
    Grass.material.uniforms.uWind.value = CFG.WIND_STRENGTH + weatherK * 0.5;
    Water.uniforms.uSunDir.value.copy(_sd2);
    Water.uniforms.uSky.value.copy(FOG_DAY).lerp(FOG_NIGHT, nightK);
    Structures.cityMat.emissiveIntensity = 0.12 + nightK * 1.6; // janelas acendem à noite

    // máquina de clima
    nextWeather -= dt;
    if (nextWeather <= 0) {
      nextWeather = rand(80, 150);
      const r = Math.random();
      weather = r < 0.52 ? 'limpo' : r < 0.8 ? 'chuva' : 'neve';
    }
    weatherK = damp(weatherK, weather === 'limpo' ? 0 : 1, 0.4, dt);
    SFX.setRain(weather === 'chuva' ? weatherK : 0);
    if (weather === 'chuva' && weatherK > 0.6) {
      thunderT -= dt;
      if (thunderT <= 0) { thunderT = rand(7, 18); SFX.thunder(); flashT = 0.13; }
    }
    flashT = Math.max(0, flashT - dt);
    if (flashT > 0) hemiLight.intensity += 2.8; // relâmpago

    const cp = camera.position;
    const showRain = weather === 'chuva' && weatherK > 0.04;
    rainMesh.visible = showRain;
    if (showRain) {
      rainMesh.count = Math.max(1, Math.floor(RN * weatherK));
      for (let i = 0; i < rainMesh.count; i++) {
        const p = rainP[i];
        p.y -= 36 * dt;
        if (p.y < -2) { p.y = 24; p.x = rand(-22, 22); p.z = rand(-22, 22); }
        _dummy2.position.set(cp.x + p.x, cp.y + p.y - 8, cp.z + p.z);
        _dummy2.rotation.set(0.07, 0, 0.05);
        _dummy2.updateMatrix();
        rainMesh.setMatrixAt(i, _dummy2.matrix);
      }
      rainMesh.instanceMatrix.needsUpdate = true;
    }
    const showSnow = weather === 'neve' && weatherK > 0.04;
    snowMesh.visible = showSnow;
    if (showSnow) {
      // flocos sempre de frente pra câmera: girar no yaw deixava o quad de lado (invisível/riscado)
      _euler.setFromQuaternion(camera.quaternion);
      const camYaw = _euler.y;
      snowMesh.count = Math.max(1, Math.floor(SN * weatherK));
      for (let i = 0; i < snowMesh.count; i++) {
        const p = snowP[i];
        p.y -= 2.6 * dt; p.ph += dt;
        if (p.y < -2) { p.y = 16; p.x = rand(-20, 20); p.z = rand(-20, 20); }
        _dummy2.position.set(cp.x + p.x + Math.sin(p.ph) * 0.9, cp.y + p.y - 6, cp.z + p.z + Math.cos(p.ph * 0.8) * 0.9);
        _dummy2.rotation.set(0, camYaw, p.ph); // encara a câmera, rodopia no próprio plano
        _dummy2.updateMatrix();
        snowMesh.setMatrixAt(i, _dummy2.matrix);
      }
      snowMesh.instanceMatrix.needsUpdate = true;
    }
  }
  return {
    update,
    get nightK() { return nightK; },
    get tod() { return tod; }, set tod(v) { tod = v; },
    get weather() { return weather; }, set weather(w) { weather = w; nextWeather = rand(80, 150); },
    get weatherK() { return weatherK; },
  };
}
