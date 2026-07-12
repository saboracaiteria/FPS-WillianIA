/* ================================================================
   QA — testes de JOGABILIDADE (mecânicas reais do jogo).
   Roda o jogo inteiro num Chrome headless (WebGL por software) e
   avança o tempo com __game.tick(1/60) — determinístico, sem rAF.
   Cobre: movimento, pulo, gravidade, colisão, tiro, recarga, dano,
   armadura, morte, cura, regen, veículos, slide e dia/noite.
   ================================================================ */
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CHROME, bootGame } = require('./helpers/harness');

describe('Jogabilidade (Chrome headless + tick manual)', { skip: !CHROME && 'Chrome não encontrado' }, () => {
  let h;
  before(async () => { h = await bootGame({ port: 3198 }); });
  after(async () => { if (h) await h.close(); });
  const play = (fn, ...args) => h.play(fn, ...args);

  it('dado W segurado, então o jogador anda; e com SHIFT corre mais rápido', async t => {
    const r = await play(() => {
      const QA = window.QA;
      QA.reset();
      const p0 = QA.pos();
      QA.tick(60);
      const parado = QA.fwdDelta(p0);
      QA.reset();
      const p1 = QA.pos();
      QA.G.keys.KeyW = true;
      QA.tick(60);
      const andou = QA.fwdDelta(p1);
      QA.reset();
      const p2 = QA.pos();
      QA.G.keys.KeyW = true; QA.G.keys.ShiftLeft = true;
      QA.tick(60);
      const correu = QA.fwdDelta(p2);
      return { parado, andou, correu };
    });
    assert.ok(r.parado < 0.2, `andou parado: ${r.parado}m`);
    assert.ok(r.andou > 2.5, `andou só ${r.andou}m em 1s`);
    assert.ok(r.correu > r.andou * 1.3, `correr (${r.correu}m) não supera andar (${r.andou}m)`);
  });

  it('dado ESPAÇO, então pula uma vez — e no ar não pula de novo', async t => {
    const r = await play(() => {
      const QA = window.QA, P = QA.MP.player;
      QA.reset();
      QA.MP.justPressed.add('Space');
      QA.tick(1);
      const subiu = P.vel.y;
      QA.tick(8); // no ar
      const noAr = !P.onGround;
      QA.MP.justPressed.add('Space'); // tenta pulo duplo
      QA.tick(1);
      const velAposDuplo = P.vel.y;
      QA.tick(240); // até pousar
      return { subiu, noAr, velAposDuplo, pousou: P.onGround };
    });
    assert.ok(r.subiu > 5, `pulo fraco: vel.y=${r.subiu}`);
    assert.ok(r.noAr, 'não saiu do chão');
    assert.ok(r.velAposDuplo < r.subiu, 'pulo duplo no ar não devia existir');
    assert.ok(r.pousou, 'nunca pousou de volta');
  });

  it('dado o jogador solto no ar, então a gravidade o traz de volta ao chão', async t => {
    const r = await play(() => {
      const QA = window.QA, P = QA.MP.player;
      QA.reset();
      P.pos.y += 25;
      P.onGround = false;
      QA.tick(300);
      const gy = QA.MP.groundAt(P.pos.x, P.pos.z, P.pos.y);
      return { noChao: P.onGround, delta: Math.abs(P.pos.y - gy) };
    });
    assert.ok(r.noChao, 'ficou flutuando');
    assert.ok(r.delta < 0.5, `parou a ${r.delta}m do chão`);
  });

  it('dada uma parede de construção, então o jogador não atravessa', async t => {
    const r = await play(() => {
      const QA = window.QA, P = QA.MP.player, S = QA.G.Structures;
      // parede alta o bastante pra barrar um humano
      const b = S.walls.find(w => {
        if (w.noCollide || (w.y1 - w.y0) < 2 || (w.x1 - w.x0) < 2) return false;
        const wz = (w.z0 + w.z1) / 2;
        const gApp = QA.MP.groundAt(w.x0 - 3, wz, 999); // chão de quem se aproxima
        return w.y0 < gApp + 0.5 && w.y1 > gApp + 1.9;  // não dá pra pular por cima
      });
      if (!b) return null;
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      QA.reset(b.x0 - 3, cz);
      P.pos.y = QA.MP.groundAt(b.x0 - 3, cz, 999);
      QA.aimAt(cx, P.pos.y + 1.6, cz); // olha pra parede
      QA.G.keys.KeyW = true;
      QA.tick(120); // 2s empurrando
      return { x: P.pos.x, limite: b.x0, raio: P.radius };
    });
    if (!r) { t.skip('pré-condição não encontrada nesta seed'); return; }
    assert.ok(r.x <= r.limite - r.raio + 0.15, `atravessou: x=${r.x.toFixed(2)} limite=${r.limite.toFixed(2)}`);
  });

  it('dado um carro parado, então o jogador não passa por dentro dele', async t => {
    const r = await play(() => {
      const QA = window.QA, P = QA.MP.player, car = QA.G.Car.group.position;
      QA.reset(car.x - 6, car.z);
      QA.aimAt(car.x, car.y + 1, car.z);
      QA.G.keys.KeyW = true;
      QA.tick(120);
      const d = Math.hypot(P.pos.x - car.x, P.pos.z - car.z);
      return { d };
    });
    assert.ok(r.d > 1.2, `entrou no chassi: distância ${r.d.toFixed(2)}m`);
  });

  it('dado um tiro no inimigo à frente, então ele perde vida e a munição desce', async t => {
    const r = await play(() => {
      const QA = window.QA, G = QA.G, P = QA.MP.player;
      QA.reset(60, 60);
      const e = G.Enemies.list.find(x => x.alive);
      if (!e) return null;
      e.group.position.set(P.pos.x + 10, QA.MP.heightAt(P.pos.x + 10, P.pos.z), P.pos.z);
      G.switchWeapon(0); // fuzil
      const gun = G.gun;
      gun.mag = gun.magSize; gun.reloading = false;
      const hp0 = e.health, mag0 = gun.mag;
      QA.aimAt(e.group.position.x, e.group.position.y + 1.1, e.group.position.z);
      G.mouse.aiming = true; // ADS: spread mínimo
      QA.tick(3);
      G.mouse.shooting = true; G.mouse.clicked = true;
      QA.tick(10);
      G.mouse.shooting = false; G.mouse.aiming = false;
      return { hp0, hp1: e.health, mag0, mag1: gun.mag, morreu: !e.alive };
    });
    if (!r) { t.skip('pré-condição não encontrada nesta seed'); return; }
    assert.ok(r.mag1 < r.mag0, 'não gastou munição');
    assert.ok(r.hp1 < r.hp0 || r.morreu, `inimigo intacto (hp ${r.hp0} -> ${r.hp1})`);
  });

  it('dado o pente vazio e R, então recarrega no tempo da arma', async t => {
    const r = await play(() => {
      const QA = window.QA, G = QA.G;
      QA.reset();
      G.switchWeapon(0);
      const gun = G.gun;
      gun.mag = 0; gun.reserve = 90; gun.reloading = false;
      QA.MP.justPressed.add('KeyR');
      QA.tick(1);
      const recarregando = gun.reloading;
      QA.tick(Math.ceil(gun.reloadTime * 60) + 10);
      return { recarregando, mag: gun.mag, magSize: gun.magSize, reserve: gun.reserve };
    });
    assert.ok(r.recarregando, 'não entrou em recarga');
    assert.equal(r.mag, r.magSize, 'pente não encheu');
    assert.ok(r.reserve < 90, 'reserva não desceu');
  });

  it('dado dano com colete, então a armadura absorve 70% até quebrar', async t => {
    const r = await play(() => {
      const QA = window.QA, P = QA.MP.player;
      QA.reset();
      P.armor = 50;
      QA.MP.playerDamage(30, null);
      return { health: P.health, armor: P.armor };
    });
    assert.equal(r.armor, 29, `armadura errada: ${r.armor}`);       // 50 - 21
    assert.equal(r.health, 91, `vida errada: ${r.health}`);         // 100 - 9
  });

  it('dado dano letal, então o jogador morre de verdade', async t => {
    const r = await play(() => {
      const QA = window.QA, P = QA.MP.player;
      QA.reset();
      QA.MP.playerDamage(9999, null);
      const dead = P.dead, hp = P.health;
      QA.reset(); // revive pros próximos testes
      return { dead, hp, vivo: !QA.MP.player.dead };
    });
    assert.ok(r.dead, 'sobreviveu a 9999 de dano');
    assert.equal(r.hp, 0);
    assert.ok(r.vivo, 'reset não reviveu');
  });

  it('dado um kit médico (Q), então a vida sobe gradualmente', async t => {
    const r = await play(() => {
      const QA = window.QA, G = QA.G, P = QA.MP.player;
      QA.reset();
      P.health = 40;
      G.inventory.medkits = 1;
      QA.MP.justPressed.add('KeyQ');
      QA.tick(1);
      const kits = G.inventory.medkits, pool = P.healPool;
      QA.tick(90); // 1.5s curando
      return { kits, pool, health: P.health };
    });
    assert.equal(r.kits, 0, 'kit não foi consumido');
    assert.ok(r.pool > 0, 'healPool vazio');
    assert.ok(r.health > 55, `curou pouco: ${r.health}`);
  });

  it('dados 5s sem tomar dano, então a vida regenera sozinha', async t => {
    const r = await play(() => {
      const QA = window.QA, P = QA.MP.player;
      QA.reset();
      P.health = 50;
      P.lastDamageT = QA.MP.state.gameTime - 10;
      QA.tick(60);
      return { health: P.health };
    });
    assert.ok(r.health > 55, `não regenerou: ${r.health}`);
  });

  it('dado o carro, então entra, acelera de verdade e sai ao lado', async t => {
    const r = await play(() => {
      const QA = window.QA, G = QA.G;
      QA.reset();
      G.teleportToCar();
      QA.tick(2);
      G.tryToggleCar();
      const dirigindo = G.state.driving;
      const c0 = [G.Car.group.position.x, G.Car.group.position.z];
      G.keys.KeyW = true;
      QA.tick(180); // 3s de acelerador
      const kmh = G.Car.speedKmh();
      const andou = Math.hypot(G.Car.group.position.x - c0[0], G.Car.group.position.z - c0[1]);
      G.keys.KeyW = false;
      G.tryToggleCar();
      const saiu = !G.state.driving;
      const dPlayer = QA.MP.player.pos.distanceTo(G.Car.group.position);
      return { dirigindo, kmh, andou, saiu, dPlayer };
    });
    assert.ok(r.dirigindo, 'não entrou no carro');
    assert.ok(r.kmh > 5, `não acelerou: ${r.kmh.toFixed(1)} km/h`);
    assert.ok(r.andou > 3, `carro não saiu do lugar: ${r.andou.toFixed(1)}m`);
    assert.ok(r.saiu, 'não saiu do carro');
    assert.ok(r.dPlayer < 8, 'saiu longe demais do carro');
  });

  it('dado o helicóptero, então decola com ESPAÇO', async t => {
    const r = await play(() => {
      const QA = window.QA, G = QA.G, P = QA.MP.player;
      QA.reset();
      const h = G.Heli.group.position;
      P.pos.set(h.x + 2, h.y, h.z);
      QA.tick(1);
      G.tryToggleCar(); // tryEnter do heli
      const voando = G.state.flying;
      const y0 = h.y;
      G.keys.Space = true;
      QA.tick(180);
      const subiu = G.Heli.group.position.y - y0;
      G.keys.Space = false;
      G.tryToggleCar(); // sai
      return { voando, subiu };
    });
    assert.ok(r.voando, 'não entrou no heli');
    assert.ok(r.subiu > 2, `não decolou: subiu ${r.subiu.toFixed(1)}m`);
  });

  it('dado sprint + CTRL, então desliza (slide)', async t => {
    const r = await play(() => {
      const QA = window.QA, G = QA.G, P = QA.MP.player;
      QA.reset();
      G.keys.KeyW = true; G.keys.ShiftLeft = true;
      QA.tick(90); // ganha velocidade
      QA.MP.justPressed.add('ControlLeft');
      G.keys.ControlLeft = true;
      QA.tick(1);
      return { slideT: P.slideT };
    });
    assert.ok(r.slideT > 0, `não deslizou (slideT=${r.slideT})`);
  });

  it('dado um disparo em rajada, então o recoil levanta a mira e depois assenta', async t => {
    const r = await play(() => {
      const QA = window.QA, G = QA.G, MP = QA.MP;
      QA.reset();
      G.switchWeapon(0);
      G.gun.mag = G.gun.magSize; G.gun.reloading = false;
      QA.tick(30); // câmera assenta
      const pitch0 = MP.camera.rotation.x;
      G.mouse.shooting = true; G.mouse.clicked = true;
      QA.tick(12); // rajada de ~0.2s
      const pitchBurst = MP.camera.rotation.x;
      G.mouse.shooting = false;
      QA.tick(90); // recuperação
      const pitchAfter = MP.camera.rotation.x;
      return { sub: pitchBurst - pitch0, volta: Math.abs(pitchAfter - pitch0), pico: Math.abs(pitchBurst - pitch0) };
    });
    assert.ok(r.sub > 0.004, `recoil não subiu a mira (${r.sub.toFixed(4)} rad)`);
    assert.ok(r.volta < r.pico, 'mira não assentou depois da rajada');
  });

  it('dada a IA ligada e um inimigo à vista, então ele sai da patrulha e engaja', async t => {
    const r = await play(() => {
      const QA = window.QA, G = QA.G, P = QA.MP.player;
      QA.reset(40, 40);
      const e = G.Enemies.list.find(x => x.alive);
      if (!e) return null;
      e.group.position.set(40, QA.MP.heightAt(40, 28), 28); // 12m à frente, área plana
      e.fsm = 'PATRULHA';
      e.alertT = 0; e.losT = 0;
      // patrulha só enxerga dentro do cone de visão: aponta o inimigo pro
      // jogador (o yaw herdado varia com quanto a IA andou nos testes antes)
      e.yaw = Math.atan2(P.pos.x - 40, P.pos.z - 28);
      window.__BR_active = false; // liga a IA só neste teste
      const hp0 = P.health;
      QA.tick(300); // 5s de jogo
      window.__BR_active = true;  // congela de novo
      const fsm = e.fsm;
      e.group.position.set(-400, QA.MP.heightAt(-400, -400), -400); // some daqui
      return { fsm, tomouDano: P.health < hp0 };
    });
    if (!r) { t.skip('pré-condição não encontrada nesta seed'); return; }
    assert.ok(r.fsm !== 'PATRULHA' || r.tomouDano,
      `inimigo ignorou o jogador a 12m (fsm=${r.fsm})`);
  });

  it('dada uma granada no pé do inimigo, então ele perde vida', async t => {
    const r = await play(() => {
      const QA = window.QA, G = QA.G;
      QA.reset(50, 50);
      const e = G.Enemies.list.find(x => x.alive);
      if (!e) return null;
      e.group.position.set(55, QA.MP.heightAt(55, 55), 55);
      e.health = 100;
      G.Grenades.explode(e.group.position.clone());
      return { hp: e.health, morreu: !e.alive };
    });
    if (!r) { t.skip('pré-condição não encontrada nesta seed'); return; }
    assert.ok(r.hp < 100 || r.morreu, 'explosão não feriu o inimigo');
  });

  it('dado dano no COLOSSO, então o hp do boss desce', async t => {
    const r = await play(() => {
      const QA = window.QA, G = QA.G, THREE = QA.MP.THREE;
      const hp0 = G.Boss.state.hp;
      G.Boss.damage(60, G.Boss.pos().clone(), new THREE.Vector3(0, 0, 1), 'body');
      return { hp0, hp1: G.Boss.state.hp };
    });
    assert.ok(r.hp1 < r.hp0, `boss não levou dano (${r.hp0} -> ${r.hp1})`);
  });

  it('dadas as teclas 1-6 e o scroll, então as armas trocam', async t => {
    const r = await play(() => {
      const QA = window.QA, G = QA.G, MP = QA.MP;
      QA.reset();
      for (const w of G.arsenal) w.locked = false; // QA: arsenal liberado
      const nomes = [];
      // 1-3: atalhos do núcleo (justPressed)
      for (const [key, idx] of [['Digit1', 0], ['Digit2', 1], ['Digit3', 2]]) {
        MP.justPressed.add(key); QA.tick(1);
        nomes.push([G.gun.name, G.arsenal[idx].name]);
      }
      // 4-6: atalhos do BR (listener de keydown real, só em fase PLAY)
      const faseAntes = window.__BR_debug.S.phase;
      window.__BR_debug.S.phase = 'PLAY';
      for (const [key, idx] of [['Digit4', 3], ['Digit5', 4], ['Digit6', 5]]) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: key, bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code: key, bubbles: true }));
        QA.tick(1);
        nomes.push([G.gun.name, G.arsenal[idx].name]);
      }
      window.__BR_debug.S.phase = faseAntes;
      // scroll: roda pra próxima arma destravada
      const antes = G.gun.name;
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 }));
      QA.tick(1);
      const depoisScroll = G.gun.name !== antes;
      return { nomes, depoisScroll };
    });
    for (const [got, want] of r.nomes) assert.equal(got, want, `atalho trocou pra ${got}, esperado ${want}`);
    assert.ok(r.depoisScroll, 'scroll do mouse não trocou de arma');
  });

  it('dado F com carne no inventário, então come e recupera vida', async t => {
    const r = await play(() => {
      const QA = window.QA, G = QA.G, P = QA.MP.player;
      QA.reset();
      P.health = 40;
      G.inventory.meat = 1;
      QA.MP.justPressed.add('KeyF');
      QA.tick(1);
      const carne = G.inventory.meat;
      QA.tick(90);
      return { carne, health: P.health };
    });
    assert.equal(r.carne, 0, 'carne não foi consumida');
    assert.ok(r.health > 45, `não curou comendo: ${r.health}`);
  });

  it('dado T, então o acessório da mira troca (aviso na tela)', async t => {
    const r = await play(() => {
      const QA = window.QA;
      QA.reset();
      QA.G.switchWeapon(0);
      QA.MP.justPressed.add('KeyT');
      QA.tick(1);
      return { msg: document.getElementById('centerMsg').textContent };
    });
    assert.ok(/mira/i.test(r.msg), `sem aviso de troca de mira: "${r.msg}"`);
  });

  it('dado TAB, então o painel de inventário abre — e fecha no segundo toque', async t => {
    const r = await play(() => {
      const QA = window.QA;
      QA.reset();
      QA.MP.justPressed.add('Tab'); QA.tick(1); // TAB é toggle por pressão
      const aberto = document.getElementById('invPanel').classList.contains('open');
      QA.MP.justPressed.add('Tab'); QA.tick(1);
      const fechado = !document.getElementById('invPanel').classList.contains('open');
      return { aberto, fechado };
    });
    assert.ok(r.aberto, 'TAB não abriu o inventário');
    assert.ok(r.fechado, 'inventário não fechou ao soltar TAB');
  });

  it('dado ENTER, então o chat da sala abre — e ESC fecha sem vazar teclas pro jogo', async t => {
    const r = await play(() => {
      const QA = window.QA;
      QA.reset();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true }));
      const input = document.getElementById('brChatInput');
      const abriu = input && input.style.display === 'block';
      // digita W com o chat aberto: o jogo NÃO pode andar
      input.focus();
      const p0 = QA.pos();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
      QA.tick(30);
      const andou = QA.fwdDelta(p0);
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
      const fechou = input.style.display === 'none';
      return { abriu, andou, fechou };
    });
    assert.ok(r.abriu, 'ENTER não abriu o chat');
    assert.ok(r.andou < 0.3, `teclas vazaram pro jogo com o chat aberto (andou ${r.andou.toFixed(2)}m)`);
    assert.ok(r.fechou, 'ESC não fechou o chat');
  });

  it('dado o tempo passando, então o dia avança (Env.tod)', async t => {
    const r = await play(() => {
      const QA = window.QA;
      const t0 = QA.G.Env.tod;
      QA.tick(120);
      return { t0, t1: QA.G.Env.tod };
    });
    assert.ok(r.t1 > r.t0, 'relógio do mundo parado');
  });

  it('dada a partida iniciada via socket (sem clique), quando o mouse é capturado e o ESC solta, então o jogo PAUSA de verdade', async t => {
    // bug de playtest: partida BR inicia com lockFailed=true e o ESC deixava
    // o jogador num limbo — mouse solto, jogo correndo, sem menu de pausa
    const r = await play(() => {
      const QA = window.QA, MP = QA.MP;
      const mockLock = el => {
        Object.defineProperty(document, 'pointerLockElement',
          { get: () => el, configurable: true });
        document.dispatchEvent(new Event('pointerlockchange'));
      };
      MP.state.paused = false;
      mockLock(document.body);   // jogador clicou: lock OK (controls usam body)
      const lockou = MP.state.pointerLocked === true;
      mockLock(null);            // apertou ESC: lock caiu
      const pausou = MP.state.paused === true;
      const overlayPausa = !document.getElementById('overlay').classList.contains('hidden');
      // limpa: despausa pro resto da suite
      MP.state.paused = false;
      document.getElementById('overlay').classList.add('hidden');
      return { lockou, pausou, overlayPausa };
    });
    assert.ok(r.lockou, 'evento de lock não registrou');
    assert.ok(r.pausou, 'ESC não pausou a partida iniciada via socket');
    assert.ok(r.overlayPausa, 'menu de pausa não apareceu no ESC');
  });

  it('dado o início da partida, então o menu some IMEDIATAMENTE (sem esperar transição de opacity)', async t => {
    // bug de playtest: hitch da geração da partida segurava a transição de
    // 0,6s e o menu NOVO JOGO ficava na tela por cima do jogo
    const r = await play(() => {
      const MP = window.QA.MP;
      const ov = document.getElementById('overlay');
      MP.state.paused = true; // simula estado de menu
      ov.classList.remove('hidden');
      ov.style.display = '';
      window.__game.forceStart(); // já started: forceStart não repete
      // caminho real: despausar (matchStart -> setPaused(false))
      window.__BR_debug ? null : null;
      // usa o mesmo caminho do jogo: lock mockado dispara setPaused(false)
      Object.defineProperty(document, 'pointerLockElement',
        { get: () => document.body, configurable: true });
      document.dispatchEvent(new Event('pointerlockchange'));
      const escondidoJa = getComputedStyle(ov).display === 'none';
      Object.defineProperty(document, 'pointerLockElement',
        { get: () => null, configurable: true });
      document.dispatchEvent(new Event('pointerlockchange'));
      const voltouNaPausa = getComputedStyle(ov).display !== 'none';
      MP.state.paused = false;
      ov.classList.add('hidden');
      return { escondidoJa, voltouNaPausa };
    });
    assert.ok(r.escondidoJa, 'menu ainda ocupa a tela após despausar (esperando transição)');
    assert.ok(r.voltouNaPausa, 'menu de pausa não volta a aparecer');
  });

  it('dado multiplayer ativo, então NOVO JOGO fica desabilitado (clique não pode iniciar solo por cima do lobby)', async t => {
    // bug de playtest: clicar em NOVO JOGO antes do lobby BR aparecer
    // iniciava jogo solo com pointer lock — jogador preso, só ESC salvava
    const r = await play(() => {
      const btn = document.getElementById('btnNew');
      return {
        temSocket: !!window.__MP.socket,
        desabilitado: btn.classList.contains('disabled'),
        semClique: getComputedStyle(btn).pointerEvents === 'none',
      };
    });
    assert.ok(r.temSocket, 'harness sem multiplayer — teste inválido');
    assert.ok(r.desabilitado, 'NOVO JOGO continua clicável com multiplayer ativo');
    assert.ok(r.semClique, 'botão desabilitado ainda recebe cliques');
  });

  it('dado o lobby aparecendo com o mouse capturado, então o pointer lock é solto (dá pra editar sem ESC)', async t => {
    const r = await play(() => {
      const dbg = window.__BR_debug;
      if (!dbg || !dbg.LOBBY) return { semLobby: true };
      window.__e2e_exit = false;
      const orig = document.exitPointerLock;
      document.exitPointerLock = () => { window.__e2e_exit = true; };
      Object.defineProperty(document, 'pointerLockElement',
        { get: () => document.body, configurable: true });
      dbg.LOBBY.show('');
      const soltou = window.__e2e_exit === true;
      dbg.LOBBY.hide();
      document.exitPointerLock = orig;
      Object.defineProperty(document, 'pointerLockElement',
        { get: () => null, configurable: true });
      return { soltou };
    });
    assert.ok(!r.semLobby, 'LOBBY não exposto no __BR_debug');
    assert.ok(r.soltou, 'lobby apareceu sem soltar o pointer lock (jogador preso)');
  });

  it('dada a cidade (asfalto), então a grama não brota lá dentro — e segue normal do lado de fora', async t => {
    const r = await play(() => {
      const G = window.QA.G, MP = window.QA.MP, THREE = MP.THREE;
      const CITY = { x: -340, z: 130 };
      // teleporta pra cidade: o streaming preenche os chunks locais de grama
      // na BORDA da cidade: a grade de grama (raio ~70m) cobre os dois lados
      // da fronteira urbana — dá pra medir dentro E fora no mesmo streaming
      window.QA.reset(CITY.x + 90, CITY.z);
      // streaming reconstrói poucos chunks por frame: esgota a fila
      for (let i = 0; i < 150; i++) G.Grass.update(MP.player.pos, MP.player.pos, 1);
      const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(),
        q = new THREE.Quaternion(), sc = new THREE.Vector3();
      let dentroAltas = 0, dentroTotal = 0, foraAltas = 0, foraTotal = 0;
      MP.scene.traverse(o => {
        if (!o.isInstancedMesh || !o.geometry.attributes.aPhase) return; // só chunks de grama
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, m4);
          m4.decompose(pos, q, sc);
          const wx = o.position.x + pos.x, wz = o.position.z + pos.z;
          const d = Math.hypot(wx - CITY.x, wz - CITY.z);
          if (d < 80) { dentroTotal++; if (sc.y > 0.1) dentroAltas++; }
          else if (d > 95 && d < 130) { foraTotal++; if (sc.y > 0.1) foraAltas++; }
        }
      });
      return { dentroAltas, dentroTotal, foraAltas, foraTotal };
    });
    assert.ok(r.dentroTotal > 50, `amostra pequena na cidade (${r.dentroTotal})`);
    assert.equal(r.dentroAltas, 0, `${r.dentroAltas}/${r.dentroTotal} lâminas de grama dentro da cidade`);
    assert.ok(r.foraAltas > 5, `grama de fora sumiu junto (${r.foraAltas}/${r.foraTotal})`);
  });

  it('rede de segurança: nenhum erro de runtime acumulado durante toda a suite', async t => {
    const errs = await play(() => window.__game.errors.map(e => String(e && e.message || e)));
    assert.deepEqual(errs, [], `erros: ${errs.join(' | ')}`);
  });
});
