export function createDmgNums(deps) {
  const { rand, _v1, camera } = deps;
  const N = 16, pool = [];
  for (let i = 0; i < N; i++) {
    const d = document.createElement('div');
    d.className = 'dmgnum';
    document.body.appendChild(d);
    pool.push({ d, busy: false });
  }
  let idx = 0;
  function spawn(worldPos, amount, head) {
    const p = pool[idx]; idx = (idx + 1) % N;
    _v1.copy(worldPos).project(camera);
    if (_v1.z > 1) return;
    const x = (_v1.x * 0.5 + 0.5) * window.innerWidth + rand(-14, 14);
    const y = (-_v1.y * 0.5 + 0.5) * window.innerHeight + rand(-8, 8);
    const d = p.d;
    d.className = 'dmgnum' + (head ? ' head' : '');
    d.textContent = head ? amount + '!' : amount;
    d.style.transition = 'none';
    d.style.left = x + 'px';
    d.style.top = y + 'px';
    d.style.opacity = '1';
    d.style.transform = 'translate(-50%,-50%) scale(0.7)';
    requestAnimationFrame(() => {
      d.style.transition = 'transform .7s cubic-bezier(.17,.67,.4,1), opacity .7s linear';
      d.style.transform = `translate(-50%, calc(-50% - 52px)) scale(${head ? 1.25 : 1.05})`;
      d.style.opacity = '0';
    });
  }
  return { spawn };
}
