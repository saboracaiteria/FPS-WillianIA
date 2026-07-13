/* Lê o cabeçalho JSON de um .glb (sem precisar do three.js) e resume
   o que interessa pra decidir como integrar: animações, ossos/skins, malhas.
   Uso: node scripts/inspect-glb.js "caminho/arquivo.glb" [...mais arquivos] */
'use strict';
const fs = require('fs');

function readGlbJson(path) {
  const buf = fs.readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('não é um .glb válido (magic incorreto)');
  const jsonLen = buf.readUInt32LE(12);
  const json = buf.slice(20, 20 + jsonLen).toString('utf8');
  return JSON.parse(json);
}

for (const path of process.argv.slice(2)) {
  console.log('\n=== ' + path + ' ===');
  try {
    const g = readGlbJson(path);
    const bytes = fs.statSync(path).size;
    console.log(`tamanho: ${(bytes / 1024).toFixed(0)} KB`);
    console.log(`nós: ${(g.nodes || []).length} | malhas: ${(g.meshes || []).length} | materiais: ${(g.materials || []).length}`);
    const skins = g.skins || [];
    console.log(`skins (rig): ${skins.length}`);
    for (const s of skins) console.log(`  - "${s.name || '(sem nome)'}" · ${(s.joints || []).length} ossos`);
    const anims = g.animations || [];
    console.log(`animações: ${anims.length}`);
    for (const a of anims) console.log(`  - "${a.name || '(sem nome)'}" · ${a.channels.length} canais`);
    if (!anims.length) console.log('  (nenhuma animação embutida — vai precisar de animação externa ou procedural)');
    // nomes de nós de alto nível (ajuda a achar "mão", "arma", "cabeça" etc.)
    const topNames = (g.nodes || []).map(n => n.name).filter(Boolean).slice(0, 40);
    console.log('nomes de nós (amostra): ' + topNames.join(', '));
  } catch (e) {
    console.log('ERRO ao ler: ' + e.message);
  }
}
