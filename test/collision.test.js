/* ================================================================
   QA — testes de COLISÃO (todas as camadas do sistema).
   Chrome headless + tick manual (determinístico, seed fixa).
   Camadas: parede AABB (4 lados + expulsão de dentro), andares,
   obstáculos círculo (árvores), veículo vs parede (física CANNON),
   heli vs chão, balas e explosões vs parede, limites do mundo,
   empurrão entre jogadores (com um bot de rede REAL).
   ================================================================ */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { CHROME, bootGame } = require('./helpers/harness');

const PORT = 3196;

describe('Colisões', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h;
  before(async () => { h = await bootGame({ port: PORT }); });
  after(async () => { if (h) await h.close(); });
  const play = (fn, ...args) => h.play(fn, ...args);

  /* acha um PRÉDIO "testável": footprint grande, alto, com chão de TERRENO
     plano e livre (sem plataforma/telhado vizinho) nos dois lados de x */
  const findWall = `(function () {
    const QA = window.QA, S = QA.G.Structures, MP = QA.MP;
    return S.walls.find(w => {
      if (w.noCollide) return false;
      if ((w.x1 - w.x0) < 8 || (w.z1 - w.z0) < 8 || (w.y1 - w.y0) < 8) return false;
      const cz = (w.z0 + w.z1) / 2;
      for (const x of [w.x0 - 3, w.x1 + 3]) {
        const ter = MP.heightAt(x, cz);
        const g = MP.groundAt(x, cz, 999);
        if (Math.abs(g - ter) > 0.5) return false;        // aproximação em cima de telhado vizinho
        if (Math.abs(ter - w.y0) > 0.8) return false;     // base do prédio no chão
        if (w.y1 < ter + 6) return false;                 // alto o bastante
      }
      return true;
    });
  })()`;

  it('dada uma parede, então nenhum dos 4 lados é atravessável', async t => {
    const r = await play((fw) => {
      const QA = window.QA, P = QA.MP.player;
      const b = eval(fw);
      if (!b) return null;
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, cy = (b.y0 + b.y1) / 2;
      const lados = [
        { de: [b.x0 - 2.5, cz], eixo: 'x', limite: b.x0, sinal: -1 },
        { de: [b.x1 + 2.5, cz], eixo: 'x', limite: b.x1, sinal: +1 },
        { de: [cx, b.z0 - 2.5], eixo: 'z', limite: b.z0, sinal: -1 },
        { de: [cx, b.z1 + 2.5], eixo: 'z', limite: b.z1, sinal: +1 },
      ];
      const out = [];
      for (const L of lados) {
        QA.reset(L.de[0], L.de[1]);
        QA.aimAt(cx, cy, cz);
        QA.G.keys.KeyW = true;
        QA.tick(100);
        const v = L.eixo === 'x' ? P.pos.x : P.pos.z;
        const distFace = Math.abs(v - L.limite);
        // do lado negativo o jogador deve ficar <= limite; do positivo, >=
        out.push({ lado: `${L.eixo}${L.sinal > 0 ? '+' : '-'}`,
          ok: L.sinal < 0 ? v <= L.limite - P.radius + 0.2 : v >= L.limite + P.radius - 0.2,
          chegou: distFace < 1.6, // sem isto, ficar preso longe = falso positivo
          v: +v.toFixed(2), limite: +L.limite.toFixed(2) });
      }
      return out;
    }, findWall);
    if (!r) { t.skip('pré-condição não encontrada nesta seed'); return; }
    for (const L of r) {
      assert.ok(L.chegou, `jogador nem chegou na parede pelo lado ${L.lado} (pos=${L.v}) — teste vazio`);
      assert.ok(L.ok, `atravessou pelo lado ${L.lado}: pos=${L.v} limite=${L.limite}`);
    }
  });

  it('dado um jogador teleportado pra DENTRO da parede, então é expelido', async t => {
    const r = await play((fw) => {
      const QA = window.QA, P = QA.MP.player;
      const b = eval(fw);
      if (!b) return null;
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      QA.reset(b.x0 - 3, cz);
      P.pos.x = cx; P.pos.z = cz; P.pos.y = b.y0 + 0.1; // centro do bloco
      QA.tick(10);
      const dentro = P.pos.x > b.x0 + P.radius - 0.05 && P.pos.x < b.x1 - P.radius + 0.05 &&
                     P.pos.z > b.z0 + P.radius - 0.05 && P.pos.z < b.z1 - P.radius + 0.05;
      return { dentro, pos: [+P.pos.x.toFixed(2), +P.pos.z.toFixed(2)] };
    }, findWall);
    if (!r) { t.skip('pré-condição não encontrada nesta seed'); return; }
    assert.ok(!r.dentro, `continuou dentro da parede em ${r.pos}`);
  });

  it('dado um andar de prédio (floorY), então o jogador pousa nele — não no terreno', async t => {
    const r = await play(() => {
      const QA = window.QA, P = QA.MP.player;
      const camp = (QA.G.Structures.enemyCamps || []).find(c => c.floorY !== undefined &&
        c.floorY > QA.MP.heightAt(c.x, c.z) + 1.5);
      if (!camp) return null;
      QA.reset(camp.x, camp.z);
      P.pos.set(camp.x, camp.floorY + 2, camp.z);
      P.onGround = false; P.vel.set(0, 0, 0);
      QA.tick(120);
      return { y: P.pos.y, floorY: camp.floorY, terreno: QA.MP.heightAt(camp.x, camp.z) };
    });
    if (!r) { t.skip('pré-condição não encontrada nesta seed'); return; }
    assert.ok(Math.abs(r.y - r.floorY) < 0.7,
      `não pousou no andar: y=${r.y.toFixed(2)} andar=${r.floorY.toFixed(2)} terreno=${r.terreno.toFixed(2)}`);
  });

  it('dada uma árvore/pedra, então o círculo de colisão empurra o jogador', async t => {
    const r = await play(() => {
      const QA = window.QA, P = QA.MP.player, G = QA.G;
      // acha um obstáculo varrendo o mapa (grade de 16m)
      let ob = null, ox = 0, oz = 0;
      busca: for (let x = -400; x <= 400; x += 40)
        for (let z = -400; z <= 400; z += 40) {
          const list = G.obstaclesNear(x, z);
          if (list.length) {
            ob = list[0]; ox = ob.x; oz = ob.z;
            if (QA.MP.slopeAt(ox, oz) < 0.4) break busca;
            ob = null;
          }
        }
      if (!ob) return null;
      QA.reset(ox - 4, oz);
      QA.aimAt(ox, P.pos.y + 1.5, oz);
      QA.G.keys.KeyW = true;
      QA.tick(90);
      const d = Math.hypot(P.pos.x - ox, P.pos.z - oz);
      return { d, min: ob.r + P.radius };
    });
    if (!r) { t.skip('pré-condição não encontrada nesta seed'); return; }
    assert.ok(r.d < r.min + 1.4, `jogador nem chegou na árvore (d=${r.d.toFixed(2)}) — teste vazio`);
    assert.ok(r.d >= r.min - 0.15, `entrou na árvore: d=${r.d.toFixed(2)} mínimo=${r.min.toFixed(2)}`);
  });

  it('dado um carro parado, então o jogador não passa por dentro dele', async t => {
    const r = await play(() => {
      const QA = window.QA, P = QA.MP.player, car = QA.G.Car.group.position;
      // aproxima por -z: o caminho por -x roçava na fogueira do acampamento,
      // que desviava o jogador ANTES do carro (falso-positivo pego por mutação)
      QA.reset(car.x, car.z - 7);
      QA.aimAt(car.x, car.y + 1, car.z);
      QA.G.keys.KeyW = true;
      // amostra a distância MÍNIMA no caminho: só olhar a posição final deixa
      // passar quem ATRAVESSA o carro e para do outro lado (pego por mutação)
      let minD = 1e9;
      for (let i = 0; i < 120; i++) {
        QA.tick(1);
        minD = Math.min(minD, Math.hypot(P.pos.x - car.x, P.pos.z - car.z));
      }
      return { minD };
    });
    assert.ok(r.minD < 3.2, `jogador nem chegou no carro (minD=${r.minD.toFixed(2)}m) — teste vazio`);
    assert.ok(r.minD > 1.5, `entrou/atravessou o chassi: minD=${r.minD.toFixed(2)}m`);
  });

  it('dado um carro em disparada contra um prédio, então a física barra o carro', async t => {
    const r = await play((fw) => {
      const QA = window.QA, G = QA.G;
      const b = eval(fw);
      if (!b) return null;
      const cz = (b.z0 + b.z1) / 2;
      const v = G.Car.vehicles[0];
      // posiciona o carro 14m antes da parede, de frente pra ela (+x)
      v.chassisBody.position.set(b.x0 - 14, QA.MP.heightAt(b.x0 - 14, cz) + 1.2, cz);
      v.chassisBody.quaternion.setFromAxisAngle(new QA.MP.THREE.Vector3(0, 1, 0), 0); // frente = +x
      v.chassisBody.velocity.set(0, 0, 0);
      v.chassisBody.angularVelocity.set(0, 0, 0);
      v.chassisBody.wakeUp();
      const P = QA.MP.player;
      QA.reset(b.x0 - 16, cz);
      P.pos.set(v.chassisBody.position.x - 3, QA.MP.heightAt(v.chassisBody.position.x - 3, cz), cz);
      QA.tick(2);
      G.Car.setCur(v);
      G.state.driving = true;
      G.keys.KeyW = true;
      // 4s de acelerador; a cada tick verifica se o chassi PENETROU o bloco
      // (só olhar a posição final deixaria passar um desvio legítimo pela lateral)
      let penetrou = false;
      for (let i = 0; i < 240; i++) {
        QA.tick(1);
        const c = v.chassisBody.position;
        if (c.x > b.x0 + 0.7 && c.x < b.x1 - 0.7 &&
            c.z > b.z0 + 0.7 && c.z < b.z1 - 0.7 &&
            c.y > b.y0 - 0.5 && c.y < b.y1 + 0.5) { penetrou = true; break; }
      }
      G.keys.KeyW = false;
      G.state.driving = false;
      return { passou: penetrou, x: +v.chassisBody.position.x.toFixed(2), limite: +b.x0.toFixed(2) };
    }, findWall);
    if (!r) { t.skip('pré-condição não encontrada nesta seed'); return; }
    assert.ok(!r.passou, `carro atravessou o prédio: x=${r.x} parede=[${r.limite}..]`);
  });

  it('dado um carro caindo no telhado de um prédio, então ele PARA no telhado (regressão do AABB)', async t => {
    const r = await play(() => {
      const QA = window.QA, W = QA.MP.world;
      const wb = W.bodies.find(bd => bd.mass === 0 && bd.shapes[0] && bd.shapes[0].halfExtents &&
        bd.shapes[0].halfExtents.y > 8);
      if (!wb) return null;
      const topo = wb.position.y + wb.shapes[0].halfExtents.y;
      const v = QA.G.Car.vehicles[0];
      v.chassisBody.position.set(wb.position.x, topo + 12, wb.position.z);
      v.chassisBody.velocity.set(0, 0, 0); v.chassisBody.angularVelocity.set(0, 0, 0);
      v.chassisBody.wakeUp();
      QA.tick(360);
      return { y: +v.chassisBody.position.y.toFixed(2), topo: +topo.toFixed(2) };
    });
    if (!r) { t.skip('pré-condição não encontrada nesta seed'); return; }
    assert.ok(r.y > r.topo - 1, `carro atravessou o prédio na vertical: y=${r.y} telhado=${r.topo}`);
  });

  it('dado um carro contra uma árvore, então o tronco segura o carro (regressão do AABB)', async t => {
    const r = await play(() => {
      const QA = window.QA, W = QA.MP.world, G = QA.G;
      // tronco: Box estático baixinho
      const tb = W.bodies.find(bd => bd.mass === 0 && bd.shapes[0] && bd.shapes[0].halfExtents &&
        bd.shapes[0].halfExtents.y < 3 && bd.shapes[0].halfExtents.x < 1);
      if (!tb) return null;
      const v = G.Car.vehicles[0];
      const tx = tb.position.x, tz = tb.position.z;
      v.chassisBody.position.set(tx - 12, QA.MP.heightAt(tx - 12, tz) + 1.2, tz);
      v.chassisBody.quaternion.setFromAxisAngle(new QA.MP.THREE.Vector3(0, 1, 0), 0);
      v.chassisBody.velocity.set(0, 0, 0); v.chassisBody.angularVelocity.set(0, 0, 0);
      v.chassisBody.wakeUp();
      G.Car.setCur(v);
      G.state.driving = true;
      G.keys.KeyW = true;
      let penetrou = false;
      for (let i = 0; i < 200; i++) {
        QA.tick(1);
        const c = v.chassisBody.position;
        if (Math.hypot(c.x - tx, c.z - tz) < 0.35) { penetrou = true; break; }
      }
      G.keys.KeyW = false;
      G.state.driving = false;
      return { penetrou };
    });
    if (!r) { t.skip('pré-condição não encontrada nesta seed'); return; }
    assert.ok(!r.penetrou, 'carro passou por DENTRO do tronco');
  });

  it('dado o helicóptero descendo com tudo, então ele não afunda no terreno', async t => {
    const r = await play(() => {
      const QA = window.QA, G = QA.G, P = QA.MP.player;
      QA.reset();
      const hp = G.Heli.group.position;
      P.pos.set(hp.x + 2, hp.y, hp.z);
      QA.tick(1);
      G.tryToggleCar(); // entra no heli
      if (!G.state.flying) return null;
      G.keys.Space = true; QA.tick(120); G.keys.Space = false;      // sobe
      G.keys.ControlLeft = true; QA.tick(600); G.keys.ControlLeft = false; // desce 10s
      const gy = QA.MP.groundAt(hp.x, hp.z, hp.y);
      const acima = G.Heli.group.position.y >= gy + 0.3;
      G.tryToggleCar(); // sai
      return { acima, y: +G.Heli.group.position.y.toFixed(2), chao: +gy.toFixed(2) };
    });
    if (!r) { t.skip('pré-condição não encontrada nesta seed'); return; }
    assert.ok(r.acima, `heli afundou: y=${r.y} chão=${r.chao}`);
  });

  it('dada uma parede entre atirador e alvo, então a bala NÃO atravessa', async t => {
    const r = await play((fw) => {
      const QA = window.QA, G = QA.G;
      const b = eval(fw);
      if (!b) return null;
      const cz = (b.z0 + b.z1) / 2;
      const e = G.Enemies.list.find(x => x.alive);
      if (!e) return null;
      // inimigo 5m depois da parede; atirador 5m antes
      e.group.position.set(b.x1 + 5, QA.MP.heightAt(b.x1 + 5, cz), cz);
      QA.reset(b.x0 - 5, cz);
      G.switchWeapon(0);
      G.gun.mag = G.gun.magSize; G.gun.reloading = false;
      const hp0 = e.health;
      QA.aimAt(e.group.position.x, e.group.position.y + 1.1, e.group.position.z);
      G.mouse.aiming = true;
      QA.tick(3);
      G.mouse.shooting = true; G.mouse.clicked = true;
      QA.tick(12);
      G.mouse.shooting = false; G.mouse.aiming = false;
      e.group.position.set(-450, QA.MP.heightAt(-450, -450), -450);
      return { hp0, hp1: e.health };
    }, findWall);
    if (!r) { t.skip('pré-condição não encontrada nesta seed'); return; }
    assert.equal(r.hp1, r.hp0, `bala atravessou a parede (hp ${r.hp0} -> ${r.hp1})`);
  });

  it('dado segBlocked, então enxerga paredes e ignora campo aberto', async t => {
    const r = await play((fw) => {
      const QA = window.QA, S = QA.G.Structures, THREE = QA.MP.THREE;
      const b = eval(fw);
      if (!b) return null;
      const cz = (b.z0 + b.z1) / 2, cy = (b.y0 + b.y1) / 2;
      const atravessa = S.segBlocked(new THREE.Vector3(b.x0 - 2, cy, cz), new THREE.Vector3(b.x1 + 2, cy, cz));
      const aberto = S.segBlocked(new THREE.Vector3(30, 60, 30), new THREE.Vector3(40, 60, 40));
      return { atravessa, aberto };
    }, findWall);
    if (!r) { t.skip('pré-condição não encontrada nesta seed'); return; }
    assert.ok(r.atravessa, 'segBlocked não viu a parede');
    assert.ok(!r.aberto, 'segBlocked bloqueou campo aberto');
  });

  it('dada uma explosão do outro lado da parede, então o splash NÃO vaza pro alvo', async t => {
    const r = await play((fw) => {
      const QA = window.QA, G = QA.G;
      const b = eval(fw);
      if (!b) return null;
      const cz = (b.z0 + b.z1) / 2;
      const e = G.Enemies.list.find(x => x.alive);
      if (!e) return null;
      e.group.position.set(b.x1 + 2.5, QA.MP.heightAt(b.x1 + 2.5, cz), cz);
      e.health = 100;
      QA.reset(b.x0 - 8, cz);
      // granada explode 2m antes da parede — alvo BEM dentro do raio de 7.5m
      const p = new QA.MP.THREE.Vector3(b.x0 - 2, QA.MP.heightAt(b.x0 - 2, cz) + 0.6, cz);
      G.Grenades.explode(p);
      const atras = e.health;
      // controle: mesma distância SEM parede no meio — tem que ferir
      e.health = 100;
      e.group.position.set(p.x + 5, QA.MP.heightAt(p.x + 5, cz + 20), cz + 20);
      const p2 = new QA.MP.THREE.Vector3(e.group.position.x - 5, e.group.position.y + 0.6, e.group.position.z);
      G.Grenades.explode(p2);
      const aberto = e.health;
      e.group.position.set(-450, QA.MP.heightAt(-450, -450), -450);
      return { atras, aberto };
    }, findWall);
    if (!r) { t.skip('pré-condição não encontrada nesta seed'); return; }
    assert.ok(r.aberto < 100, 'controle falhou: explosão em campo aberto não feriu');
    assert.equal(r.atras, 100, `splash vazou pela parede (hp ficou ${r.atras})`);
  });

  it('dado um telhado de prédio da cidade, então dá pra POUSAR nele (pisável)', async t => {
    const r = await play((fw) => {
      const QA = window.QA, P = QA.MP.player;
      const b = eval(fw);
      if (!b) return null;
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      QA.reset(b.x0 - 3, cz);
      P.pos.set(cx, b.y1 + 5, cz); // 5m acima do telhado
      P.onGround = false; P.vel.set(0, 0, 0);
      QA.tick(240);
      return { y: +P.pos.y.toFixed(2), telhado: +b.y1.toFixed(2) };
    }, findWall);
    if (!r) { t.skip('pré-condição não encontrada nesta seed'); return; }
    assert.ok(Math.abs(r.y - r.telhado) < 0.8,
      `não pousou no telhado: y=${r.y} telhado=${r.telhado} (caiu/foi cuspido)`);
  });

  it('dada uma granada jogada em cima do prédio, então ela quica e explode LÁ EM CIMA', async t => {
    const r = await play((fw) => {
      const QA = window.QA, G = QA.G, P = QA.MP.player;
      const b = eval(fw);
      if (!b) return null;
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      QA.reset(b.x0 - 3, cz);
      P.pos.set(cx, b.y1, cz);
      P.onGround = true; P.vel.set(0, 0, 0);
      QA.tick(3);
      if (Math.abs(P.pos.y - b.y1) > 1.5) return { skip: 'telhado não pisável ainda' };
      P.health = 100; P.armor = 0; P.invulnUntil = 0;
      G.inventory.nades = 1;
      QA.aimAt(P.pos.x + 0.5, P.pos.y + 0.1, P.pos.z); // pra baixo: quica no lugar e explode do lado
      QA.MP.justPressed.add('KeyG');
      QA.tick(1);
      QA.tick(280); // voo + fuse
      return { dano: +(100 - P.health).toFixed(1) };
    }, findWall);
    if (!r) { t.skip('pré-condição não encontrada nesta seed'); return; }
    assert.ok(!r.skip, r.skip);
    assert.ok(r.dano > 4,
      `granada atravessou o telhado (explodiu 22m abaixo, dano=${r.dano})`);
  });

  it('dado o heli voando contra um prédio, então ele NÃO atravessa', async t => {
    const r = await play((fw) => {
      const QA = window.QA, G = QA.G;
      const b = eval(fw);
      if (!b) return null;
      const cz = (b.z0 + b.z1) / 2;
      const midY = Math.min(b.y0 + 6, b.y1 - 2);
      const P = QA.MP.player;
      QA.reset();
      const hp = G.Heli.group.position;
      P.pos.set(hp.x + 2, hp.y, hp.z);
      QA.tick(1);
      G.tryToggleCar(); // entra
      if (!G.state.flying) return null;
      G.Heli.group.position.set(b.x0 - 14, midY, cz); // reposiciona já voando
      // heli anda na direção do yaw interno (começa +x — de frente pro prédio)
      G.keys.KeyW = true;
      let penetrou = false;
      for (let i = 0; i < 300; i++) {
        QA.tick(1);
        const c = G.Heli.group.position;
        if (c.x > b.x0 + 1.2 && c.x < b.x1 - 1.2 &&
            c.z > b.z0 + 1.2 && c.z < b.z1 - 1.2 &&
            c.y > b.y0 && c.y < b.y1) { penetrou = true; break; }
      }
      G.keys.KeyW = false;
      G.tryToggleCar(); // sai
      return { penetrou };
    }, findWall);
    if (!r) { t.skip('pré-condição não encontrada nesta seed'); return; }
    assert.ok(!r.penetrou, 'helicóptero atravessou o prédio');
  });

  it('dado o mundo com colisão de verdade, então nenhum carro nasce preso ou é ejetado (3 seeds)', async t => {
    // seed do harness atual
    const local = await play(() => {
      const QA = window.QA, G = QA.G;
      const antes = G.Car.vehicles.map(v => v.chassisBody.position.clone());
      QA.tick(300); // 5s de física assentando
      return G.Car.vehicles.map((v, i) => {
        const q = v.group.quaternion;
        const upv = new QA.MP.THREE.Vector3(0, 1, 0).applyQuaternion(q);
        return {
          i, desloc: +v.chassisBody.position.distanceTo(antes[i]).toFixed(2),
          upY: +upv.y.toFixed(2),
          vel: +v.chassisBody.velocity.length().toFixed(2),
        };
      });
    });
    for (const c of local) {
      assert.ok(c.desloc < 3, `seed 424242: carro ${c.i} ejetado ${c.desloc}m do spawn`);
      assert.ok(c.upY > 0.7, `seed 424242: carro ${c.i} capotou no spawn (upY=${c.upY})`);
      assert.ok(c.vel < 2, `seed 424242: carro ${c.i} ainda voando (v=${c.vel})`);
    }
    // duas seeds extras (boots próprios)
    for (const [porta, seed] of [[3192, '99'], [3191, '7']]) {
      const h2 = await bootGame({ port: porta, worldSeed: seed });
      try {
        const r = await h2.play(() => {
          const QA = window.QA, G = QA.G;
          const antes = G.Car.vehicles.map(v => v.chassisBody.position.clone());
          QA.tick(300);
          return G.Car.vehicles.map((v, i) => ({
            i, desloc: +v.chassisBody.position.distanceTo(antes[i]).toFixed(2),
            upY: +new QA.MP.THREE.Vector3(0, 1, 0).applyQuaternion(v.group.quaternion).y.toFixed(2),
            vel: +v.chassisBody.velocity.length().toFixed(2),
          }));
        });
        for (const c of r) {
          assert.ok(c.desloc < 3, `seed ${seed}: carro ${c.i} ejetado ${c.desloc}m`);
          assert.ok(c.upY > 0.7, `seed ${seed}: carro ${c.i} capotou (upY=${c.upY})`);
          assert.ok(c.vel < 2, `seed ${seed}: carro ${c.i} voando (v=${c.vel})`);
        }
      } finally { await h2.close(); }
    }
  });

  it('dada a borda do mundo, então o jogador é contido nos limites', async t => {
    const r = await play(() => {
      const QA = window.QA, P = QA.MP.player;
      const lim = QA.MP.CFG.WORLD_SIZE * 0.49;
      QA.reset(lim - 3, 0);
      QA.aimAt(lim + 50, P.pos.y + 1.6, 0);
      QA.G.keys.KeyW = true;
      QA.tick(180);
      return { x: P.pos.x, lim };
    });
    assert.ok(r.x <= r.lim + 0.01, `saiu do mundo: x=${r.x.toFixed(1)} limite=${r.lim}`);
  });

  it('dado outro jogador (bot de rede real), então não dá pra ocupar o mesmo lugar', async t => {
    // bot conecta no MESMO servidor e fica parado; o jogador anda até ele
    const bot = io(`http://localhost:${PORT}`, { transports: ['websocket'] });
    await new Promise(res => bot.once('init', res));
    bot.emit('hello', { nick: 'Encostado' });
    const alvo = await play(() => {
      const QA = window.QA;
      QA.reset(80, 80);
      const y = QA.MP.heightAt(84, 80);
      return { x: 84, y, z: 80 };
    });
    const iv = setInterval(() =>
      bot.volatile.emit('state', { pos: [alvo.x, alvo.y, alvo.z], rotY: 0, car: -1 }), 100);
    try {
      const r = await play(async (alvoIn) => {
        const QA = window.QA, P = QA.MP.player;
        const S = window.__BR_debug.S;
        const t0 = performance.now();
        while (window.__BR_debug.remotes.size === 0 && performance.now() - t0 < 8000)
          await new Promise(rr => setTimeout(rr, 200));
        if (window.__BR_debug.remotes.size === 0) return null;
        const faseAntes = S.phase;
        S.phase = 'PLAY'; // empurrão entre jogadores só vale em jogo
        // anda por cima do bot (ticks manuais + espera o rAF do BR aplicar o push)
        QA.reset(80, 80);
        QA.aimAt(alvoIn.x, P.pos.y + 1.5, alvoIn.z);
        QA.G.keys.KeyW = true;
        for (let i = 0; i < 40; i++) {
          QA.tick(3);
          await new Promise(rr => setTimeout(rr, 16)); // deixa o brTick rodar
        }
        QA.clearInput();
        S.phase = faseAntes;
        const rp = [...window.__BR_debug.remotes.values()][0];
        const d = Math.hypot(P.pos.x - rp.group.position.x, P.pos.z - rp.group.position.z);
        return { d };
      }, alvo);
      if (!r) { t.skip('pré-condição não encontrada nesta seed'); return; }
      assert.ok(r.d < 3.0, `jogador nem alcançou o outro (d=${r.d.toFixed(2)}m) — teste vazio`);
      assert.ok(r.d > 0.5, `ocupou o mesmo lugar do outro jogador: d=${r.d.toFixed(2)}m`);
    } finally {
      clearInterval(iv);
      bot.close();
    }
  });
});
