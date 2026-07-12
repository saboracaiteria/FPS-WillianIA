/* Captura visual local dos três arquétipos de carro. Requer o servidor já ativo. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const CHROME = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium']
  .find(p => fs.existsSync(p));
const url = process.env.PLAYTEST_URL || 'http://localhost:3210/';
const output = path.join(__dirname, '..', 'output', 'car-models');

(async () => {
  if (!CHROME) throw new Error('Chrome local não encontrado');
  fs.mkdirSync(output, { recursive: true });
  const errors = [];
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
      '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1280,720'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    // Screenshot determinístico: não deixe o pipeline completo competir em loop no SwiftShader.
    await page.evaluateOnNewDocument(() => { window.requestAnimationFrame = () => 0; });
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => {
      if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text());
    });
    page.on('response', response => {
      if (response.status() >= 400 && !response.url().endsWith('/favicon.ico'))
        errors.push(`${response.status()} ${response.url()}`);
    });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__game && window.__game.Car && window.__game.Car.ready', { timeout: 60000 });
    await page.evaluate(() => window.__game.Car.ready);
    await page.addStyleTag({ content: 'body > :not(#game) { display:none !important; }' });

    const previews = [
      { type: 'BUGGY', file: 'gumball.png', view: [6.2, 2.8, 5.2] },
      { type: 'ESPORTIVO GT', file: 'mazda-rx7.png', view: [5.8, 2.3, 4.8] },
      { type: 'CAMINHÃO MILITAR', file: 'truck-drifter.png', view: [8.2, 3.8, 6.6] },
    ];
    for (const preview of previews) {
      await page.evaluate(({ type, view }) => {
        const G = window.__game, MP = window.__MP;
        const v = G.Car.vehicles.find(car => car.cfg.name === type);
        if (!v || v.modelStatus !== 'ready') throw new Error(`Modelo indisponível: ${type}`);
        G.forceStart();
        G.state.paused = true;
        G.state.cinematic = true;
        MP.camera.position.set(view[0], view[1], view[2]).applyQuaternion(v.group.quaternion).add(v.group.position);
        MP.camera.lookAt(v.group.position.x, v.group.position.y + 0.35, v.group.position.z);
        MP.camera.updateMatrixWorld(true);
        MP.renderer.render(MP.scene, MP.camera);
      }, preview);
      await new Promise(resolve => setTimeout(resolve, 100));
      await page.$eval('#game', canvas => { canvas.style.width = '1280px'; canvas.style.height = '720px'; });
      const canvas = await page.$('#game');
      await canvas.screenshot({ path: path.join(output, preview.file) });
    }
    if (errors.length) throw new Error(`Erros do navegador:\n${errors.join('\n')}`);
  } finally {
    await browser.close();
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
