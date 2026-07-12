# Car Models and Chest Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven development and verification-before-completion task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir a frota procedural pelos três GLBs locais com custo de renderização controlado e garantir que os baús renasçam fechados em toda nova partida.

**Architecture:** A física Cannon, índices de veículos e regras multiplayer permanecem intactos; apenas a representação visual de cada arquétipo passa a ser carregada de um GLB otimizado, normalizada para o collider e clonada a partir de um cache por modelo. O estado transitório da rodada será limpo no servidor antes de publicar o lobby seguinte, impedindo que um `init` entre partidas carregue baús antigos.

**Tech Stack:** JavaScript ES modules, Three.js `GLTFLoader`, Cannon ES, Express/Socket.IO, Node test runner, Puppeteer/Chrome e Playwright.

## Global Constraints

- Preservar `br-rank.json`, que já contém mudanças locais do usuário.
- Não alterar dimensões, forças, colisores, índices ou arbitragem multiplayer dos veículos.
- Não depender de Draco/Meshopt em runtime; usar `KHR_mesh_quantization`, suportado diretamente pelo loader.
- Manter fallback visual se um arquivo 3D falhar ao carregar.
- Escrever e observar falhar cada teste de regressão antes da implementação.

---

### Task 1: Reset atômico do estado da rodada

**Files:**
- Modify: `test/server.test.js`
- Modify: `server.js`

**Interfaces:**
- Consumes: evento Socket.IO `nextMatch` e payload `init.openedChests`.
- Produces: `resetRoundState()` chamado antes de o servidor voltar a `LOBBY`.

- [ ] **Step 1: Escrever o teste de regressão**

Adicionar um teste que inicia uma partida de dois clientes, abre `c1`, encerra a rodada, aguarda `nextMatch`, conecta um cliente como se a página tivesse recarregado e exige `init.openedChests` igual a `[]`.

- [ ] **Step 2: Confirmar RED**

Run: `node --test --test-name-pattern="baús da rodada anterior" test/server.test.js`

Expected: FAIL mostrando `['c1']` no `init` do lobby.

- [ ] **Step 3: Implementar a limpeza mínima**

Extrair a limpeza de `openedChests`, `drops`, `dropSeq` e `carOwners` para `resetRoundState()` e chamá-la antes de `match.phase = 'LOBBY'`/`nextMatch`; manter a chamada defensiva no início da partida.

- [ ] **Step 4: Confirmar GREEN**

Run: `node --test --test-name-pattern="baús da rodada anterior" test/server.test.js`

Expected: PASS.

### Task 2: Assets 3D otimizados e carregamento compartilhado

**Files:**
- Create: `assets/models/gumball-car.optimized.glb`
- Create: `assets/models/truck-drifter.optimized.glb`
- Create: `assets/models/mazda-rx7.optimized.glb`
- Modify: `server.js`
- Modify: `js/car.js`
- Create: `test/car-models.test.js`

**Interfaces:**
- Consumes: `cfg.model` com `url`, eixo longitudinal e exclusões; `GLTFLoader.loadAsync(url)`.
- Produces: `Car.ready: Promise`, `vehicle.modelStatus`, e grupos visuais normalizados para os colliders atuais.

- [ ] **Step 1: Gerar derivados otimizados**

Usar glTF Transform com simplificação mais forte apenas no Gumball, paleta/join para reduzir draw calls, texturas limitadas a 512 e quantização padrão WebGL. Manter os fontes originais intactos.

- [ ] **Step 2: Escrever teste de integração dos modelos**

Subir o jogo no Chrome, aguardar `G.Car.ready` e exigir: todos os veículos com `modelStatus === 'ready'`, URLs cobrindo os três derivados, bounds compatíveis com cada collider, nenhuma malha chamada `Floor`, ausência de erros de página e orçamento total de malhas do conjunto carregado.

- [ ] **Step 3: Confirmar RED**

Run: `node --test test/car-models.test.js`

Expected: FAIL porque `Car.ready` e os modelos importados ainda não existem.

- [ ] **Step 4: Implementar o loader/cache/fallback**

Importar `GLTFLoader`; carregar cada URL uma vez; clonar cenas compartilhando geometrias/materiais; retirar piso auxiliar; girar o eixo longitudinal para `+X`; escalar pelo comprimento do collider; centralizar X/Z e apoiar a base no chão. Usar proxies invisíveis das rodas para a física/poeira e desabilitar sombra por malha importada para evitar multiplicação pelas quatro cascatas CSM.

- [ ] **Step 5: Expor os assets com whitelist segura**

Adicionar apenas `/assets/models` como diretório estático e manter `server.js`/`node_modules` inacessíveis.

- [ ] **Step 6: Confirmar GREEN e regressões de veículo**

Run: `node --test test/car-models.test.js test/gameplay.test.js test/collision.test.js test/entities.test.js`

Expected: PASS, incluindo entrada, aceleração, saída, colisão e assentamento dos carros.

### Task 3: Playtest visual e verificação final

**Files:**
- Modify: `progress.md`

**Interfaces:**
- Consumes: servidor local, cliente de jogo Playwright, screenshots e logs do console.
- Produces: evidência visual e de comportamento sem regressão.

- [ ] **Step 1: Rodar suite estática completa**

Run: `npm test && npm run lint`

Expected: zero falhas e zero erros de lint.

- [ ] **Step 2: Rodar jogo real e capturar gameplay**

Usar o cliente Playwright oficial do skill com ações curtas; entrar na partida, aproximar-se de cada arquétipo, dirigir e sair; capturar screenshots de gameplay e inspecioná-las visualmente.

- [ ] **Step 3: Verificar erros e orçamento de renderização**

Confirmar console sem erros 404/GLTF/WebGL, os três modelos visíveis na escala/orientação correta e métricas de geometria/draw calls dentro do orçamento descrito no teste.

- [ ] **Step 4: Registrar resultado**

Atualizar `progress.md` com comandos, resultados, decisões e qualquer pendência real.
