Original prompt: eu adicionei uns projetos em 3d. local uns carros, quero substituir os carros do jogo por eles, mas com performante e teste, consegue? outra coisa acho que em cada partida reiniciada os baus nao estao resetando, cuidado pra nao criar bugs e faca os testes

## Estado atual

- Identificados três modelos-fonte na raiz: `gumball_car.glb`, `low-poly_truck_car_drifter.glb` e `mazda_rx7_stylised.glb`.
- Diagnóstico do reset: `match.openedChests` só é limpo em `startMatch()`. O evento `nextMatch` recarrega os clientes antes disso; o novo `init` do lobby ainda contém os baús abertos da partida encerrada.
- Perfil dos fontes: Gumball 6,52 MB / 456.052 vértices renderizados; caminhão 1,42 MB / 47.676; RX-7 409 KB / 17.199. O Gumball também usa cerca de 26 MB de texturas descomprimidas na GPU.
- Otimização experimental em `/tmp`: Gumball 1,15 MB / 137.041 vértices; caminhão 421 KB / 46.347; RX-7 80 KB / 14.616, todos sem decoder adicional em runtime (`KHR_mesh_quantization`).

## Próximos passos

- Criar e observar falhar o teste de regressão do baú entre partidas.
- Corrigir a limpeza na transição para o lobby e rodar o teste novamente.
- Gerar derivados otimizados em `assets/models/`, integrar um carregador com cache e fallback e manter as colisões/física existentes.
- Adicionar teste de carregamento/normalização/custo dos modelos e testar direção, colisões e screenshots no navegador.

## Ciclo concluído: reset dos baús

- RED confirmado: o novo teste recebeu `openedChests: ['c1']` no `init` após `nextMatch`.
- GREEN confirmado: `resetRoundState()` agora limpa baús, drops e posse de carros antes de publicar o lobby; o teste focado passou (1 teste, 0 falhas).

## Ciclo concluído: modelos dos carros

- RED confirmado: `test/car-models.test.js` falhou inicialmente porque `Car.ready` não existia.
- Três derivados gerados em `assets/models/` com `KHR_mesh_quantization`, sem decoder extra no navegador.
- O RX-7 foi gerado sem o nó `Floor`; o caminhão foi gerado sem 12 nós de fumaça e sem uma animação que o jogo não executava, permitindo consolidar as malhas.
- `js/car.js` agora carrega/cacheia cada fonte uma vez, clona geometria/material, normaliza X/Z ao collider, apoia o modelo no chão e mantém fallback barato.
- Rodas procedurais duplicadas foram substituídas por proxies `Object3D` invisíveis usados apenas pela física/poeira.
- GREEN confirmado: teste de modelos passou; lint completo passou sem erros.

## Playtest visual

- O cliente oficial de web game entrou numa partida real; `render_game_to_text` confirmou 6 veículos com `model: ready` e não produziu arquivo de erros de console.
- Screenshots individuais foram capturados e abertos para os três arquétipos.
- A inspeção encontrou o RX-7 preto sem contraste; foi aplicado material Standard nas variantes vermelha/azul e o teste passou de RED para GREEN.
- A inspeção também encontrou o RX-7 invertido no eixo de direção; `modelYaw: Math.PI` foi registrado em teste e confirmado visualmente com a dianteira em `+X`.

## Verificação final

- `RANK_FILE=/tmp/fps-final-verification-rank.json npm test`: 139 testes, 139 passaram, 0 falhas, 0 cancelados, 0 ignorados.
- `npm run lint`: concluído com código 0.
- Testes Chrome/WebGL agora rodam com `--test-concurrency=1`; em paralelo o SwiftShader perdia contextos e gerava falsos negativos.
- Assets finais: Gumball 1.147.872 bytes / 31.991 vértices únicos; RX-7 79.564 / 4.038; caminhão 354.612 / 14.303. Total: 1.582.048 bytes e 50.332 vértices únicos compartilhados.
- `br-rank.json` permaneceu fora do escopo; a verificação final redirecionou ranking para `/tmp`.

## Pendências

- Nenhuma pendência funcional conhecida para esta solicitação.

---

# Atualização: assets 3D completos (armas, corpo FP, monstros, cenário)

Prompt original: integrar a pasta assets/models/ reorganizada (Armas/, Cenários/,
Personagens/, Veículos/) — trocar personagem principal (mãos rigadas em 1ª pessoa),
monstros, armas e cenário; conferir as melhorias pendentes; publicar no GitHub.

## Correções antes de tudo

- Carros estavam QUEBRADOS: a reorganização em subpastas invalidou os caminhos de
  js/car.js. Corrigidos código + teste; o servidor agora serve assets/models/
  inteiro via express.static restrito (a whitelist manual não escalava pra ~25
  arquivos novos).
- harness de teste acha o Chrome no Windows — a suíte inteira (inclusive
  Chrome/WebGL) roda agora na máquina do Willian igual rodava no cloud.

## Ciclo concluído: armas GLB em primeira pessoa (js/weaponmodels.js)

- 7 modelos integrados no padrão do car.js (cache, normalização por bounding box,
  fallback procedural): M4→FUZIL, shotgun pesada→TROVÃO, sniper pesada→DMR,
  bazooka(otimizada 9,2MB→0,8MB)→BAZUCA, arma do alien→PLASMA, e DUAS ARMAS NOVAS:
  SNIPER "AGULHA" (idx 6) e ESCOPETA "RAJADA" (idx 7), com loot/teclas 7-8/balística.
- Auto-orientação: o eixo mais comprido do modelo deita em Z; muzzleAnchor
  reposicionado pra ponta real (flash/tracer saem do cano do GLB).
- A AGULHA usa as animações EMBUTIDAS do GLB ("reload"/"bolt_slide") encaixadas na
  duração real de recarga/ciclo, e os nós mag_4/bolt_6 do modelo foram religados
  nas âncoras parts.mag/parts.bolt — a coreografia de recarga existente move
  geometria real do modelo.

## Ciclo concluído: corpo rigado em primeira pessoa (js/fpbody.js)

- O helldiver (51 ossos, dedos individuais) fica pendurado na câmera, ancorado por
  bounding box (pescoço no olho, cabeça escondida via scale 0 do osso).
- IK analítico de 2 ossos por braço mirando as MESMAS âncoras (gun.parts.handR/L)
  que a coreografia de recarga já anima — pente saindo, tapa, bombeada e sway
  continuam com o timing original, agora com braços e dedos de verdade.
- Punho por alinhamento geométrico: o eixo real dos dedos (medido do rig) alinha
  com a direção da empunhadura + uma rolagem calibrável por mão. Dedos com presets
  por arma (indicador no gatilho, pegada de bomba, faca) e afrouxam na recarga.
- Pernas caminham no ritmo da velocidade (visíveis ao olhar pra baixo), capa
  balança, respiração no peito. Na queda/paraquedas a arma some (mãos nas alças).
- Descobertas do caminho: GLTFLoader remove pontos dos nomes de ossos
  ("Arm_1.L"→"Arm_1L"); braços do modelo são curtos (escala 1.18 pra alcançar o
  grip); waitForFunction do puppeteer usa polling por rAF — com rAF congelado pra
  screenshot determinístico é preciso polling por intervalo.

## Ciclo concluído: monstros rigados (js/charmodels.js)

- Guardiao.glb (Punch/Shoot/Walk embutidas) substituiu o corpo procedural dos
  soldados (clone de esqueleto por instância): Walk com peso pela velocidade,
  Shoot a cada rajada, e SOCO novo quando o player cola (9 de dano, telegrafado,
  cooldown 2,4s). Flash religado no nó MuzzleFlash do próprio rig. Executivos
  (suit) continuam procedurais — são civis. FSM/hitbox/balanceamento intactos.
- Alien otimizado (5,5MB→1,2MB, rig+Take 001 preservados) substituiu o corpo do
  VISITANTE, com a animação embutida em loop. Morte/blink/orbes intactos.

## Ciclo concluído: cenário (js/scenery.js)

- Árvores GLB "assadas" em geometria única com vertex colors → continuam
  instanciadas (1 draw call por variante). Variantes: retorcida, bosquete de
  pinheiros, tocos (8%), e a "giant tree" — que na verdade é uma ILHA FLUTUANTE
  com bonsai — virou marco raro (1/40, só em floresta).
- Materiais texturizados (cor-base branca) recebem paleta de fallback no bake —
  sem isso os pinheiros saíam fantasmas.
- POIs novos com colisão (player+veículos) e baús automáticos do BR: MERCADO na
  beira da cidade, REFÚGIO NA ÁRVORE na floresta, barris espalhados.

## Melhorias da lista do Willian (auditoria)

- Já resolvidas em ciclos anteriores: ping no HUD, música/vento removidos, drop de
  munição ao matar, carro visível pros outros, save removido, dia 3x mais longo
  que a noite, salto automático da nave, opções de gráficos/áudio, código de
  anfitrião, cabine interna do OVNI.
- NOVO watchdog de aba oculta: quem alt-tabava na queda ficava pendurado no ar,
  imortal fora da zona, e a partida não terminava — agora um setInterval (roda em
  segundo plano) faz a queda grosseira e aplica o dano do gás quando o rAF morre.
- SFX: variação de pitch por disparo (rajada não vira metrônomo) e som próprio de
  facada (SFX.melee) no lugar do som de troca de arma.

## Verificação

- npm run lint: 0 erros. Suíte completa + test/asset-models.test.js novo (GLBs
  válidos com rig/animações + integração viva no Chrome).
- Playtest visual: output/fp/ (armas nas mãos, recarga, ADS, corpo em 3ª pessoa)
  e output/world/ (Guardião, Visitante, floresta nova, mercado, refúgio) — todos
  capturados sem erros de console.
