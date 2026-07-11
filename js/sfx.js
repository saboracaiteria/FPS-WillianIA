/* ================== áudio procedural (WebAudio, zero assets) ================== */
export function createSFX(deps) {
  const { SETTINGS, clamp, rand } = deps;
  let ctx = null, master = null, noiseBuf = null;
  // motor do carro (2 osciladores dessintonizados + sub + escape com ruído)
  let engineOsc = null, engineOsc2 = null, engineSub = null, engineGain = null, engineFilter = null, engineLfo = null, exhGain = null;
  let heliGain = null, heliLfo = null;
  // sem música/vento: só a camada de chuva reage ao clima
  let musicOn = false, rainGain = null, rainAmt = 0;
  function init() {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = SETTINGS.vol;
      // compressor no master: tiros com mais punch sem estourar o mix
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.knee.value = 22; comp.ratio.value = 6;
      comp.attack.value = 0.004; comp.release.value = 0.16;
      master.connect(comp); comp.connect(ctx.destination);
      const len = ctx.sampleRate * 1.2;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ctx = null; }
  }
  function blip(freq, dur, type = 'sine', vol = 0.2, slide = 0) {
    if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), ctx.currentTime + dur);
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime + dur + 0.02);
  }
  function noise(dur, vol, fStart, fEnd, q = 1) {
    if (!ctx) return;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.playbackRate.value = rand(0.85, 1.15);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = q;
    f.frequency.setValueAtTime(fStart, ctx.currentTime);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, fEnd), ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(); s.stop(ctx.currentTime + dur + 0.05);
  }
  return {
    init,
    resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },
    shot(kind) { // timbre por arma: estalo agudo + corpo + sub grave (punch)
      if (kind === 'shotgun') { noise(0.4, 0.72, 3400, 95, 0.6); blip(84, 0.24, 'square', 0.2, -46); blip(46, 0.32, 'sine', 0.3, -14); }
      else if (kind === 'dmr') { noise(0.22, 0.6, 6800, 170, 0.9); blip(175, 0.12, 'square', 0.14, -120); blip(52, 0.24, 'sine', 0.24, -18); setTimeout(() => noise(0.4, 0.12, 650, 80, 0.4), 70); }
      else { noise(0.17, 0.55, 5600, 210, 0.8); blip(140, 0.09, 'square', 0.14, -85); blip(58, 0.18, 'sine', 0.22, -22); }
    },
    chirp() { // passarinhos
      if (!ctx) return;
      const n = 2 + ((Math.random() * 3) | 0);
      for (let i = 0; i < n; i++)
        setTimeout(() => blip(rand(2300, 3400), 0.07, 'sine', 0.04, -rand(300, 900)), i * 115 + rand(50));
    },
    enemyShot() { noise(0.14, 0.18, 2600, 200, 0.7); },
    reload()    { noise(0.05, 0.14, 2400, 800, 1.5); blip(420, 0.05, 'square', 0.09); setTimeout(() => { noise(0.05, 0.12, 1800, 600, 1.5); blip(620, 0.05, 'square', 0.09); }, 130); setTimeout(() => { noise(0.06, 0.16, 2800, 900, 1.5); blip(900, 0.06, 'square', 0.11); }, 320); },
    empty()     { blip(900, 0.04, 'square', 0.07); },
    hit()       { blip(1150, 0.055, 'triangle', 0.17); blip(760, 0.045, 'sine', 0.08); },
    headshot()  { blip(1500, 0.07, 'triangle', 0.22); blip(2100, 0.1, 'sine', 0.14); blip(980, 0.05, 'sine', 0.08); },
    kill()      { blip(740, 0.09, 'triangle', 0.17); setTimeout(() => blip(1180, 0.14, 'triangle', 0.19), 70); setTimeout(() => blip(1560, 0.16, 'sine', 0.1), 150); },
    hurt()      { noise(0.25, 0.4, 700, 90, 0.5); blip(110, 0.18, 'sawtooth', 0.12, -40); },
    step(run)   { noise(0.07, run ? 0.1 : 0.06, rand(750, 1050), 180, 0.4); },
    jump()      { noise(0.1, 0.08, 1200, 300, 0.5); },
    land()      { noise(0.16, 0.2, 500, 80, 0.6); },
    carDoor()   { blip(220, 0.08, 'square', 0.12); setTimeout(() => noise(0.1, 0.2, 800, 200), 60); },
    switchW()   { blip(480, 0.04, 'square', 0.07); setTimeout(() => blip(760, 0.05, 'square', 0.09), 90); },
    throwNade() { noise(0.13, 0.12, 1600, 380, 0.5); },
    bounce()    { blip(290, 0.035, 'square', 0.05); },
    explosion() { noise(0.95, 0.75, 320, 38, 0.4); blip(58, 0.55, 'sine', 0.35, -32); blip(120, 0.3, 'sawtooth', 0.15, -70); },
    pickup()    { blip(880, 0.06, 'triangle', 0.11); setTimeout(() => blip(1320, 0.08, 'triangle', 0.12), 80); },
    medkit()    { blip(620, 0.08, 'sine', 0.12); setTimeout(() => blip(930, 0.12, 'sine', 0.12), 140); },
    roar()      { blip(88, 0.85, 'sawtooth', 0.3, -42); noise(0.75, 0.4, 480, 55, 0.6); },
    stomp()     { noise(0.4, 0.55, 220, 45, 0.6); blip(70, 0.3, 'sine', 0.25, -25); },
    slide()     { noise(0.28, 0.13, 850, 220, 0.5); },
    bossShot()  { noise(0.2, 0.28, 900, 120, 0.8); blip(220, 0.16, 'sawtooth', 0.12, -120); },
    victory()   { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.22, 'triangle', 0.16), i * 130)); },
    thunder()   { noise(1.5, 0.5, 220, 28, 0.3); blip(44, 1.1, 'sine', 0.26, -18); },
    laser()     { blip(1800, 0.09, 'square', 0.13, -1300); blip(900, 0.05, 'sawtooth', 0.06, -400); },
    rocket()    { noise(0.9, 0.32, 900, 180, 0.6); blip(120, 0.4, 'sawtooth', 0.1, 60); },
    pop()       { noise(0.05, 0.3, 1500, 250, 2.2); },
    groan()     { blip(rand(68, 105), 0.75, 'sawtooth', 0.13, -22); },
    whisper()   { noise(1.0, 0.07, 2200, 500, 0.2); },
    deathSting(){ [220, 174, 146, 110].forEach((f, i) => setTimeout(() => blip(f, 0.55, 'triangle', 0.15), i * 230)); },
    eat()       { noise(0.12, 0.16, 1200, 280, 1); blip(300, 0.09, 'sine', 0.1); },
    unlock()    { [523, 659, 784].forEach((f, i) => setTimeout(() => blip(f, 0.16, 'triangle', 0.14), i * 105)); },
    /* ---- evento de destruição da cidade ---- */
    missileIncoming() { // sirene grave + rasgo de ar
      blip(220, 1.6, 'sawtooth', 0.1, -60);
      noise(1.8, 0.16, 2400, 300, 0.4);
      setTimeout(() => blip(180, 1.4, 'sawtooth', 0.09, -50), 700);
    },
    warheadRelease() { // estalos metálicos + assobios agudos caindo
      for (let i = 0; i < 5; i++) setTimeout(() => {
        blip(1400 - i * 120, 0.5, 'triangle', 0.07, -900);
        noise(0.2, 0.08, 3600, 800, 1.2);
      }, i * 130);
    },
    cityImpact() { // detonação em camadas: sub + corpo + estilhaço
      blip(38, 1.6, 'sine', 0.5, -20);
      noise(1.6, 0.9, 380, 30, 0.35);
      blip(90, 0.9, 'sawtooth', 0.25, -55);
      setTimeout(() => noise(1.1, 0.5, 700, 60, 0.5), 180);
      setTimeout(() => noise(2.4, 0.3, 240, 25, 0.3), 500);
    },
    distantRumble() { // ribombo distante contínuo (pós-impacto)
      noise(2.8, 0.2, 160, 22, 0.25);
      blip(46, 2.2, 'sine', 0.12, -12);
    },
    setVolumes() { if (master) master.gain.setTargetAtTime(SETTINGS.vol, ctx.currentTime, 0.1); },
    engineStart() {
      if (!ctx || engineOsc) return;
      engineOsc = ctx.createOscillator(); engineOsc.type = 'sawtooth'; engineOsc.frequency.value = 48;
      engineOsc2 = ctx.createOscillator(); engineOsc2.type = 'sawtooth'; engineOsc2.frequency.value = 48.6;
      engineSub = ctx.createOscillator(); engineSub.type = 'sine'; engineSub.frequency.value = 24;
      engineLfo = ctx.createOscillator(); engineLfo.type = 'sine'; engineLfo.frequency.value = 26;
      const lfoG = ctx.createGain(); lfoG.gain.value = 5;
      engineLfo.connect(lfoG); lfoG.connect(engineOsc.frequency);
      engineFilter = ctx.createBiquadFilter(); engineFilter.type = 'lowpass'; engineFilter.frequency.value = 320; engineFilter.Q.value = 1.6;
      engineGain = ctx.createGain(); engineGain.gain.value = 0.0;
      const g1 = ctx.createGain(); g1.gain.value = 0.5;
      const g2 = ctx.createGain(); g2.gain.value = 0.38;
      const g3 = ctx.createGain(); g3.gain.value = 0.55;
      engineOsc.connect(g1); engineOsc2.connect(g2); engineSub.connect(g3);
      g1.connect(engineFilter); g2.connect(engineFilter); g3.connect(engineFilter);
      engineFilter.connect(engineGain); engineGain.connect(master);
      // escape: ruído grave borbulhando junto do acelerador
      const exh = ctx.createBufferSource(); exh.buffer = noiseBuf; exh.loop = true;
      const exhF = ctx.createBiquadFilter(); exhF.type = 'bandpass'; exhF.frequency.value = 130; exhF.Q.value = 1.1;
      exhGain = ctx.createGain(); exhGain.gain.value = 0;
      exh.connect(exhF); exhF.connect(exhGain); exhGain.connect(master);
      engineOsc.start(); engineOsc2.start(); engineSub.start(); engineLfo.start(); exh.start();
    },
    engineUpdate(speedKmh, on, throttle = 0, profile = 'normal') {
      if (!ctx || !engineOsc) return;
      const t = ctx.currentTime;
      // caixa de marchas: o RPM sobe dentro da marcha e cai na troca (vrum-vrum)
      const gearLen = profile === 'sport' ? 32 : 26;
      const gear = Math.min(5, Math.floor(speedKmh / gearLen));
      const frac = clamp((speedKmh - gear * gearLen) / gearLen, 0, 1);
      const pm = profile === 'sport' ? 1.6 : profile === 'truck' ? 0.68 : 1;
      const rpm = (46 + frac * 74 + gear * 7 + throttle * 6) * pm;
      engineOsc.frequency.setTargetAtTime(rpm, t, 0.07);
      engineOsc2.frequency.setTargetAtTime(rpm * 1.013, t, 0.07);
      engineSub.frequency.setTargetAtTime(rpm / 2, t, 0.08);
      engineFilter.frequency.setTargetAtTime((250 + frac * 680 + throttle * 420) * (profile === 'sport' ? 1.5 : 1), t, 0.1);
      engineGain.gain.setTargetAtTime(on ? 0.1 + throttle * 0.05 : 0, t, on ? 0.12 : 0.25);
      exhGain.gain.setTargetAtTime(on ? (profile === 'truck' ? 0.05 : 0.018) + throttle * (profile === 'sport' ? 0.08 : 0.05) : 0, t, 0.15);
    },
    heliUpdate(on, lift) {
      if (!ctx) return;
      if (!heliGain) { // whump-whump: ruído modulado por LFO
        const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 120; f.Q.value = 1.3;
        const amp = ctx.createGain(); amp.gain.value = 0.5;
        heliLfo = ctx.createOscillator(); heliLfo.frequency.value = 12;
        const lg = ctx.createGain(); lg.gain.value = 0.5;
        heliLfo.connect(lg); lg.connect(amp.gain);
        heliGain = ctx.createGain(); heliGain.gain.value = 0;
        s.connect(f); f.connect(amp); amp.connect(heliGain); heliGain.connect(master);
        s.start(); heliLfo.start();
      }
      heliGain.gain.setTargetAtTime(on ? 0.15 + lift * 0.06 : 0, ctx.currentTime, 0.35);
      heliLfo.frequency.setTargetAtTime(on ? 12 + lift * 4 : 8, ctx.currentTime, 0.4);
    },
    musicStart() { // sem música/vento: liga só a camada de chuva (clima)
      if (!ctx || musicOn) return;
      musicOn = true;
      const r = ctx.createBufferSource(); r.buffer = noiseBuf; r.loop = true;
      const rF = ctx.createBiquadFilter(); rF.type = 'bandpass'; rF.frequency.value = 2800; rF.Q.value = 0.25;
      rainGain = ctx.createGain(); rainGain.gain.value = 0;
      r.connect(rF); rF.connect(rainGain); rainGain.connect(master);
      r.start();
    },
    musicUpdate() {
      if (!ctx || !musicOn || !rainGain) return;
      rainGain.gain.setTargetAtTime(rainAmt * 0.13, ctx.currentTime, 1.5);
    },
    setRain(k) { rainAmt = k; },
  };
}
