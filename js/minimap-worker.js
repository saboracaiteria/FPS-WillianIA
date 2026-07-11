/* Worker do minimapa (PARALELISMO): recebe um Float32Array compacto de posições
   e desenha o radar num OffscreenCanvas — fora da thread principal do jogo.
   Layout do buffer: [yaw, px, pz, carX, carZ,
     nPickups, (x,z)*n, nInimigos, (x,z,hot)*n, nBosses, (x,z,alien)*n] */
'use strict';
const TAU = Math.PI * 2;
const S = 168, C = S / 2, RANGE = 95;
let ctx = null, sites = [];

onmessage = (ev) => {
  const d = ev.data;
  if (d.type === 'init') {
    ctx = d.canvas.getContext('2d');
    sites = d.sites;
    return;
  }
  if (!ctx || d.type !== 'draw') return;
  const b = d.b;
  let i = 0;
  const yaw = b[i++], px = b[i++], pz = b[i++], carX = b[i++], carZ = b[i++];
  ctx.clearRect(0, 0, S, S);
  ctx.save();
  ctx.translate(C, C);
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  for (const r of [C * 0.45, C * 0.85]) { ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(-C, 0); ctx.lineTo(C, 0); ctx.moveTo(0, -C); ctx.lineTo(0, C); ctx.stroke();
  ctx.rotate(yaw); // gira o mundo: "pra cima" = direção do olhar
  const put = (wx, wz) => [(wx - px) / RANGE * C, (wz - pz) / RANGE * C];
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('N', 0, -C + 14);
  { // carro
    const [x, y] = put(carX, carZ);
    if (x * x + y * y < C * C * 0.92) { ctx.fillStyle = '#4dd8ff'; ctx.fillRect(x - 3.5, y - 3.5, 7, 7); }
  }
  ctx.fillStyle = 'rgba(225,225,225,0.45)'; // construções (estáticas, enviadas no init)
  for (let s = 0; s < sites.length; s += 2) {
    const [x, y] = put(sites[s], sites[s + 1]);
    if (x * x + y * y < C * C * 0.92) ctx.fillRect(x - 2, y - 2, 4, 4);
  }
  let n = b[i++]; // pickups
  ctx.fillStyle = '#7dff8a';
  for (let k = 0; k < n; k++) {
    const [x, y] = put(b[i++], b[i++]);
    if (x * x + y * y < C * C * 0.92) ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
  }
  n = b[i++]; // inimigos
  for (let k = 0; k < n; k++) {
    const [x, y] = put(b[i++], b[i++]);
    const hot = b[i++] > 0.5;
    if (x * x + y * y > C * C * 0.92) continue;
    ctx.fillStyle = hot ? '#ff4030' : 'rgba(255,120,90,0.8)';
    ctx.beginPath(); ctx.arc(x, y, hot ? 4 : 3, 0, TAU); ctx.fill();
  }
  n = b[i++]; // bosses: losangos presos à borda quando longe
  for (let k = 0; k < n; k++) {
    let [bx, by] = put(b[i++], b[i++]);
    const alien = b[i++] > 0.5;
    const dEdge = Math.hypot(bx, by), maxR = C * 0.84;
    if (dEdge > maxR) { bx *= maxR / dEdge; by *= maxR / dEdge; }
    ctx.fillStyle = alien ? '#35ffc8' : '#ff7a1e';
    ctx.beginPath();
    ctx.moveTo(bx, by - 7); ctx.lineTo(bx + 5.5, by); ctx.lineTo(bx, by + 7); ctx.lineTo(bx - 5.5, by);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke();
  }
  ctx.restore();
  // seta do player no centro (aponta pra cima por construção)
  ctx.save();
  ctx.translate(C, C);
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill();
  ctx.restore();
};
