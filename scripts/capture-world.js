/* Captura visual do MUNDO renovado: Guardião (inimigos), Visitante (alien),
   árvores GLB, mercado/refúgio e barris. Sobe o próprio servidor.
   Uso: node scripts/capture-world.js [porta] */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const puppeteer = require('puppeteer-core');

const CHROME = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.CHROME_PATH || ''].find(p => p && fs.existsSync(p));
const PORT = +(process.argv[2] || 3217);
const output = path.join(__dirname, '..', 'output', 'world');

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
    await page.waitForFunction('window.__game && window.__MP', { timeout: 60000, polling: 250 });
    await page.evaluate(async () => {
      const G = window.__game;
      window.__MP_active = true; window.__MP_respawn = () => {};
      G.forceStart();
      G.Env.tod = 0.5; // meio-dia
      await new Promise(r => setTimeout(r, 5000)); // GLBs de mundo carregam
      G.state.cinematic = true; // câmera manual
    });
    await page.addStyleTag({ content: 'body > :not(#game) { display:none !important; }' });

    const shots = [
      { file: 'guardiao-inimigo.png', target: 'enemy' },
      { file: 'visitante-alien.png', target: 'alien' },
      { file: 'floresta-arvores.png', target: 'forest' },
      { file: 'mercado-poi.png', target: 'mercado' },
      { file: 'refugio-poi.png', target: 'refúgio' },
    ];
    for (const s of shots) {
      const report = await page.evaluate(target => {
        const G = window.__game, MP = window.__MP;
        const cam = (x, y, z, lx, ly, lz) => {
          MP.camera.position.set(x, y, z);
          MP.camera.lookAt(lx, ly, lz);
          MP.camera.updateMatrixWorld(true);
        };
        let info;
        if (target === 'enemy') {
          const e = G.Enemies.list.find(e => e.alive && e.hasModel) || G.Enemies.list[0];
          const p = e.group.position;
          G.tick(1 / 30); G.tick(1 / 30); // mixer anda um pouco
          cam(p.x + 3.4, MP.heightAt(p.x + 3.4, p.z + 3.4) + 1.7, p.z + 3.4, p.x, p.y + 1.2, p.z);
          info = { nome: e.name, temModelo: !!e.hasModel, vivo: e.alive };
        } else if (target === 'alien') {
          const a = G.Alien;
          const p = a.pos();
          cam(p.x + 4.5, MP.heightAt(p.x + 4.5, p.z + 4.5) + 2.4, p.z + 4.5, p.x, p.y + 2, p.z);
          info = { vivo: a.alive, site: a.SITE };
        } else if (target === 'forest') {
          // acha uma área de floresta e olha pra ela
          let fx = 120, fz = 120;
          for (let i = 0; i < 400; i++) {
            const x = (Math.random() * 2 - 1) * 400, z = (Math.random() * 2 - 1) * 400;
            if (G.biomeAt(x, z) > 0.4 && MP.heightAt(x, z) > 2) { fx = x; fz = z; break; }
          }
          // o LOD das árvores segue o JOGADOR: teleporta ele junto da câmera
          MP.player.pos.set(fx, MP.heightAt(fx, fz), fz);
          G.state.cinematic = false; G.tick(0.5); G.tick(0.5); G.state.cinematic = true;
          cam(fx + 24, MP.heightAt(fx + 24, fz + 24) + 8, fz + 24, fx, MP.heightAt(fx, fz) + 4, fz);
          info = { em: [fx | 0, fz | 0] };
        } else {
          const site = G.Structures.sites.find(s => s.type === target);
          if (!site) return { erro: 'site não existe: ' + target };
          cam(site.x + site.r + 6, MP.heightAt(site.x + site.r + 6, site.z + site.r + 6) + 5,
            site.z + site.r + 6, site.x, MP.heightAt(site.x, site.z) + 3, site.z);
          info = { site: { x: site.x | 0, z: site.z | 0, r: +site.r.toFixed(1) } };
        }
        MP.renderer.render(MP.scene, MP.camera);
        return info;
      }, s.target);
      await new Promise(r => setTimeout(r, 80));
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
