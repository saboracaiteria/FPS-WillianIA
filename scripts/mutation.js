/* ================================================================
   MUTAÇÃO — prova contra falsos-positivos: quebra cada correção de
   propósito e exige que o teste correspondente FIQUE VERMELHO.
   Mutante "sobrevivente" (teste continua verde com o código quebrado)
   = falso-positivo comprovado na suite.
   Uso: node scripts/mutation.js
   ================================================================ */
'use strict';
const { execSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const wr = (f, s) => fs.writeFileSync(path.join(ROOT, f), s);

const MUTS = [
  { id: 'M1 granada volta pro heightAt', file: 'js/grenades.js',
    find: 'const gy = groundAt(n.g.position.x, n.g.position.z, n.g.position.y + 0.5)',
    repl: 'const gy = heightAt(n.g.position.x, n.g.position.z)',
    test: 'test/collision.test.js', pattern: 'granada jogada em cima do prédio' },
  { id: 'M2 colisão volta a cuspir do telhado', file: 'js/structures.js',
    find: 'pos.y >= b.y1 - 0.12', repl: 'pos.y > b.y1',
    test: 'test/collision.test.js', pattern: 'POUSAR nele' },
  { id: 'M3 telhado deixa de ser plataforma', file: 'js/structures.js',
    find: "      platforms.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y: y + h / 2, city: true });",
    repl: '',
    test: 'test/collision.test.js', pattern: 'POUSAR nele' },
  { id: 'M4 heli sem colisão de prédio', file: 'js/heli.js',
    find: 'Structures.collide(group.position, 2.3, 2.2);', repl: ';',
    test: 'test/collision.test.js', pattern: 'heli voando contra' },
  { id: 'M5 paredes sem updateAABB (bug #33 de volta)', file: 'game.js',
    find: '  wb.updateAABB(); // CANNON calcula o AABB na criação (origem) e nunca mais — sem isto o broadphase não enxerga o corpo',
    repl: '',
    test: 'test/collision.test.js', pattern: 'carro caindo no telhado' },
  { id: 'M6 jogador sem colisão de parede', file: 'game.js',
    find: '  Structures.collide(player.pos, player.radius, 1.7); // paredes das construções',
    repl: '  ;',
    test: 'test/collision.test.js', pattern: 'nenhum dos 4 lados' },
  { id: 'M7 jogador atravessa carro parado', file: 'game.js',
    find: 'const r = Math.max(v.cfg.half[0], v.cfg.half[2]) * 0.9 + player.radius;',
    repl: 'const r = 0.01;',
    test: 'test/collision.test.js', pattern: 'carro parado' },
  { id: 'M8 kill não creditada', file: 'server.js',
    find: 'if (killer && d.killerId !== socket.id) killer.kills++;',
    repl: 'if (false) killer.kills++;',
    test: 'test/server.test.js', pattern: 'kill é creditada' },
  { id: 'M9 orçamento de dano desligado', file: 'server.js',
    find: "if (p.dmgWindow.reduce((a, e) => a + e.d, 0) + dmgReq > 520) return;",
    repl: "if (p.dmgWindow.reduce((a, e) => a + e.d, 0) + dmgReq > 999999) return;",
    test: 'test/server.test.js', pattern: 'orçamento' },
  { id: 'M10 loot de morte volta pro terreno', file: 'br-game.js',
    find: 'const y = MP.groundAt(pos[0], pos[2], (pos[1] || 0) + 1);',
    repl: 'const y = MP.heightAt(pos[0], pos[2]);',
    test: 'test/br-drops.test.js', pattern: 'deathDrop em cima de uma torre' },
  { id: 'M11 raio letal dos mísseis ignorado (ninguém morre)', file: 'server.js',
    find: 'if (Math.hypot(p.pos[0] - C.x, p.pos[2] - C.z) > R) continue;',
    repl: 'continue;',
    test: 'test/city-destruction-server.test.js', pattern: 'DENTRO do raio morre' },
  { id: 'M12 destroy sem tirar a colisão das paredes da cidade', file: 'js/structures.js',
    find: 'for (let i = walls.length - 1; i >= 0; i--) if (walls[i].city) walls.splice(i, 1);',
    repl: ';',
    test: 'test/city-destruction-client.test.js', pattern: 'parede original some' },
];

(async () => {
  const results = [];
  for (const m of MUTS) {
    const orig = rd(m.file);
    if (!orig.includes(m.find)) {
      results.push({ id: m.id, status: 'ERRO: alvo da mutação não encontrado' });
      console.log(`${'ERRO: alvo não encontrado!'.padEnd(40)} ${m.id}`);
      continue;
    }
    wr(m.file, orig.replace(m.find, m.repl));
    let killed;
    try {
      const r = spawnSync(process.execPath,
        ['--test', `--test-name-pattern=${m.pattern}`, m.test],
        { cwd: ROOT, timeout: 300000, encoding: 'utf8' });
      const out = (r.stdout || '') + (r.stderr || '');
      // pattern que não casa NENHUM teste = suite nem cobre o alvo (pior que sobreviver)
      if (/# pass 0\n/.test(out) && /# fail 0\n/.test(out)) {
        results.push({ id: m.id, status: 'ERRO: pattern não casou teste nenhum (cobertura ausente!)' });
        console.log(`${'ERRO: pattern sem teste!'.padEnd(40)} ${m.id}`);
        continue;
      }
      killed = /# fail [1-9]/.test(out) || r.status !== 0;
    } finally {
      execSync(`git checkout -- ${m.file}`, { cwd: ROOT });
    }
    results.push({ id: m.id, status: killed ? 'MORTO ✔ (teste ficou vermelho)' : 'SOBREVIVEU ✗ FALSO-POSITIVO!' });
    console.log(`${results[results.length - 1].status.padEnd(40)} ${m.id}`);
  }
  const sobreviventes = results.filter(r => r.status.includes('SOBREVIVEU') || r.status.includes('ERRO'));
  console.log(`\n=== ${results.length - sobreviventes.length}/${results.length} mutantes mortos ===`);
  process.exit(sobreviventes.length ? 1 : 0);
})();
