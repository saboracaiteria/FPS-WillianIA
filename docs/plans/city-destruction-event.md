# Evento de Destruição da Cidade — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> (execução inline nesta sessão). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Evento multiplayer sincronizado onde mísseis destroem a cidade 90s
após o início da partida, com cinematográfica determinística igual para todos,
troca permanente da cidade (visual + colisão) e mortes autoritativas no servidor.

**Architecture:** O servidor é a fonte de verdade (timestamps absolutos +
seed). Um módulo de protocolo compartilhado (CJS+browser) fornece a timeline e
a distribuição determinística de mísseis/ogivas. `Structures.city` vira um
módulo fundo (interface pequena: destroy/restore/containsPoint) escondendo o
registro de visuais, paredes, plataformas e corpos físicos. O cliente ganha
`city-destruction-client.js` (timeline+câmera+efeitos+renderer) com apenas
2 pontos de contato no core: `state.cinematic` e uma chamada no `tick`.

**Tech Stack:** JS puro, Three.js (import map), Cannon-ES, Express, Socket.IO,
node:test + socket.io-client (server), Playwright Python com Chrome do sistema (e2e).

## Global Constraints (da spec, verbatim onde exato)

- NÃO adicionar: React, R3F, TypeScript, bundler, Vite, Next, outro motor 3D/servidor.
- Flag do lobby: `Destruição automática da cidade`, **habilitada por padrão**, só o host altera (validação NO SERVIDOR).
- Atraso de produção: **90s** (`CITY_DESTRUCTION_DELAY_MS=90000`), impacto **+8,5s** (`CITY_DESTRUCTION_IMPACT_DELAY_MS=8500`) — knobs SÓ no servidor.
- Estados da cidade: `'intact' | 'cinematic' | 'destroyed'`.
- Míssil destacado assinado `By RenatoDReis` via `CanvasTexture` presa ao míssil (não HTML).
- Raio letal inicial: `CITY_KILL_RADIUS = 100` (do centro `CITY = {x:-340, z:130}`).
- Morte por míssil: ignora armadura/invulnerabilidade/pausa, sem kill pra ninguém, sem morte duplicada. Mensagem da vítima: `Você morreu atingido pelo ataque de mísseis próximo à cidade!`. Kill feed: `{nick} morreu no ataque de mísseis à cidade`.
- Não usar `state.gameTime` como relógio multiplayer; não usar `setTimeout(90000)` por navegador como verdade.
- Versão destruída construída no boot (invisível), troca no impacto; InstancedMesh/pooling/materiais compartilhados; poucos colisores de escombros.
- Modo solo preservado (fallback local do evento, opcional — implementado).
- Servidor continua servindo SÓ arquivos públicos whitelisted.

## Desvios conscientes da spec (adaptação ao código atual — a spec permite)

| Spec pede | O jogo atual tem | Decisão |
|---|---|---|
| host = 1º a entrar + migração pro mais antigo | host por SENHA (`QUEDALIVRE`), sem herança (pedido explícito do dono do projeto em rodada anterior) | **manter senha**; "host transferido" vira "host fica vago" (testado) |
| criar lobby a partir do menu local | lobby BR completo já existe (flags, lista, start) | flag entra nas REGRAS DA SALA existentes (`flags.cidade`) |
| eventos `matchState/matchStarted/...` | protocolo existente `init/flags/matchStart/playerKilled` | reaproveitar seams existentes; novos: `cityDestruction` (estado), morte via `playerKilled {byCity:true}` |
| `requestRespawn` próprio | BR não tem respawn (vira espectador); `died` de morto já é ignorado e sem kill | fluxo BR mantido; sem morte/kill duplicada (já testado) |
| `tests/city-destruction-server.test.js` | suíte vive em `test/*.test.js` (node --test test/) | `test/city-destruction-server.test.js` (mesmo padrão) + `tests/city-destruction-e2e.py` como pedido |
| terminal de save da cidade | sistema de save foi removido do jogo | registrar apenas o que existe (baú, carros, torre) |
| clock sync ping/pong dedicado | `pingx` (RTT) + `serverNow` no init/matchStart já existem | refinar `clockOffset` com RTT/2 do ping existente |

## Estrutura de arquivos

| Arquivo | Responsabilidade (módulo fundo, interface pequena) |
|---|---|
| `city-destruction-protocol.js` (novo, raiz, compartilhado CJS+browser) | timeline (fases/durações), `buildCityEvent(seed, quality)` → mísseis/ogivas/impactos determinísticos, `CITY_KILL_RADIUS`, centro/raio |
| `city-destruction-client.js` (novo, script clássico como br-game) | Timeline+Camera+Renderer+Effects: `window.__CityDestruction = { init(ctx), sync(city), tick(dt), active }` |
| `server.js` (modificar) | flags.cidade, `match.cityDestruction`, agendamento em `startMatch`, resolução de mortes no `impactAt`, knobs env, init/reset, whitelist +2 arquivos |
| `js/structures.js` (modificar) | registro `city*` durante cityBox + `Structures.city = { center, radius, containsPoint, getState, setState, destroy, restore, registerBody, registerDestroyed }` |
| `game.js` (modificar) | `state.cinematic` (skip playerUpdate/shoot/câmeras), 1 chamada `__CityDestruction.tick(dt)`, tag city nos corpos CANNON → `Structures.city.registerBody`, fallback solo, `SFX.missileIncoming/warheadRelease/cityImpact/distantRumble` em `js/sfx.js` |
| `br-game.js` (modificar) | plan.city no matchStart → `__CityDestruction.sync`; init idem (late join); morte `byCity` → forceDeath com mensagem própria; killfeed próprio |
| `multiplayer-client.js` (modificar) | checkbox da flag no lobby (REGRAS DA SALA); refino do clockOffset com RTT/2 |
| `test/city-destruction-server.test.js` (novo) | os 20 cenários de servidor da spec |
| `tests/city-destruction-e2e.py` (novo) | 2 jogadores Playwright (Renato/William), screenshots, verificações da spec |

## Estado no servidor (formato real)

```js
// em match:
flags: { golem, animais, zumbis, bots, ciclo, cidade: true },
cityDestruction: {
  eventId: null,          // 'city-<num>-<seed>'
  seed: null,             // uint32 determinístico (derivado de match.seed)
  state: 'intact',        // 'intact' | 'cinematic' | 'destroyed'
  cinematicStartedAt: null, // Date.now() absoluto
  impactAt: null,
},
```

- `startMatch()` com `flags.cidade`: `cinematicStartedAt = t0 + DELAY`,
  `impactAt = cinematicStartedAt + IMPACT_DELAY`, `seed = (match.seed ^ 0xC17DE57) >>> 0`,
  `eventId = 'city-' + match.num + '-' + seed`; entra em `plan.city` (congelado, broadcast via matchStart).
- Ticker de 250ms do servidor (não setTimeout isolado): quando `now >= cinematicStartedAt`
  → `state='cinematic'` + emit `cityDestruction`; quando `now >= impactAt` → resolve
  mortes (posições `p.pos` já rastreadas; `hypot(pos-CITY) <= 100` e vivo → morre,
  placement, `playerKilled {byCity:true, weapon:'MÍSSEIS', killerId:null}`), `state='destroyed'`,
  emit `cityDestruction`, `checkVictory()`. **Uma única vez** (guard por eventId).
- `init` envia `cityDestruction` sempre (reconexão/late join). Reset no `startMatch`
  seguinte e quando a sala esvazia (`players.size===0` → flags default + cidade intacta).

## Timeline determinística (protocolo compartilhado)

```js
PHASES = { skyPan: [0, 3], missileClose: [3, 5.5], wide: [5.5, 7],
           mirv: [7, 8.5], impact: 8.5, aftermath: [8.5, 12] };
buildCityEvent(seed, quality) => {
  counts: low {missiles:6, warheads:12} | medium {10,24} | high {16,40},
  missiles: [{ from(xyz alto, anel raio 600-900), to(ponto urbano), delay }],
  signedIndex: seed % missileCount (mesmo em toda qualidade: assinado = índice 0
    da lista CANÔNICA de 6 — os 6 primeiros são idênticos em todas as qualidades),
  impacts: 8 pontos principais (lots da cidade, determinístico por seed) — iguais
    em toda qualidade; extras visuais além dos 8 variam por qualidade,
}
```

Qualidade local: `SETTINGS.res` (1→low, 1.5→medium, 2→high). Compartilhado entre
todos: míssil assinado, 8 impactos principais, timestamps, estado final, mortes.

## Tarefas

### Task 1: Protocolo compartilhado (TDD unidade)
**Files:** Create `city-destruction-protocol.js`, `test/city-destruction-server.test.js` (parte unidade)
**Produces:** `CityDestructionProtocol = { CITY_KILL_RADIUS, PHASES, DELAY_DEFAULT, IMPACT_DELAY_DEFAULT, buildCityEvent(seed, quality) }` — CJS `module.exports` + `window.CityDestructionProtocol`.
- [ ] Teste falhando: mesmo seed ⇒ mesmos impactos/míssil assinado nas 3 qualidades; seeds diferentes ⇒ eventos diferentes; 8 impactos dentro do raio da cidade.
- [ ] Rodar (FAIL: módulo não existe) → implementar (mulberry32 local, lots fixos) → PASS → commit.

### Task 2: Servidor — flag, agendamento, mortes (TDD integração)
**Files:** Modify `server.js`; Test `test/city-destruction-server.test.js`
**Interfaces produzidas:** `flags.cidade` (bool, default true, host-only, sanitizado); `plan.city = {eventId, seed, cinematicStartedAt, impactAt} | null`; evento `cityDestruction {state, eventId, seed, cinematicStartedAt, impactAt}`; `playerKilled {byCity:true, weapon:'MÍSSEIS'}`; `init.cityDestruction`; env `CITY_DESTRUCTION_DELAY_MS`/`CITY_DESTRUCTION_IMPACT_DELAY_MS`.
- [ ] Escrever os cenários 1–20 da spec (adaptados) — FAIL.
- [ ] Implementar estado+ticker+resolução; whitelist `city-destruction-client.js`/`city-destruction-protocol.js`; PASS; commit.
Cenários (nomes reais no arquivo): flag default true; só host altera; matchStart congela plan.city; env encurta só no teste; evento único (2 ticks não duplicam); vítima no raio morre / fora sobrevive; armadura/invuln não salvam (morte é decisão do servidor, não passa por playerDamage do cliente); sem kill creditada; reconexão recebe `destroyed`; late join não recebe cinemática do zero (timestamps antigos); cliente não força impacto (emitir `cityDestruction` de cliente = ignorado); cliente não escolhe vítimas; reset ao esvaziar; flag desabilitada ⇒ sem agendamento.

### Task 3: `Structures.city` — registro e troca do mundo (TDD via harness)
**Files:** Modify `js/structures.js`, `game.js`; Test em `test/collision.test.js` (+2 cenários) e `test/city-destruction-client.test.js` (novo, harness Chrome)
**Interface produzida:**
```js
Structures.city = {
  center: {x,z}, radius: 95,
  containsPoint(x, z),                  // hypot <= radius
  getState(), // 'intact'|'destroyed'
  destroy(),  // esconde intacto, mostra destruído, remove walls/platforms/bodies da cidade, instala escombros
  restore(),  // caminho inverso (usado no reset/solo)
  registerBody(body),                   // game.js registra corpos CANNON de walls city
  registerDestroyed(group, colliders),  // client registra visual destruído + colisores simples
};
```
- [ ] cityBox marca `walls.push({..., city:true})` e `platforms.push({..., city:true})`; ruas/torre idem; `cityGeos → cityMesh` referenciado.
- [ ] game.js: no loop de corpos, `if (b.city) Structures.city.registerBody(wb)`.
- [ ] Testes: (a) `destroy()` ⇒ jogador ATRAVESSA onde havia prédio e bala passa (rayHit sem a parede), carro atravessa (corpo removido), telhado deixa de ser plataforma; (b) `restore()` ⇒ tudo volta; (c) forte/cabanas intactos (wall não-city continua colidindo). FAIL → implementar → PASS → commit.

### Task 4: Cliente — visual destruído + timeline + câmera + efeitos
**Files:** Create `city-destruction-client.js`; Modify `game.js` (state.cinematic, tick hook, SFX novos em `js/sfx.js`), `index.html` (script tag), `br-game.js` (sync/byCity), `multiplayer-client.js` (flag UI + clock RTT/2)
**Interface:** `window.__CityDestruction = { init({MP,G,protocol}), sync(city), tick(dt), get active() }`.
- [ ] Boot: construir versão destruída invisível (stubs inclinados por lot, InstancedMesh de entulho ~120 instâncias, vigas, chão escurecido CircleGeometry, 3 focos de fogo com 2 PointLights + sprites de fumaça pooled) e `Structures.city.registerDestroyed(...)` com 6 colisores-caixa baixos (walls não-city + bodies CANNON com updateAABB).
- [ ] Timeline por `elapsed = (Date.now()+clockOffset) - cinematicStartedAt` (fases da spec: pan céu 0–3, close no míssil assinado 3–5.5 com CanvasTexture "By RenatoDReis", wide 5.5–7, MIRV 7–8.5, impacto 8.5 = flash+trauma+`Structures.city.destroy()`+SFX.cityImpact, retorno 8.5–12 restaurando câmera/FOV/controles/carro/heli).
- [ ] `state.cinematic`: tick pula playerUpdate/shootUpdate/applyFpsCamera/carCameraUpdate; brTick pula gás/spectStep; input ignorado (sem `controls.unlock()`).
- [ ] Morte `byCity`: em `playerKilled`, se `byCity && victimId===eu` → deathSub = mensagem da spec + forceDeath (ignora armadura/invuln/pausa — infra existente); killfeed `«nick» morreu no ataque de mísseis à cidade`.
- [ ] Solo fallback: sem socket, `startGame` agenda evento local (Date.now()+90s, seed aleatória) — jogo nunca depende do servidor pra renderizar.
- [ ] Late join destroyed: `sync({state:'destroyed'})` aplica `destroy()` antes do 1º frame jogável, sem cinemática.
- [ ] Commit.

### Task 5: Testes de cliente no harness (Chrome headless)
**Files:** Create `test/city-destruction-client.test.js`
- [ ] Partida BR com `CITY_DESTRUCTION_DELAY_MS=1500`, `IMPACT=2000`: cinemática liga `state.cinematic`; jogador NÃO anda durante; impacto troca `Structures.city.getState()==='destroyed'`; câmera restaurada (pos ≈ pré-cinemática, cinematic=false); jogador dentro do raio morre com a mensagem da spec; fora sobrevive; zero pageerrors. FAIL→verde→commit.

### Task 6: E2E Playwright 2 jogadores + screenshots
**Files:** Create `tests/city-destruction-e2e.py`; Modify `package.json` (script `test:e2e`)
- [ ] pip playwright (channel=chrome); 2 contexts (Renato host via ?host=, William); delay reduzido; verificar: mesma sessão, flag editável só no host, mesmo eventId/seed/timestamps, cinemática nos dois, `By RenatoDReis` presente (texture flag exposta), impacto ±300ms, cidade destruída nos dois, perto morre/longe vive, câmera/controles voltam, console limpo, socket ativo. Screenshots 1–7 da spec em `docs/plans/e2e-shots/`. Commit.

### Task 7: Verificação final (skill verification-before-completion)
- [ ] `npm install`, `npm test` completo, `npm run lint`, mutação (2 mutantes novos: raio letal ignorado; destroy() sem remover corpos), e2e, solo, host cai, entrar durante/depois, FPS lógico (stress --client), corpos órfãos (world.bodies count pós-destroy), leaks (renderer.info). Registrar evidências no relatório final. Commit + push.

## Como ajustar depois (para o dono do projeto)

- Atraso: `CITY_DESTRUCTION_DELAY_MS` (servidor). Impacto: `CITY_DESTRUCTION_IMPACT_DELAY_MS`.
- Raio letal: `CITY_KILL_RADIUS` em `city-destruction-protocol.js`.
- Mísseis/ogivas por qualidade: tabela `QUALITY` no mesmo arquivo.
- Duração das fases: `PHASES` no mesmo arquivo (servidor e clientes leem juntos).
