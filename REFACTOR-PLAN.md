# Plano de refatoração do game.js (5.288 linhas) — sem quebrar o brinquedo

Princípio: **nenhuma mudança de lógica e de comportamento**. Cada etapa termina com
o jogo bootando idêntico (specs + smoke no navegador) antes da próxima começar.

## Restrição inegociável: determinismo do mapa

O multiplayer depende de todos os clientes gerarem o MESMO mapa a partir da seed
(`Math.random` é substituído por um gerador seedado, e a **ordem** de consumo dos
números importa). Logo:

- A geração do mundo (árvores, pedras, construções…) **não pode virar assíncrona
  nem mudar de ordem** — descarta Web Worker no boot do mundo.
- A física (cannon-es) em worker adicionaria 1 frame de latência na direção dos
  veículos e exigiria migrar RaycastVehicle+heightfield — risco alto demais para
  esta rodada. Fica documentada como etapa futura (design: mundo físico inteiro no
  worker, comandos via postMessage, transforms de volta por SharedArrayBuffer).

## Etapas

### Etapa 0 — Rede de segurança (specs) ✅
- `three` como devDependency para testar módulos puros em Node.
- `test/game-modules.test.js`: specs de contrato — terreno determinístico com a
  mesma seed, grade de altura ≈ função analítica, API dos módulos extraídos.
- Spec de contrato do boot no navegador: `window.__game`/`__MP` expõem as mesmas
  chaves de antes (a API pública que `br-game.js`/`multiplayer-client.js` usam).
- Suite existente (35 cenários) continua passando — o servidor não muda.

### Etapa 1 — Quebra em módulos ES (mecânica, sem lógica nova) ✅
Padrão: cada sistema vira `createX(deps)` em `js/*.js` — as dependências ficam
**explícitas** na assinatura, o corpo do código não muda (mesmos identificadores
via destructuring). `game.js` vira o orquestrador que chama as fábricas na MESMA
ordem de antes (zero risco de TDZ/ciclo de import).

| Módulo | Conteúdo |
|---|---|
| `js/config.js` | CFG, SETTINGS, persistSettings |
| `js/utils.js` | clamp/lerp/damp/rand/TAU + vetores temporários compartilhados |
| `js/terrain.js` | simplex, heightAt/slopeAt/biomeAt, grade de obstáculos |
| `js/sfx.js` | áudio procedural inteiro |
| `js/fx.js` | partículas, tracers, números de dano |
| `js/structures.js` | construções, paredes, colisão AABB |
| `js/env.js` | céu, dia/noite, clima (chuva/neve) |
| `js/car.js` / `js/heli.js` | veículos |
| `js/weapons.js` | modelos 3D das armas + arsenal |
| `js/items.js` | granadas, foguetes, pickups |
| `game.js` (núcleo) | player, câmera, tiro, HUD, IA, loop — o emaranhado que
  só se separa com testes de gameplay em mãos (etapa futura) |

### Etapa 2 — Lint por módulo ✅
Cada `js/*.js` agora é lintável isoladamente (deps explícitas). `npm run lint`
cobre tudo; zero problemas.

### Etapa 3 — Performance ✅
1. **`heightAt` por grade + bilinear** (a maior vitória): a função analítica roda
   4 oitavas de simplex e é chamada centenas de vezes por frame (player, IA,
   drops, chunks). Depois que o mundo é gerado, uma grade 221×221 (a MESMA malha
   do terreno visível) responde por interpolação bilinear — ~20× mais rápida e
   ainda mais fiel ao chão que o jogador vê. A geração do mundo continua usando a
   analítica na ordem original (determinismo intacto).
2. **Veículos dormem** (`allowSleep`): carros parados não gastam solver de física
   — eram 4+ corpos ativos para sempre.
3. **Minimapa a 15 Hz** em vez de todo frame (canvas 2D no thread principal).
4. **Paralelismo — minimapa em Web Worker (OffscreenCanvas)**: o desenho do radar
   sai do thread principal; o jogo posta um Float32Array compacto de posições e o
   worker desenha. Com fallback automático para o caminho antigo quando o
   navegador não suporta OffscreenCanvas.

### Etapa 4 — Validação final ✅
- `npm test` (35 cenários) + specs novas.
- Smoke no Chrome: boot solo e BR, partida, queda, pouso, zero erros de runtime.
- `npm run lint` zero problemas.

### Etapas futuras (fora desta rodada, por risco)
- Separar o núcleo (player/IA/loop) em módulos — exige specs de gameplay
  (movimento, recoil, IA) que hoje não existem.
- Física em Web Worker (design acima).
- Bundler (Vite) + minificação para produção.
