/* arsenal em primeira pessoa: materiais, modelos procedurais e registro */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export function createWeapons(deps) {
  const { camera } = deps;
const wm = { // materiais compartilhados do arsenal
  steel: new THREE.MeshStandardMaterial({ color: 0x343a42, metalness: 0.82, roughness: 0.3 }),
  black: new THREE.MeshStandardMaterial({ color: 0x16191e, metalness: 0.6, roughness: 0.44 }),
  poly:  new THREE.MeshStandardMaterial({ color: 0x2a2e35, metalness: 0.22, roughness: 0.62 }),
  wood:  new THREE.MeshStandardMaterial({ color: 0x6e4c2c, metalness: 0.05, roughness: 0.55 }),
  amber: new THREE.MeshStandardMaterial({ color: 0x2a1500, emissive: 0xff9a2e, emissiveIntensity: 1.5, roughness: 0.4 }),
  teal:  new THREE.MeshStandardMaterial({ color: 0x05201f, emissive: 0x2ee6c8, emissiveIntensity: 1.3, roughness: 0.4 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xc9a04e, metalness: 0.85, roughness: 0.35 }),
};

const weaponRoot = new THREE.Group();  // posição-alvo (hip/ADS) + sway + bob
const weaponKick = new THREE.Group();  // recoil (kick pra trás + rotação)
weaponRoot.add(weaponKick);
camera.add(weaponRoot);

/* helpers de construção de arma */
function wbox(parent, mat, w, h, d, x, y, z, o = {}) {
  const geo = o.r ? new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * o.r) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
  parent.add(m); return m;
}
function wcyl(parent, mat, r1, r2, len, x, y, z, o = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, o.seg || 12, 1, !!o.open), mat);
  m.rotation.x = o.rx !== undefined ? o.rx : Math.PI / 2; // padrão: eixo ao longo de Z (cano)
  if (o.rz) m.rotation.z = o.rz;
  m.position.set(x, y, z);
  parent.add(m); return m;
}

/* ---- FUZIL: receiver com trilho, ferrolho, guarda-mão ventilado ---- */
function buildRifle() {
  const g = new THREE.Group(), parts = {};
  wbox(g, wm.steel, 0.07, 0.105, 0.5, 0, 0, 0, { r: 0.3 });                 // receiver
  wbox(g, wm.black, 0.074, 0.026, 0.36, 0, 0.062, -0.08);                   // trilho superior
  for (let i = 0; i < 7; i++) wbox(g, wm.steel, 0.078, 0.011, 0.018, 0, 0.064, -0.24 + i * 0.05); // dentes
  wbox(g, wm.black, 0.014, 0.045, 0.1, 0.038, 0.005, 0.03);                 // janela de ejeção
  parts.bolt = wbox(g, wm.steel, 0.05, 0.016, 0.045, 0.05, 0.044, 0.12);    // alavanca do ferrolho
  wbox(g, wm.poly, 0.064, 0.078, 0.36, 0, 0.004, -0.42, { r: 0.35 });       // guarda-mão
  for (let i = 0; i < 4; i++) wbox(g, wm.black, 0.07, 0.012, 0.03, 0, -0.02, -0.3 - i * 0.07); // fendas
  wcyl(g, wm.steel, 0.016, 0.016, 0.42, 0, 0.028, -0.66);                   // cano
  wbox(g, wm.black, 0.03, 0.045, 0.035, 0, 0.045, -0.56);                   // bloco de gás
  wcyl(g, wm.black, 0.007, 0.007, 0.3, 0, 0.052, -0.42);                    // tubo de gás
  wcyl(g, wm.black, 0.024, 0.024, 0.085, 0, 0.028, -0.875, { seg: 8 });     // quebra-chama
  wbox(g, wm.black, 0.052, 0.012, 0.03, 0, 0.028, -0.875);                  // fendas do freio
  wbox(g, wm.black, 0.012, 0.05, 0.014, 0, 0.085, -0.8);                    // massa de mira
  wbox(g, wm.black, 0.04, 0.014, 0.03, 0, 0.062, -0.8);                     // base da massa
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.005, 8, 18), wm.black);
  ring.position.set(0, 0.0915, -0.06); g.add(ring);                          // alça de mira
  parts.mag = new THREE.Group(); parts.mag.position.set(0, -0.14, -0.05); parts.mag.rotation.x = 0.14;
  wbox(parts.mag, wm.poly, 0.05, 0.2, 0.1, 0, 0, 0, { r: 0.25 });           // carregador curvo
  wbox(parts.mag, wm.brass, 0.052, 0.024, 0.102, 0, -0.1, 0.012, { rx: 0.12 });
  g.add(parts.mag);
  wbox(g, wm.black, 0.04, 0.05, 0.018, 0, -0.07, 0.1);                      // gatilho/guarda
  wbox(g, wm.wood, 0.046, 0.12, 0.06, 0, -0.115, 0.17, { rx: 0.32, r: 0.3 });// empunhadura
  wbox(g, wm.poly, 0.06, 0.095, 0.26, 0, -0.012, 0.36, { r: 0.3 });         // coronha
  wbox(g, wm.black, 0.064, 0.115, 0.03, 0, -0.015, 0.49, { r: 0.3 });       // soleira
  wbox(g, wm.wood, 0.05, 0.03, 0.14, 0, 0.045, 0.36, { r: 0.4 });           // apoio de face
  wbox(g, wm.amber, 0.074, 0.01, 0.14, 0, 0.038, -0.18);                    // faixa luminosa
  // acessórios de mira intercambiáveis (tecla T)
  const reddot = new THREE.Group();
  wbox(reddot, wm.black, 0.05, 0.05, 0.07, 0, 0.1, -0.06, { r: 0.2 });
  const rdRing = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.006, 8, 14), wm.black);
  rdRing.position.set(0, 0.131, -0.06); reddot.add(rdRing);
  const rdDot = new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 5),
    new THREE.MeshStandardMaterial({ color: 0x200000, emissive: 0xff2222, emissiveIntensity: 4 }));
  rdDot.position.set(0, 0.131, -0.063); reddot.add(rdDot);
  reddot.visible = false; g.add(reddot);
  const scopeAtt = new THREE.Group();
  wbox(scopeAtt, wm.black, 0.026, 0.05, 0.04, 0, 0.095, -0.02);
  wcyl(scopeAtt, wm.black, 0.028, 0.028, 0.22, 0, 0.137, -0.05, { open: true });
  const sr1 = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.006, 8, 14), wm.black);
  sr1.position.set(0, 0.137, -0.16); scopeAtt.add(sr1);
  scopeAtt.visible = false; g.add(scopeAtt);
  parts.sights = [
    { name: 'Alça de ferro', fov: 55, ads: [0, -0.0915, -0.3] },
    { name: 'Red Dot', fov: 48, mesh: reddot, ads: [0, -0.131, -0.3] },
    { name: 'Luneta 2x', fov: 36, mesh: scopeAtt, ads: [0, -0.137, -0.24] },
  ];
  addHands(parts, g, [0.02, -0.1, 0.17], [0.32, 0, -1.5], g, [0, -0.078, -0.38], [0.15, 0, Math.PI]);
  const muzzleAnchor = new THREE.Group();
  muzzleAnchor.position.set(0, 0.028, -0.94);
  g.add(muzzleAnchor);
  return { group: g, parts, muzzleAnchor };
}

/* ---- ESCOPETA: cano + tubo, bomba (pump) animável, furniture de madeira ---- */
function buildShotgun() {
  const g = new THREE.Group(), parts = {};
  wbox(g, wm.steel, 0.075, 0.105, 0.4, 0, 0, 0.04, { r: 0.3 });             // receiver
  wbox(g, wm.black, 0.015, 0.04, 0.1, 0.04, -0.01, 0.04);                   // porta de carregamento
  wcyl(g, wm.steel, 0.02, 0.02, 0.54, 0, 0.045, -0.43);                     // cano
  wcyl(g, wm.black, 0.016, 0.016, 0.46, 0, -0.008, -0.4);                   // tubo de munição
  parts.pump = new THREE.Group(); parts.pump.position.set(0, -0.008, -0.38);
  wbox(parts.pump, wm.wood, 0.072, 0.062, 0.17, 0, 0, 0, { r: 0.35 });      // bomba
  for (let i = 0; i < 3; i++) wbox(parts.pump, wm.black, 0.075, 0.008, 0.02, 0, 0, -0.05 + i * 0.05);
  g.add(parts.pump);
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.007, 8, 6), wm.brass);
  bead.position.set(0, 0.075, -0.69); g.add(bead);                          // maçaneta de mira
  for (let i = 0; i < 3; i++) wcyl(g, wm.brass, 0.011, 0.011, 0.05, -0.045, 0.02, -0.02 + i * 0.06, { rx: 0, rz: Math.PI / 2, seg: 8 }); // cartuchos na lateral
  wbox(g, wm.black, 0.04, 0.05, 0.018, 0, -0.07, 0.13);                     // guarda-mato
  wbox(g, wm.wood, 0.05, 0.13, 0.07, 0, -0.1, 0.21, { rx: 0.42, r: 0.3 });  // pistol grip
  wbox(g, wm.wood, 0.062, 0.1, 0.27, 0, -0.035, 0.4, { rx: 0.06, r: 0.3 }); // coronha
  wbox(g, wm.black, 0.066, 0.12, 0.03, 0, -0.045, 0.53, { r: 0.3 });        // soleira
  wbox(g, wm.teal, 0.078, 0.01, 0.1, 0, 0.052, 0.04);                       // faixa luminosa
  addHands(parts, g, [0.02, -0.09, 0.22], [0.42, 0, -1.5], parts.pump, [0, -0.052, 0], [0, 0, Math.PI]);
  const muzzleAnchor = new THREE.Group();
  muzzleAnchor.position.set(0, 0.045, -0.73);
  g.add(muzzleAnchor);
  return { group: g, parts, muzzleAnchor };
}

/* ---- DMR: cano longo, luneta vazada (mira através do tubo), coronha esqueleto ---- */
function buildDMR() {
  const g = new THREE.Group(), parts = {};
  wbox(g, wm.steel, 0.07, 0.1, 0.56, 0, 0, 0.02, { r: 0.3 });               // receiver longo
  parts.bolt = wbox(g, wm.brass, 0.05, 0.016, 0.04, 0.05, 0.035, 0.1);      // ferrolho
  wbox(g, wm.poly, 0.06, 0.07, 0.4, 0, 0, -0.44, { r: 0.35 });              // guarda-mão fino
  wcyl(g, wm.steel, 0.014, 0.014, 0.62, 0, 0.026, -0.78);                   // cano longo
  for (let i = 0; i < 3; i++) wcyl(g, wm.black, 0.018, 0.018, 0.02, 0, 0.026, -0.62 - i * 0.14, { seg: 8 }); // anéis
  wcyl(g, wm.black, 0.026, 0.026, 0.1, 0, 0.026, -1.06, { seg: 8 });        // freio de boca
  // luneta: tubo aberto — dá pra mirar olhando através dele
  wbox(g, wm.black, 0.024, 0.05, 0.04, 0, 0.075, -0.08);                    // suporte traseiro
  wbox(g, wm.black, 0.024, 0.05, 0.04, 0, 0.075, 0.06);                     // suporte dianteiro
  wcyl(g, wm.black, 0.032, 0.032, 0.3, 0, 0.115, -0.02, { open: true });    // tubo
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.007, 8, 18), wm.black);
  ring1.position.set(0, 0.115, -0.18); g.add(ring1);                        // objetiva
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.033, 0.006, 8, 18), wm.black);
  ring2.position.set(0, 0.115, 0.14); g.add(ring2);                         // ocular
  wbox(g, wm.brass, 0.014, 0.026, 0.026, 0, 0.155, -0.02);                  // torre de ajuste
  parts.mag = new THREE.Group(); parts.mag.position.set(0, -0.12, -0.04);
  wbox(parts.mag, wm.poly, 0.05, 0.14, 0.09, 0, 0, 0, { r: 0.25 });
  wbox(parts.mag, wm.brass, 0.052, 0.02, 0.092, 0, -0.07, 0);
  g.add(parts.mag);
  wbox(g, wm.black, 0.04, 0.05, 0.018, 0, -0.07, 0.12);                     // guarda-mato
  wbox(g, wm.poly, 0.046, 0.13, 0.06, 0, -0.11, 0.2, { rx: 0.3, r: 0.3 });  // grip
  wbox(g, wm.poly, 0.05, 0.03, 0.3, 0, 0.0, 0.42);                          // braço da coronha
  wbox(g, wm.poly, 0.05, 0.14, 0.04, 0, -0.05, 0.56, { r: 0.3 });           // soleira esqueleto
  wbox(g, wm.poly, 0.044, 0.026, 0.12, 0, 0.045, 0.46, { r: 0.4 });         // apoio de face
  // bipé dobrado sob o cano
  wbox(g, wm.black, 0.012, 0.012, 0.16, 0.024, -0.045, -0.52, { rx: -0.5 });
  wbox(g, wm.black, 0.012, 0.012, 0.16, -0.024, -0.045, -0.52, { rx: -0.5 });
  wbox(g, wm.amber, 0.074, 0.01, 0.12, 0, 0.035, -0.3);                     // faixa luminosa
  addHands(parts, g, [0.02, -0.095, 0.22], [0.3, 0, -1.5], g, [0, -0.062, -0.42], [0.1, 0, Math.PI]);
  const muzzleAnchor = new THREE.Group();
  muzzleAnchor.position.set(0, 0.026, -1.12);
  g.add(muzzleAnchor);
  return { group: g, parts, muzzleAnchor };
}

/* ---- BAZUCA: tubo de ombro com ogiva visível ---- */
function buildBazooka() {
  const g = new THREE.Group(), parts = {};
  wcyl(g, wm.poly, 0.072, 0.072, 1.15, 0, 0.02, -0.08, { open: true });
  wcyl(g, wm.black, 0.082, 0.074, 0.13, 0, 0.02, 0.5, { seg: 12 });
  wcyl(g, wm.black, 0.076, 0.088, 0.11, 0, 0.02, -0.66, { seg: 12 });
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.13, 10), wm.amber);
  tip.rotation.x = -Math.PI / 2; tip.position.set(0, 0.02, -0.72); g.add(tip);
  wbox(g, wm.black, 0.05, 0.13, 0.06, 0, -0.1, 0.13, { rx: 0.3, r: 0.3 });
  wbox(g, wm.black, 0.05, 0.11, 0.05, 0, -0.09, -0.16, { rx: 0.2, r: 0.3 });
  wbox(g, wm.steel, 0.02, 0.08, 0.13, 0.055, 0.1, -0.02);
  wbox(g, wm.amber, 0.05, 0.012, 0.3, 0, 0.096, 0.12);
  addHands(parts, g, [0.02, -0.16, 0.14], [0.3, 0, -1.5], g, [0.02, -0.15, -0.15], [0.2, 0, Math.PI]);
  const muzzleAnchor = new THREE.Group();
  muzzleAnchor.position.set(0, 0.02, -0.82);
  g.add(muzzleAnchor);
  return { group: g, parts, muzzleAnchor };
}
/* ---- RIFLE DE PLASMA: corpo liso com células e emissor brilhante ---- */
function buildPlasma() {
  const g = new THREE.Group(), parts = {};
  wbox(g, wm.steel, 0.085, 0.125, 0.56, 0, 0, 0, { r: 0.35 });
  wbox(g, wm.teal, 0.09, 0.014, 0.4, 0, 0.045, -0.05);
  wbox(g, wm.teal, 0.09, 0.014, 0.4, 0, -0.045, -0.05);
  wcyl(g, wm.black, 0.03, 0.03, 0.3, 0, 0.01, -0.42, { seg: 10 });
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 6, 14), wm.teal);
    ring.position.set(0, 0.01, -0.36 - i * 0.09); g.add(ring);
  }
  const emit = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), wm.teal);
  emit.position.set(0, 0.01, -0.56); g.add(emit);
  parts.mag = new THREE.Group(); parts.mag.position.set(0, -0.11, 0.02);
  wbox(parts.mag, wm.black, 0.055, 0.12, 0.1, 0, 0, 0, { r: 0.3 });
  wbox(parts.mag, wm.teal, 0.058, 0.03, 0.08, 0, -0.02, 0);
  g.add(parts.mag);
  wbox(g, wm.black, 0.046, 0.12, 0.06, 0, -0.1, 0.17, { rx: 0.32, r: 0.3 });
  wbox(g, wm.poly, 0.06, 0.09, 0.2, 0, -0.01, 0.36, { r: 0.35 });
  addHands(parts, g, [0.02, -0.095, 0.19], [0.32, 0, -1.5], g, [0, -0.075, -0.3], [0.12, 0, Math.PI]);
  const muzzleAnchor = new THREE.Group();
  muzzleAnchor.position.set(0, 0.01, -0.6);
  g.add(muzzleAnchor);
  return { group: g, parts, muzzleAnchor };
}

/* ---- mãos em primeira pessoa: luva com 5 dedos articulados ---- */
const gloveMat = new THREE.MeshStandardMaterial({ color: 0x23261f, roughness: 0.72, metalness: 0.05 });
const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x3a4034, roughness: 0.8 });
const knuckleMat = new THREE.MeshStandardMaterial({ color: 0x151712, roughness: 0.6 });
function buildHand(mirror) {
  const h = new THREE.Group();
  h.add(new THREE.Mesh(new RoundedBoxGeometry(0.072, 0.034, 0.092, 2, 0.012), gloveMat)); // palma
  const kn = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.014, 0.042, 1, 0.006), knuckleMat);
  kn.position.set(0, 0.022, -0.016); h.add(kn);                                            // protetor
  for (let i = 0; i < 4; i++) { // 4 dedos, 2 falanges, curvados na pegada
    const f = new THREE.Group();
    f.position.set(-0.026 + i * 0.0174, -0.003, -0.046);
    f.rotation.x = -0.85 + i * 0.03;
    const s1 = new THREE.Mesh(new RoundedBoxGeometry(0.0155, 0.015, 0.038, 1, 0.006), gloveMat);
    s1.position.z = -0.017; f.add(s1);
    const f2 = new THREE.Group();
    f2.position.z = -0.036; f2.rotation.x = -1.05;
    const s2 = new THREE.Mesh(new RoundedBoxGeometry(0.0138, 0.0135, 0.033, 1, 0.005), gloveMat);
    s2.position.z = -0.014; f2.add(s2);
    f.add(f2); h.add(f);
  }
  const th = new THREE.Group(); // polegar opondo
  th.position.set(mirror ? 0.034 : -0.034, -0.005, -0.018);
  th.rotation.set(-0.5, mirror ? -0.95 : 0.95, 0);
  const t1 = new THREE.Mesh(new RoundedBoxGeometry(0.017, 0.016, 0.035, 1, 0.006), gloveMat);
  t1.position.z = -0.015; th.add(t1);
  const t2g = new THREE.Group(); t2g.position.z = -0.033; t2g.rotation.x = -0.7;
  const t2 = new THREE.Mesh(new RoundedBoxGeometry(0.0148, 0.014, 0.029, 1, 0.005), gloveMat);
  t2.position.z = -0.012; t2g.add(t2);
  th.add(t2g); h.add(th);
  const wrist = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.042, 4, 10), gloveMat);
  wrist.rotation.x = Math.PI / 2 - 0.5;
  wrist.position.set(0, -0.02, 0.062); h.add(wrist);
  const sleeve = new THREE.Mesh(new RoundedBoxGeometry(0.076, 0.07, 0.09, 2, 0.02), sleeveMat);
  sleeve.position.set(0, -0.046, 0.116);
  sleeve.rotation.x = -0.45; h.add(sleeve);
  return h;
}
function addHands(parts, g, rPos, rRot, lParent, lPos, lRot) {
  const hr = buildHand(false);
  hr.position.set(...rPos); hr.rotation.set(...rRot);
  g.add(hr); parts.handR = hr;
  const hl = buildHand(true);
  hl.position.set(...lPos); hl.rotation.set(...lRot);
  lParent.add(hl); parts.handL = hl;
  hl.userData.base = { p: hl.position.clone(), rx: hl.rotation.x, rz: hl.rotation.z };
}

/* ---- FACA: arma inicial do Battle Royale (melee, sem munição) ---- */
function buildKnife() {
  const g = new THREE.Group(), parts = {};
  wbox(g, wm.steel, 0.022, 0.085, 0.32, 0, 0.02, -0.25, { r: 0.4 });  // lâmina
  wbox(g, wm.steel, 0.014, 0.048, 0.11, 0, 0.046, -0.37, { r: 0.5 }); // ponta
  wbox(g, wm.brass, 0.072, 0.024, 0.03, 0, 0, -0.08);                 // guarda
  wbox(g, wm.wood, 0.034, 0.05, 0.16, 0, -0.004, 0.02, { r: 0.35 });  // cabo
  wbox(g, wm.black, 0.038, 0.054, 0.028, 0, -0.004, 0.11, { r: 0.4 });// pomo
  wbox(g, wm.amber, 0.024, 0.01, 0.2, 0, 0.055, -0.2);                // fio luminoso
  addHands(parts, g, [0.015, -0.055, 0.03], [0.25, 0, -1.45], g, [-0.24, -0.16, 0.28], [0.4, 0.6, Math.PI]);
  const muzzleAnchor = new THREE.Group();
  muzzleAnchor.position.set(0, 0.02, -0.4);
  g.add(muzzleAnchor);
  return { group: g, parts, muzzleAnchor };
}

/* ---- registro do arsenal ---- */
function makeWeapon(def, buildFn) {
  const { group, parts, muzzleAnchor } = buildFn();
  group.visible = false;
  weaponKick.add(group);
  if (parts.mag) parts.mag.userData.base = { y: parts.mag.position.y, rx: parts.mag.rotation.x };
  if (parts.bolt) parts.bolt.userData.z0 = parts.bolt.position.z;
  if (parts.pump) parts.pump.userData.z0 = parts.pump.position.z;
  return { ...def, group, parts, muzzleAnchor,
    hipV: new THREE.Vector3(...def.hip), adsV: new THREE.Vector3(...def.ads),
    mag: def.magSize, reserve: def.reserveStart, reloading: false, reloadEnd: 0, lastShot: -9, cycleT: 0 };
}
const arsenal = [
  makeWeapon({ name: 'FUZIL "VAGALUME"', auto: true, rpm: 690, dmg: 26, pellets: 1, magSize: 30, reserveStart: 150,
    reloadTime: 1.55, spreadHip: 0.014, spreadAds: 0.0022, recoilP: 0.62, recoilY: 0.16, kick: 0.055,
    adsFov: 55, hip: [0.26, -0.235, -0.5], ads: [0, -0.0915, -0.3] }, buildRifle),
  makeWeapon({ name: 'ESCOPETA "TROVÃO"', auto: false, rpm: 78, dmg: 11, pellets: 8, magSize: 6, reserveStart: 30,
    reloadTime: 2.3, spreadHip: 0.05, spreadAds: 0.032, recoilP: 1.9, recoilY: 0.3, kick: 0.15,
    adsFov: 62, hip: [0.27, -0.24, -0.46], ads: [0, -0.075, -0.36] }, buildShotgun),
  makeWeapon({ name: 'DMR "FALCÃO"', auto: false, rpm: 150, dmg: 72, pellets: 1, magSize: 8, reserveStart: 32,
    reloadTime: 1.9, spreadHip: 0.02, spreadAds: 0.0005, recoilP: 1.5, recoilY: 0.22, kick: 0.11,
    adsFov: 26, hip: [0.25, -0.23, -0.42], ads: [0, -0.115, -0.2] }, buildDMR),
  makeWeapon({ name: 'BAZUCA "TROVOADA"', auto: false, rpm: 30, dmg: 0, pellets: 1, magSize: 1, reserveStart: 4,
    reloadTime: 2.8, spreadHip: 0.02, spreadAds: 0.01, recoilP: 2.4, recoilY: 0.3, kick: 0.3,
    adsFov: 60, hip: [0.3, -0.2, -0.42], ads: [0.1, -0.07, -0.34], rocket: true, locked: true }, buildBazooka),
  makeWeapon({ name: 'PLASMA "VISITANTE"', auto: true, rpm: 430, dmg: 38, pellets: 1, magSize: 42, reserveStart: 210,
    reloadTime: 1.7, spreadHip: 0.012, spreadAds: 0.003, recoilP: 0.4, recoilY: 0.1, kick: 0.04,
    adsFov: 58, hip: [0.26, -0.235, -0.48], ads: [0, -0.083, -0.3], laser: true, locked: true }, buildPlasma),
  makeWeapon({ name: 'FACA "AURORA"', auto: false, rpm: 130, dmg: 34, pellets: 1, magSize: 1, reserveStart: 0,
    reloadTime: 0.8, spreadHip: 0, spreadAds: 0, recoilP: 0.3, recoilY: 0.06, kick: 0.07,
    adsFov: 66, hip: [0.3, -0.25, -0.48], ads: [0.16, -0.19, -0.4], melee: true, locked: true }, buildKnife),
];
  return { wm, weaponRoot, weaponKick, arsenal, knuckleMat };
}
