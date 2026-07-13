/* Biblioteca de animações do avatar online.
   Os FBX do Mixamo trazem somente esqueleto + clip; a malha continua sendo o
   Helldiver. O retarget é feito uma vez no molde e os AnimationClips resultantes
   são compartilhados por todos os jogadores (cada clone mantém seu próprio
   mixer/esqueleto). */
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { retargetClip } from 'three/addons/utils/SkeletonUtils.js';

export const PLAYER_ANIMATION_SPECS = Object.freeze([
  { name: 'crouchWalk', file: '/assets/animations/Andando Agachado.fbx', loop: true },
  { name: 'walk', file: '/assets/animations/Andando.fbx', loop: true },
  { name: 'death', file: '/assets/animations/Animação de morte.fbx', loop: false },
  { name: 'land', file: '/assets/animations/aterrissando no chão.fbx', loop: false },
  { name: 'fall', file: '/assets/animations/caindo.fbx', loop: true },
  { name: 'run', file: '/assets/animations/Correndo.fbx', loop: true },
  { name: 'fireRifle', file: '/assets/animations/Fuzil/atirando com fuzil.fbx', loop: false },
  { name: 'idleRifle', file: '/assets/animations/Fuzil/parado com fuzil na mão.fbx', loop: true },
  { name: 'firePistol', file: '/assets/animations/pistola/atirando com pistola.fbx', loop: false },
  { name: 'jump', file: '/assets/animations/Pulando.fbx', loop: false },
  { name: 'idleShotgun', file: '/assets/animations/Shotgun/parado com a shotgun na mão.fbx', loop: true },
]);

/* GLTFLoader sanitiza os pontos dos nomes Blender (Sholder.L -> SholderL).
   O mapa é alvo -> fonte, exatamente como SkeletonUtils.retargetClip espera. */
export const HELLDIVER_TO_MIXAMO = Object.freeze({
  Torso_49: 'mixamorigHips',
  Chest_40: 'mixamorigSpine2',
  Head_0: 'mixamorigHead',

  SholderL_14: 'mixamorigLeftShoulder',
  Arm_1L_13: 'mixamorigLeftArm',
  Arm_2L_12: 'mixamorigLeftForeArm',
  HandL_11: 'mixamorigLeftHand',
  SholderR_27: 'mixamorigRightShoulder',
  Arm_1R_26: 'mixamorigRightArm',
  Arm_2R_25: 'mixamorigRightForeArm',
  HandR_24: 'mixamorigRightHand',

  PelvisL_44: 'mixamorigLeftUpLeg',
  Leg_1L_43: 'mixamorigLeftLeg',
  Leg_2L_42: 'mixamorigLeftFoot',
  BootL_41: 'mixamorigLeftToeBase',
  PelvisR_48: 'mixamorigRightUpLeg',
  Leg_1R_47: 'mixamorigRightLeg',
  Leg_2R_46: 'mixamorigRightFoot',
  BootR_45: 'mixamorigRightToeBase',

  Finger_1L_2: 'mixamorigLeftHandIndex1',
  Finger_2L_1: 'mixamorigLeftHandIndex3',
  Finger_9L_10: 'mixamorigLeftHandThumb1',
  Finger_10L_9: 'mixamorigLeftHandThumb3',
  Finger_1R_16: 'mixamorigRightHandIndex1',
  Finger_2R_15: 'mixamorigRightHandIndex3',
  Finger_9R_23: 'mixamorigRightHandThumb1',
  Finger_10R_22: 'mixamorigRightHandThumb3',
});

const loader = new FBXLoader();
const zeroHip = new THREE.Vector3(0, 0, 0);
let sourceLoadCount = 0;

async function loadSource(spec) {
  /* encodeURI conserva as barras e protege espaços/acentos no fetch. */
  const source = await loader.loadAsync(encodeURI(spec.file));
  const bones = [];
  source.traverse(node => { if (node.isBone) bones.push(node); });
  if (!source.animations.length || !bones.length)
    throw new Error(`FBX sem clip/esqueleto: ${spec.file}`);
  source.skeleton = new THREE.Skeleton(bones);
  source.updateMatrixWorld(true);
  sourceLoadCount++;
  return source;
}

function firstSkinnedMesh(root) {
  let result = null;
  root.traverse(node => { if (!result && node.isSkinnedMesh) result = node; });
  return result;
}

function poseMinY(root, skeleton) {
  root.updateWorldMatrix(true, true);
  skeleton.update();
  const box = new THREE.Box3();
  const meshBox = new THREE.Box3();
  root.traverse(node => {
    if (!node.isSkinnedMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    /* A capa longa não deve ser o ponto de apoio do cadáver; corpo/armadura
       definem o contato real com o chão. */
    if (materials.length && materials.every(material => /cloth/i.test(material?.name || ''))) return;
    node.computeBoundingBox();
    meshBox.copy(node.boundingBox).applyMatrix4(node.matrixWorld);
    box.union(meshBox);
  });
  return Number.isFinite(box.min.y) ? box.min.y : 0;
}

function addVisualGroundingTrack(root, target, clip) {
  target.skeleton.pose();
  const baseMinY = poseMinY(root, target.skeleton);
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const frameCount = Math.max(2, Math.round(clip.duration * 30) + 1);
  const times = new Float32Array(frameCount);
  const values = new Float32Array(frameCount * 3);
  for (let frame = 0; frame < frameCount; frame++) {
    const time = clip.duration * frame / (frameCount - 1);
    mixer.setTime(time);
    const correction = baseMinY - poseMinY(root, target.skeleton);
    times[frame] = time;
    values[frame * 3 + 1] = correction;
  }
  action.stop();
  mixer.uncacheRoot(root);
  target.skeleton.pose();
  root.updateMatrixWorld(true);
  clip.tracks.push(new THREE.VectorKeyframeTrack('CharacterPoseOffset.position', times, values));
}

/* Recebe um clone de calibração, porque retargetClip posa o alvo enquanto
   amostra cada frame. A malha exibida nunca é tocada durante a conversão. */
export async function retargetPlayerAnimations(calibrationRoot) {
  const target = firstSkinnedMesh(calibrationRoot);
  if (!target || !target.skeleton) throw new Error('Helldiver sem SkinnedMesh para retarget');
  for (const boneName of Object.keys(HELLDIVER_TO_MIXAMO)) {
    if (!target.skeleton.getBoneByName(boneName))
      throw new Error(`Osso obrigatório ausente no Helldiver: ${boneName}`);
  }

  const sources = await Promise.all(PLAYER_ANIMATION_SPECS.map(loadSource));
  const clips = {};
  try {
    for (let i = 0; i < PLAYER_ANIMATION_SPECS.length; i++) {
      const spec = PLAYER_ANIMATION_SPECS[i];
      const source = sources[i];
      let clip = retargetClip(target, source, source.animations[0], {
        names: HELLDIVER_TO_MIXAMO,
        hip: 'mixamorigHips',
        hipInfluence: zeroHip,
        preserveBoneMatrix: true,
        preserveBonePositions: true,
        fps: 30,
      });

      /* A posição do quadril nos FBX inclui root motion forte (principalmente
         pouso/morte). Física, hitbox e rede são as únicas donas da posição. */
      clip.tracks = clip.tracks.filter(track => track.name.endsWith('.quaternion'));
      for (const track of clip.tracks) {
        /* O mixer do personagem é enraizado no Group do GLB, não no SkinnedMesh.
           Nomear o osso diretamente faz PropertyBinding encontrá-lo no subtree. */
        track.name = track.name.replace(/^\.bones\[([^\]]+)\]/, '$1');
      }
      clip.name = spec.name;
      clip.resetDuration();
      /* Pouso e morte rotacionam o corpo até o chão. Uma trilha aplicada ao
         offset VISUAL mantém o ponto mais baixo apoiado sem mover root/hitbox. */
      if (spec.name === 'land' || spec.name === 'death') addVisualGroundingTrack(calibrationRoot, target, clip);
      clips[spec.name] = clip;
      target.skeleton.pose();
      calibrationRoot.updateMatrixWorld(true);
    }
  } finally {
    target.skeleton.pose();
    calibrationRoot.updateMatrixWorld(true);
  }
  return clips;
}

export function playerAnimationDebug() {
  return {
    assets: PLAYER_ANIMATION_SPECS.map(spec => ({ ...spec })),
    mappedBones: Object.keys(HELLDIVER_TO_MIXAMO),
    sourceLoadCount,
  };
}
