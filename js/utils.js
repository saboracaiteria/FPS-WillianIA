/* utilidades puras + temporarios compartilhados (evita alocacao no loop) */
import * as THREE from 'three';

export const clamp  = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp   = (a, b, t) => a + (b - a) * t;
// suavização exponencial independente de framerate
export const damp   = (cur, target, k, dt) => lerp(cur, target, 1 - Math.exp(-k * dt));
export const rand   = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const TAU = Math.PI * 2;

export const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
export const _q1 = new THREE.Quaternion();
export const _m1 = new THREE.Matrix4();
export const chaseCamPos = new THREE.Vector3();
export const chaseLook = new THREE.Vector3();
