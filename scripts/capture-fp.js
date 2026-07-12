/* Captura visual da primeira pessoa: cada arma GLB nas mãos do rig,
   fases da recarga e poses de queda/paraquedas. Sobe o próprio servidor.
   Uso: node scripts/capture-fp.js [porta] */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const puppeteer = require('puppeteer-core');

const CHROME = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.CHROME_PATH || ''].find(p => p && fs.existsSync(p));
const PORT = +(process.argv[2] || 3213);
const output = path.join(__dirname, '..', 'output', 'fp');

(async () => {
  if (!CHROME) throw new Error('Chrome local não encontrado');
  fs.mkdirSync(output, { recursive: true });
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), WORLD_SEED: '424242' }, stdio: 'ignore',
  });
  await new Promise(r => setTimeout(r, 900));
  const errors = [];
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
      '--use-gl=angle', '--use-angle=swiftshader', '--mute-audio', '--window-size=1280,720'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(() => { window.requestAnimationFrame = () => 0; });
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => {
      if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text());
    });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    // polling por intervalo: o rAF foi congelado pra screenshot determinístico
    await page.waitForFunction('window.__game && window.__game.WeaponModels', { timeout: 60000, polling: 250 });
    await page.evaluate(async () => {
      const G = window.__game;
      window.__MP_active = true; window.__MP_respawn = () => {};
      window.__BR_active = true; // sem IA no caminho
      G.forceStart();
      await G.WeaponModels.ready;
      // espera o corpo FP carregar (ou falhar)
      for (let i = 0; i < 200 && !(G.FpBody.ready || G.FpBody.failed); i++)
        await new Promise(r => setTimeout(r, 100));
      // cenário limpo: player num campo aberto, meio-dia
      const MP = window.__MP;
      MP.player.pos.set(30, MP.groundAt(30, 30, 999), 30);
      MP.player.vel.set(0, 0, 0);
      G.Env.tod = 0.5;
      MP.camera.rotation.set(0, 0, 0);
    });
    await page.addStyleTag({ content: 'body > :not(#game) { display:none !important; }' });

    const shots = [];
    const nWeapons = await page.evaluate(() => window.__game.arsenal.length);
    for (let i = 0; i < nWeapons; i++) {
      shots.push({ file: `arma-${i}.png`, setup: { idx: i, mode: 'idle' } });
      shots.push({ file: `arma-${i}-recarga50.png`, setup: { idx: i, mode: 'reload', k: 0.5 } });
    }
    shots.push({ file: 'pose-queda.png', setup: { mode: 'fall' } });
    shots.push({ file: 'pose-paraquedas.png', setup: { mode: 'chute' } });
    shots.push({ file: 'olhando-pro-chao.png', setup: { idx: 0, mode: 'down' } });
    shots.push({ file: 'corpo-3a-pessoa.png', setup: { idx: 0, mode: 'detach' } });
    shots.push({ file: 'corpo-bind-pose.png', setup: { mode: 'bind' } });
    shots.push({ file: 'arma-0-ads.png', setup: { idx: 0, mode: 'ads' } });
    shots.push({ file: 'arma-6-ads.png', setup: { idx: 6, mode: 'ads' } });

    for (const s of shots) {
      const report = await page.evaluate(setup => {
        const G = window.__game, MP = window.__MP;
        window.__FP_pose = null;
        if (setup.idx != null) {
          G.arsenal[setup.idx].locked = false;
          G.switchWeapon(setup.idx);
          G.gun.reloading = false;
        }
        if (setup.mode === 'fall') window.__FP_pose = 'fall';
        if (setup.mode === 'chute') window.__FP_pose = 'chute';
        MP.camera.rotation.set(setup.mode === 'down' ? -1.2 : 0, 0.6, 0);
        G.mouse.aiming = setup.mode === 'ads';
        G.state.paused = false;
        for (let i = 0; i < 30; i++) G.tick(1 / 60); // rampa saque/ADS até o repouso
        if (setup.mode === 'reload') {
          // congela a recarga na fase k: reloadEnd = t + (1-k)*reloadTime
          const gun = G.gun;
          gun.reloading = true;
          gun.reloadEnd = G.state.gameTime + (1 - setup.k) * gun.reloadTime + 1 / 30;
          G.tick(1 / 60);
        }
        G.state.paused = true;
        G.mouse.aiming = false;
        if (setup.mode === 'detach' || setup.mode === 'bind') {
          // corpo solto no mundo pra fotografar de fora (proporção/pose);
          // cinemático só aqui, pra câmera manual não ser sobrescrita
          G.state.cinematic = true;
          const P = MP.player.pos;
          const gy = MP.heightAt(P.x + 2.5, P.z + 2.5);
          // o bodyRoot é ancorado pelo OLHO: solta a 1.62m do chão pros pés assentarem
          window.__FP.debugDetach(P.x + 2.5, gy + 1.62, P.z + 2.5);
          if (setup.mode === 'bind') window.__FP.debugBindPose();
          MP.camera.position.set(P.x + 2.5, gy + 1.3, P.z + 5.8);
          MP.camera.lookAt(P.x + 2.5, gy + 0.9, P.z + 2.5);
        }
        MP.camera.updateMatrixWorld(true);
        MP.renderer.render(MP.scene, MP.camera);
        if (setup.mode === 'detach' || setup.mode === 'bind') {
          window.__FP.debugAttach();
          G.state.cinematic = false;
        }
        const gun = G.gun;
        return {
          arma: gun ? gun.name : null,
          modelo: gun ? gun.modelStatus || 'procedural' : null,
          fp: G.FpBody.ready ? 'rig ok' : (G.FpBody.failed ? 'FALHOU' : 'carregando'),
        };
      }, s.setup);
      await new Promise(r => setTimeout(r, 60));
      await page.$eval('#game', c => { c.style.width = '1280px'; c.style.height = '720px'; });
      const canvas = await page.$('#game');
      await canvas.screenshot({ path: path.join(output, s.file) });
      console.log(`${s.file}  →  ${JSON.stringify(report)}`);
    }
    if (errors.length) { console.error('\nERROS DE PÁGINA:'); for (const e of errors) console.error('  ' + e); }
    else console.log('\nsem erros de página');
  } finally {
    await browser.close();
    srv.kill();
  }
})().catch(e => { console.error(e); process.exit(1); });
