/* Corpo do jogador em primeira pessoa — helldiver rigado (51 ossos).
   Substitui as mãos-caixa: o corpo inteiro fica pendurado na câmera e os
   braços são resolvidos por IK de 2 ossos mirando as MESMAS âncoras
   (gun.parts.handR/handL) que a coreografia de recarga do game.js já move —
   ou seja: pente saindo, tapa no carregador, bombeada da escopeta e sway
   continuam com o timing original, agora com mãos e dedos de verdade.
   Se o GLB falhar, as mãos procedurais antigas continuam no lugar. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export function createFpBody(deps) {
  const { camera, player, getGun, weaponRoot } = deps;

  const bodyRoot = new THREE.Group();
  bodyRoot.visible = false;
  camera.add(bodyRoot);

  /* calibração (ajustada por screenshot no playtest) */
  const TUNE = {
    scale: 1.18,           // braços do modelo são curtos: corpo maior alcança o grip
    height: 1.78,          // altura alvo do modelo (m)
    eyeDrop: 0.2,          // topo da cabeça fica este tanto ACIMA do olho
    back: 0.05,            // centro do tronco recuado atrás da câmera (m)
    yaw: Math.PI,          // modelo olha pra -Z da câmera
    rollR: 1.4,            // rolagem do punho direito em volta do eixo dos dedos
    rollL: -1.6,           // idem esquerdo (palma abraça o guarda-mão por baixo)
    // direção dos DEDOS no espaço da arma: direita envolve o grip do gatilho,
    // esquerda cruza por baixo do guarda-mão
    fingersR: [-0.8, -0.25, -0.45],
    fingersL: [0.8, 0.3, -0.4],
    elbowOut: 0.34,        // quão aberto o cotovelo fica (direção do pole)
    elbowDown: 0.5,
  };

  const B = {};            // ossos por apelido
  const bind = new Map();  // pose de descanso (pos+quat locais) de cada osso tocado
  let armLen = null;       // { r: {a, b}, l: {a, b} } comprimentos braço/antebraço
  let readyFlag = false, failed = false;

  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
  const _tp = new THREE.Vector3(), _pole = new THREE.Vector3(), _n = new THREE.Vector3();
  const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _tq = new THREE.Quaternion();
  const fingerAxis = { r: new THREE.Vector3(0, 0, -1), l: new THREE.Vector3(0, 0, -1) };

  /* dedos: [curl base, curl ponta] por estado; indicador direito no gatilho */
  const GRIP = {
    default: { r: [0.85, 0.9], l: [0.8, 0.85], trigR: 0.35 },
    knife:   { r: [1.0, 1.05], l: [0.35, 0.4], trigR: 1.0 },
    pump:    { r: [0.85, 0.9], l: [0.95, 1.0], trigR: 0.35 },
    bazooka: { r: [0.9, 0.95], l: [0.9, 0.95], trigR: 0.6 },
    open:    { r: [0.12, 0.15], l: [0.12, 0.15], trigR: 0.12 },
    straps:  { r: [1.05, 1.1], l: [1.05, 1.1], trigR: 1.05 },
  };
  function gripFor(gun) {
    if (window.__FP_pose === 'chute') return GRIP.straps;
    if (window.__FP_pose === 'fall') return GRIP.open;
    if (!gun) return GRIP.default;
    if (gun.melee) return GRIP.knife;
    if (gun.parts && gun.parts.pump) return GRIP.pump;
    if (gun.rocket) return GRIP.bazooka;
    return GRIP.default;
  }

  new GLTFLoader().loadAsync('/assets/models/Personagens/low_poly_helldiver_rig.glb')
    .then(gltf => {
      const model = gltf.scene;
      model.traverse(o => {
        if (o.isMesh || o.isSkinnedMesh) {
          o.castShadow = false;
          o.receiveShadow = false;
          o.frustumCulled = false; // rig na câmera: bounding não acompanha ossos
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            if (m && m.isMeshStandardMaterial && !m.map) {
              const l = m.color.r * 0.299 + m.color.g * 0.587 + m.color.b * 0.114;
              if (l > 0.72) m.color.multiplyScalar(0.72 / l);
            }
          }
        }
      });
      // normaliza a altura e pendura na câmera, ancorando pelo BOUNDING BOX
      // (o pivô do GLB não é o pescoço — sem isto a câmera nasce dentro do peito)
      const box = new THREE.Box3().setFromObject(model);
      const h = box.max.y - box.min.y;
      const s = (TUNE.height / Math.max(h, 1e-3)) * TUNE.scale;
      const orient = new THREE.Group();
      orient.rotation.y = TUNE.yaw;
      orient.scale.setScalar(s);
      orient.add(model);
      orient.updateMatrixWorld(true);
      const sBox = new THREE.Box3().setFromObject(orient);
      orient.position.set(
        -(sBox.min.x + sBox.max.x) * 0.5,
        TUNE.eyeDrop - sBox.max.y,          // topo da cabeça logo acima do olho
        -(sBox.min.z + sBox.max.z) * 0.5 + TUNE.back,
      );
      bodyRoot.add(orient);

      // o GLTFLoader remove pontos/espaços dos nomes ("Arm_1.L_13" → "Arm_1L_13"):
      // compara tudo normalizado pra não depender do sanitizador do three
      const norm = s => String(s).replace(/[.\s]/g, '');
      const find = frag => {
        const f = norm(frag);
        let hit = null;
        model.traverse(o => { if (!hit && o.isBone && norm(o.name).includes(f)) hit = o; });
        return hit;
      };
      B.head = find('Head_');
      B.chest = find('Chest');
      B.torso = find('Torso');
      B.shR = find('Sholder.R'); B.upR = find('Arm_1.R'); B.foR = find('Arm_2.R'); B.haR = find('Hand.R');
      B.shL = find('Sholder.L'); B.upL = find('Arm_1.L'); B.foL = find('Arm_2.L'); B.haL = find('Hand.L');
      B.pelR = find('Pelvis.R'); B.leg1R = find('Leg_1.R'); B.leg2R = find('Leg_2.R');
      B.pelL = find('Pelvis.L'); B.leg1L = find('Leg_1.L'); B.leg2L = find('Leg_2.L');
      B.cloak = [];
      model.traverse(o => { if (o.isBone && norm(o.name).startsWith('Cloak')) B.cloak.push(o); });
      B.fingersR = []; B.fingersL = [];
      model.traverse(o => {
        if (!o.isBone || !/^Finger/.test(o.name)) return;
        const n = norm(o.name);
        if (/R_\d+$/.test(n)) B.fingersR.push(o);
        else if (/L_\d+$/.test(n) || n === 'Finger_6_5') B.fingersL.push(o); // 6 = polegar esquerdo (sem sufixo no rig)
      });
      if (!B.upR || !B.foR || !B.haR || !B.upL || !B.foL || !B.haL)
        throw new Error('ossos dos braços não encontrados no helldiver');

      // cabeça some (câmera mora dentro dela)
      if (B.head) B.head.scale.setScalar(0.0001);

      // guarda a pose de descanso de tudo que vamos mexer
      const track = [B.chest, B.torso, B.shR, B.upR, B.foR, B.haR, B.shL, B.upL, B.foL, B.haL,
        B.pelR, B.leg1R, B.leg2R, B.pelL, B.leg1L, B.leg2L, ...B.cloak, ...B.fingersR, ...B.fingersL];
      for (const b of track) if (b) bind.set(b, { p: b.position.clone(), q: b.quaternion.clone() });

      // comprimentos dos segmentos em unidades de MUNDO (com escala aplicada)
      bodyRoot.visible = true;
      bodyRoot.updateWorldMatrix(true, true);
      const dist = (x, y) => x.getWorldPosition(_v).distanceTo(y.getWorldPosition(_v2));
      armLen = {
        r: { a: dist(B.upR, B.foR), b: dist(B.foR, B.haR) },
        l: { a: dist(B.upL, B.foL), b: dist(B.foL, B.haL) },
      };
      // eixo real dos dedos no espaço LOCAL da mão (média das falanges base):
      // é ele que a gente alinha com a direção da empunhadura da arma
      for (const [key, hand, fingers] of [['r', B.haR, B.fingersR], ['l', B.haL, B.fingersL]]) {
        const acc = new THREE.Vector3();
        for (const f of fingers) if (f.parent === hand) acc.add(f.position);
        if (acc.lengthSq() > 1e-8) fingerAxis[key].copy(acc.normalize());
      }
      readyFlag = true;
      // com o rig no lugar, as mãos-caixa procedurais somem de todas as armas
      for (const gun of deps.arsenal) {
        for (const k of ['handR', 'handL']) {
          if (gun.parts && gun.parts[k]) gun.parts[k].traverse(o => { if (o.isMesh) o.visible = false; });
        }
      }
    })
    .catch(err => {
      failed = true;
      console.error('FP body falhou — mantendo mãos procedurais:', err);
    });

  /* gira um osso no MUNDO de forma que a direção atual `from` aponte pra `to` */
  function aimBone(bone, fromDir, toDir) {
    _q.setFromUnitVectors(_v.copy(fromDir).normalize(), _v2.copy(toDir).normalize());
    bone.getWorldQuaternion(_q2);
    _q.multiply(_q2); // quat mundial desejado
    bone.parent.getWorldQuaternion(_q2).invert();
    bone.quaternion.copy(_q2.multiply(_q));
    bone.updateWorldMatrix(true, true);
  }
  /* punho: alinha o eixo dos dedos com a direção da empunhadura + rolagem */
  function alignHand(hand, axisLocal, worldDir, roll) {
    hand.updateWorldMatrix(true, false);
    _v.copy(axisLocal).transformDirection(hand.matrixWorld).normalize(); // dedos hoje
    _v2.copy(worldDir).normalize();
    _q.setFromUnitVectors(_v, _v2);
    hand.getWorldQuaternion(_q2);
    _q.multiply(_q2);                                   // quat mundial alinhado
    _tq.setFromAxisAngle(_v2, roll).multiply(_q);       // rolagem em volta dos dedos
    hand.parent.getWorldQuaternion(_q2).invert();
    hand.quaternion.copy(_q2.multiply(_tq));
    hand.updateWorldMatrix(true, true);
  }

  /* IK analítico de 2 ossos com dobra guiada por "pole" (cotovelo) */
  function solveArm(up, fore, hand, len, targetPos, targetQuat, sideSign) {
    const sPos = up.getWorldPosition(_v3.set(0, 0, 0)).clone();
    _tp.copy(targetPos).sub(sPos);
    const reach = len.a + len.b;
    let d = _tp.length();
    if (d > reach * 0.999) { _tp.multiplyScalar((reach * 0.999) / d); d = reach * 0.999; }
    if (d < 1e-4) return;
    _n.copy(_tp).normalize();

    // pole: cotovelo pra fora/baixo em relação à câmera
    camera.getWorldQuaternion(_tq);
    _pole.set(sideSign * TUNE.elbowOut, -TUNE.elbowDown, 0.05).applyQuaternion(_tq);
    _pole.addScaledVector(_n, -_pole.dot(_n)); // perpendicular à linha ombro→alvo
    if (_pole.lengthSq() < 1e-6) _pole.set(0, -1, 0).addScaledVector(_n, _n.y);
    _pole.normalize();

    const cosA = Math.min(1, Math.max(-1, (len.a * len.a + d * d - len.b * len.b) / (2 * len.a * d)));
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    // posição desejada do cotovelo
    _v.copy(sPos).addScaledVector(_n, len.a * cosA).addScaledVector(_pole, len.a * sinA);

    // 1) ombro mira o cotovelo desejado
    fore.getWorldPosition(_v2).sub(sPos);
    aimBone(up, _v2, _v3.copy(_v).sub(sPos));
    // 2) cotovelo mira o alvo
    const ePos = fore.getWorldPosition(_v2).clone();
    hand.getWorldPosition(_v3).sub(ePos);
    aimBone(fore, _v3, _v.copy(targetPos).sub(ePos));
    // (o punho é alinhado depois por alignHand — eixo dos dedos + rolagem)
  }

  /* curl dos dedos: cada dedo tem 2 falanges (Finger_1..10 = 5 dedos × 2) */
  function curlFingers(bones, base, tip, trig, isRight, k) {
    for (const b of bones) {
      const bd = bind.get(b);
      if (!bd) continue;
      const idx = parseInt(b.name.match(/^Finger_(\d+)/)[1], 10);
      const isTip = idx % 2 === 0;       // pares = segunda falange
      const digit = Math.ceil(idx / 2);  // 1..5
      let amt = isTip ? tip : base;
      if (isRight && digit === 1) amt = trig;      // indicador no gatilho
      if (digit === 5) amt *= 0.75;                // polegar fecha menos
      _q.setFromAxisAngle(_v.set(1, 0, 0), amt); // + fecha a mão neste rig
      b.quaternion.copy(bd.q).multiply(_q);
      // suaviza: mistura com a pose anterior pra não "teleportar" o dedo
      if (b.userData.prevQ) b.quaternion.slerp(b.userData.prevQ, Math.max(0, 1 - k));
      b.userData.prevQ = (b.userData.prevQ || new THREE.Quaternion()).copy(b.quaternion);
    }
  }

  let walkPh = 0, gunHiddenByPose = null;
  function update(dt, t) {
    if (!readyFlag || failed) return;
    const gun = getGun();
    bodyRoot.visible = weaponRoot.visible;
    // na queda/paraquedas a arma some (as mãos estão nas alças, não no gatilho)
    const poseNow = window.__FP_pose;
    if (poseNow && gun && gun.group.visible) { gun.group.visible = false; gunHiddenByPose = gun; }
    else if (!poseNow && gunHiddenByPose) { gunHiddenByPose.group.visible = gunHiddenByPose === gun; gunHiddenByPose = null; }
    if (!bodyRoot.visible) return;

    // reset pra pose de descanso (deltas de IK não podem acumular)
    for (const [b, bd] of bind) { b.position.copy(bd.p); b.quaternion.copy(bd.q); }
    bodyRoot.updateWorldMatrix(true, true);

    /* pernas: passada proporcional à velocidade; no ar, encolhe */
    const spd = Math.hypot(player.vel.x, player.vel.z);
    walkPh += dt * Math.min(spd, 9) * 1.35;
    const stride = Math.min(spd / 5.2, 1) * (player.onGround ? 0.55 : 0.1);
    const air = player.onGround ? 0 : 1;
    const legPairs = [[B.pelL, B.leg1L, B.leg2L, 1], [B.pelR, B.leg1R, B.leg2R, -1]];
    for (const [pel, l1, l2, s] of legPairs) {
      if (!pel || !l1 || !l2) continue;
      const sw = Math.sin(walkPh) * s * stride;
      _q.setFromAxisAngle(_v.set(1, 0, 0), sw - air * 0.5 - player.crouchT * 0.7);
      pel.quaternion.multiply(_q);
      _q.setFromAxisAngle(_v.set(1, 0, 0), Math.max(0, -sw) * 0.9 + air * 0.8 + player.crouchT * 1.0);
      l2.quaternion.multiply(_q);
    }
    /* respiração + capa balançando */
    if (B.chest) {
      _q.setFromAxisAngle(_v.set(1, 0, 0), Math.sin(t * 1.6) * 0.014 + player.crouchT * 0.25);
      B.chest.quaternion.multiply(_q);
    }
    for (let i = 0; i < B.cloak.length; i++) {
      const c = B.cloak[i];
      _q.setFromAxisAngle(_v.set(1, 0, 0), Math.sin(t * 1.9 + i) * 0.05 + Math.min(spd / 8, 1) * 0.3);
      c.quaternion.multiply(_q);
    }

    /* alvos das mãos (posição) + direção dos dedos (empunhadura) */
    const pose = window.__FP_pose;
    camera.getWorldQuaternion(_tq);
    const camPos = camera.getWorldPosition(new THREE.Vector3());
    const rp = new THREE.Vector3(), lp = new THREE.Vector3();
    const dirR = new THREE.Vector3(), dirL = new THREE.Vector3();
    if (pose === 'chute' || pose === 'fall') { // paraquedas: mãos nas alças / caindo: braços abertos
      const up = pose === 'chute';
      rp.set(up ? 0.26 : 0.55, up ? 0.38 : -0.12, up ? -0.16 : -0.3).applyQuaternion(_tq).add(camPos);
      lp.set(up ? -0.26 : -0.55, up ? 0.38 : -0.12, up ? -0.16 : -0.3).applyQuaternion(_tq).add(camPos);
      dirR.set(0.15, up ? 0.9 : 0.1, up ? 0.25 : -0.95).applyQuaternion(_tq);
      dirL.set(-0.15, up ? 0.9 : 0.1, up ? 0.25 : -0.95).applyQuaternion(_tq);
    } else if (gun && gun.parts && gun.parts.handR) {
      gun.parts.handR.getWorldPosition(rp);
      gun.group.getWorldQuaternion(_q2);
      dirR.set(...TUNE.fingersR).applyQuaternion(_q2);
      if (gun.melee) { // faca: mão esquerda relaxada ao lado do corpo
        lp.set(-0.28, -0.52, -0.02).applyQuaternion(_tq).add(camPos);
        dirL.set(-0.1, -0.65, -0.75).applyQuaternion(_tq);
      } else {
        gun.parts.handL.getWorldPosition(lp);
        dirL.set(...TUNE.fingersL).applyQuaternion(_q2);
      }
    } else return;

    solveArm(B.upR, B.foR, B.haR, armLen.r, rp, null, 1);
    solveArm(B.upL, B.foL, B.haL, armLen.l, lp, null, -1);
    alignHand(B.haR, fingerAxis.r, dirR, TUNE.rollR);
    alignHand(B.haL, fingerAxis.l, dirL, TUNE.rollL);

    /* dedos: preset da arma; na recarga a mão que viaja abre um pouco */
    const g = gripFor(gun);
    let reachK = 0;
    if (gun && gun.reloading) {
      const k = Math.min(Math.max(1 - (gun.reloadEnd - t) / gun.reloadTime, 0), 1);
      reachK = Math.sin(Math.min(k / 0.2, 1) * Math.PI) * 0.5 + (k > 0.4 && k < 0.7 ? 0.4 : 0);
    }
    curlFingers(B.fingersR, g.r[0], g.r[1], g.trigR, true, 0.65);
    curlFingers(B.fingersL, Math.max(0.15, g.l[0] - reachK), Math.max(0.2, g.l[1] - reachK), g.l[0], false, 0.65);
  }

  const api = {
    update,
    get ready() { return readyFlag; },
    get failed() { return failed; },
    bones: B, TUNE, bodyRoot,
    /* inspeção: solta o corpo no mundo pra fotografar de fora (calibração) */
    debugDetach(x, y, z) {
      deps.camera.remove(bodyRoot);
      deps.camera.parent.add(bodyRoot);
      bodyRoot.position.set(x, y, z);
      bodyRoot.visible = true;
    },
    debugAttach() {
      bodyRoot.parent && bodyRoot.parent.remove(bodyRoot);
      deps.camera.add(bodyRoot);
      bodyRoot.position.set(0, 0, 0);
    },
    debugBindPose() { // volta o rig pra pose de descanso (foto de calibração)
      for (const [b, bd] of bind) { b.position.copy(bd.p); b.quaternion.copy(bd.q); }
      bodyRoot.updateWorldMatrix(true, true);
    },
  };
  window.__FP = api; // depuração/calibração nos testes
  return api;
}
