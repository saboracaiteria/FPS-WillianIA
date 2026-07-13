/* Contratos das animações Mixamo e teste vivo do retarget no Helldiver. */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CHROME, bootGame } = require('./helpers/harness.js');

const ROOT = path.join(__dirname, '..');
const ANIM_DIR = path.join(ROOT, 'assets', 'Animações');
const files = fs.readdirSync(ANIM_DIR, { withFileTypes: true }).flatMap(entry => {
  if (entry.isFile()) return entry.name.endsWith('.fbx') ? [entry.name] : [];
  return fs.readdirSync(path.join(ANIM_DIR, entry.name))
    .filter(name => name.endsWith('.fbx'))
    .map(name => path.join(entry.name, name));
});

describe('Assets Mixamo do personagem', () => {
  it('possui exatamente os 11 FBX organizados e clips válidos', async () => {
    assert.equal(files.length, 11);
    const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
    const loader = new FBXLoader();
    for (const relative of files) {
      const file = path.join(ANIM_DIR, relative);
      const buf = fs.readFileSync(file);
      assert.ok(buf.length > 1000, `arquivo vazio: ${relative}`);
      const source = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), ANIM_DIR + path.sep);
      assert.equal(source.animations.length, 1, `${relative} deveria ter um clip`);
      const clip = source.animations[0];
      assert.ok(clip.duration > 0.1 && clip.duration < 10, `${relative} duração inválida`);
      for (const track of clip.tracks) {
        for (const value of track.values) assert.ok(Number.isFinite(value), `${relative} possui NaN`);
      }
    }
  });
});

describe('Retarget online do Helldiver', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h;
  before(async () => { h = await bootGame({ port: 3251 }); });
  after(async () => { if (h) await h.close(); });

  it('publica os FBX e aplica os estados sem root motion', async () => {
    const result = await h.play(async () => {
      const G = window.__game;
      const files = G.Chars.playerAnimationDebug().assets;
      const http = await Promise.all(files.map(async spec => {
        const response = await fetch(encodeURI(spec.file));
        return { file: spec.file, status: response.status, size: (await response.arrayBuffer()).byteLength };
      }));
      const mold = await G.Chars.character('/assets/models/Personagens/low_poly_helldiver_rig.glb', {
        height: 1.9, yaw: Math.PI, animations: 'mixamo-player',
      });
      const rig = mold.build();
      const animator = rig.humanoidAnimator();
      const root = rig.root.position.clone();
      const arm = rig.findNode('Arm_1.L');
      const bindArm = arm.quaternion.clone();
      const states = [];
      const tick = (label, speed, state, count = 4) => {
        for (let i = 0; i < count; i++) animator.update(0.05, speed, i * 0.05, state);
        states.push({ label, state: animator.state, arm: bindArm.angleTo(arm.quaternion) });
      };
      tick('idle', 0, { grounded: true, weapon: 0, shotSeq: 0 });
      tick('walk', 4, { grounded: true, weapon: 0, shotSeq: 0 });
      tick('run', 8, { grounded: true, weapon: 0, shotSeq: 0 });
      tick('crouch', 2, { grounded: true, crouch: true, weapon: 0, shotSeq: 0 });
      tick('jump', 2, { grounded: false, velY: 6, weapon: 0, shotSeq: 0 });
      tick('fall', 2, { grounded: false, velY: -8, weapon: 0, shotSeq: 0 });
      animator.update(0.05, 2, 0, { grounded: false, velY: -8, weapon: 0, shotSeq: 0 });
      tick('land', 0, { grounded: true, velY: 0, weapon: 0, shotSeq: 0 }, 1);
      tick('fire', 0, { grounded: true, weapon: 0, shotSeq: 1 }, 1);
      tick('death', 0, { grounded: true, dead: true, weapon: 0, shotSeq: 1 });
      const clips = rig.animationClips.map(clip => ({
        name: clip.name,
        tracks: clip.tracks.length,
        bad: clip.tracks.filter(track => track.name.includes('mixamorig') ||
          (!track.name.endsWith('.quaternion') && track.name !== 'CharacterPoseOffset.position'))
          .map(track => track.name),
      }));
      const second = mold.build();
      const secondAnimator = second.humanoidAnimator();
      secondAnimator.update(0.1, 8, 0, { grounded: true, weapon: 0, shotSeq: 0 });
      const isolated = arm.quaternion.angleTo(second.findNode('Arm_1.L').quaternion);
      const output = { http, states, clips, actionNames: Object.keys(rig.actions), root: root.distanceTo(rig.root.position), isolated };
      rig.dispose();
      second.dispose();
      return output;
    });
    assert.ok(result.http.every(item => item.status === 200 && item.size > 1000));
    assert.deepEqual(result.states.map(item => item.state), [
      'idleRifle', 'walk', 'run', 'crouchWalk', 'jump', 'fall', 'land', 'fireRifle', 'death',
    ]);
    assert.equal(result.clips.length, 11);
    assert.ok(result.clips.every(clip => clip.tracks >= 27 && clip.bad.length === 0));
    assert.ok(result.actionNames.includes('idleShotgun'));
    assert.ok(result.root < 1e-8, `root moveu ${result.root}`);
    assert.ok(result.isolated > 0.01, 'os mixers dos jogadores deveriam ser independentes');
    assert.deepEqual(h.pageErrors, []);
  });
});
