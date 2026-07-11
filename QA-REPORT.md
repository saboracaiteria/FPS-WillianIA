# QA — Mapa de bugs do Battle Royale

Auditoria completa (código + testes) do modo Battle Royale, em duas ondas.
Formato BDD: **Dado / Quando / Então**. Suite automatizada em `test/` (`npm test`, 35 cenários de integração + unidade).

## Bugs corrigidos

| # | Sev. | Área | Bug (BDD) | Correção | Teste |
|---|------|------|-----------|----------|-------|
| 1 | 🔴 crítica | cliente | Dado que morri no BR, quando o jogo processava a morte, então caía no `location.reload()` do modo solo (`__MP_active` nunca era setado) — kill não creditada, vítima virava fantasma | `br-game.js` seta `__MP_active`; morte segue o fluxo online | Combate: kill creditada |
| 2 | 🔴 crítica | servidor | Dado um jogador com aba em segundo plano, quando ficava travado fora da safe/flutuando, então nunca morria e a partida não tinha vencedor | Zona autoritativa no servidor: elimina fora-da-zona, flutuante (>120m) e AFK | Zona: 2 cenários |
| 3 | 🔴 crítica | cliente | Dado que o servidor me eliminou (zona/AFK), quando meu cliente ainda me achava vivo, então eu virava fantasma jogando numa partida onde já morri | `playerKilled` com `victimId == eu` força morte local (`forceDeath` aplicado no primeiro frame possível) | manual |
| 4 | 🟠 alta | servidor | Dado um `state` com posição não numérica, quando repassado, então `NaN` envenenava o lerp dos outros clientes (avatar sumia pra sempre) e cegava a zona | Valida `Number.isFinite` + clamp aos limites do mundo; cliente também descarta | Estado: 2 cenários |
| 5 | 🟠 alta | jogabilidade | Dado que atirei granada/bazuca num jogador, quando explodia, então **não causava dano nenhum** (explosão só feria bots do solo) — bazuca lendária inútil | `__BR_splash()` fere remotos+boss; foguete ganhou espoleta de proximidade pra jogadores | manual (lógica client) |
| 6 | 🟠 alta | jogabilidade | Dado um foguete de bazuca, quando atravessava um prédio, então só explodia no terreno (ignorava paredes) | `Structures.segBlocked` no passo do foguete | manual |
| 7 | 🟠 alta | cliente | Dado que morri dirigindo/voando, quando virava espectador, então a câmera ficava presa no veículo | `__MP_respawn` sai do veículo antes do recap | manual |
| 8 | 🟠 alta | servidor | Dado um atirador morto/espectador ou vítima já morta, quando reportava `shotHit`, então o dano passava | Exige partida ativa + atirador e vítima vivos | Combate: 2 cenários |
| 9 | 🟠 alta | servidor | Dado o baú lendário do GOLEM, quando alguém emitia `openChest {key:'boss'}` com o boss vivo, então levava o loot lendário de graça | Só abre com `bossDead` | Loot |
| 10 | 🟡 média | servidor | Dado `deathDrop`, quando emitido repetidamente, então spawnava loot infinito | Um drop por vida (`canDrop`) | Loot |
| 11 | 🟡 média | servidor | Dado `takeDrop`, quando emitido de longe, então funcionava como aspirador de loot à distância | Exige ≤12 m do drop e estar vivo | Loot |
| 12 | 🟡 média | servidor | Dado um espectador apontado como killer, quando a vítima morria, então o espectador ganhava a kill | Espectador não credita | Combate |
| 13 | 🟡 média | servidor | Dada a sala esvaziada durante a contagem, quando a contagem acabava, então rodava partida vazia presa em `PLAYING` | Volta pro LOBBY se não sobrou ninguém | Lobby |
| 14 | 🟡 média | cliente | Dado que dois jogadores entram no mesmo carro, então os dois "dirigem" o mesmo chassi (glitch de posse) | `__BR_takenCars`: carro ocupado por remoto recusa segundo motorista ("Veículo ocupado!") | manual |
| 15 | 🟡 média | cliente | Dado que estou na nave/queda, quando alguém que pulou antes atira em mim, então eu morria a 250 m de altura | Invulnerabilidade rolante durante SHIP/FALL (aplicada pela vítima) | manual |
| 16 | 🟡 média | cliente | Dado que estou caindo de paraquedas, quando passo perto de um carro, então dava pra "entrar" nele no ar | Interação (tecla E) bloqueada enquanto `__BR_freeze` | manual |
| 17 | 🟡 média | UI | Dado o painel de configurações emprestado ao lobby, quando a tela de morte/vitória redesenhava o lobby, então o painel era **destruído** (configurações sumiam pra sempre) | `rescueSettings()` devolve o painel ao menu antes de qualquer `innerHTML` | manual |
| 18 | 🟢 baixa | UI | Dado que digito num campo (nick/chat/código), quando aperto espaço/teclas, então o jogo capturava e bloqueava a digitação | Jogo ignora teclas quando o alvo é INPUT/TEXTAREA | manual |

## Bugs corrigidos — 2ª onda (busca pesada)

| # | Sev. | Área | Bug (BDD) | Correção | Teste |
|---|------|------|-----------|----------|-------|
| 19 | 🔴 crítica | UX/áudio | Dado que a partida inicia via socket (sem clique), quando o navegador bloqueia autoplay, então o jogo ficava **MUDO** a partida inteira | `SFX.init()+resume()` no primeiro clique (gesto do usuário) | manual |
| 20 | 🔴 crítica | rede | Dada uma queda de conexão, quando o socket.io reconectava, então o servidor criava um id novo → **avatar duplicado** e identidade quebrada | `reconnect` → `location.reload()` (reentra limpo como espectador) | manual |
| 21 | 🟠 alta | exploit | Dado um tiroteio, quando o jogador aperta ESC (pausa), então ficava **imune a dano** (gas e balas) | No BR, `playerDamage` ignora a pausa; AFK backstop cobre o resto | manual |
| 22 | 🟠 alta | chat | Dado o campo de nick, quando se digita letra a letra, então o chat spammava "**fulano entrou**" a cada tecla (hello por keystroke) | Anúncio de entrada só na primeira `hello` | Lobby |
| 23 | 🟠 alta | jogabilidade | Dado um piloto de helicóptero, quando visto por outro jogador, então o avatar dele aparecia **parado no chão** embaixo do heli (alvo fantasma) | Heli sincronizado igual ao carro (pose + ocupação "Helicóptero ocupado!") | manual |
| 24 | 🟡 média | servidor | Dado um jogador morto (não espectador), quando emitia `state`, então pilotava um avatar-marionete pros outros | Servidor descarta state de morto durante a partida | Estado |
| 25 | 🟡 média | anti-cheat | Dado o roster broadcast, então a **posição de todos** ia pra todo mundo (wallhack de graça via console) | `pos` só no init; broadcast sem posição | manual |
| 26 | 🟡 média | servidor | Dado um item de drop forjado (campos gigantes, índices inválidos, HTML), então era armazenado e re-emitido como veio | Sanitização de formato: só campos conhecidos com limites | Loot |
| 27 | 🟡 média | grief | Dado um espectador, quando emitia `openChest`, então **queimava o baú** dos vivos | Baú exige jogador vivo | Loot |
| 28 | 🟢 baixa | servidor | Dado `fromPos` não numérico no tiro, então a seta de dano da vítima recebia NaN | Validação/fallback [0,0,0] | manual |

## Bugs corrigidos — 3ª onda (reporte do usuário) + anti-cheat

| # | Sev. | Área | Bug (BDD) | Correção | Teste |
|---|------|------|-----------|----------|-------|
| 29 | 🟠 alta | visual | Dada a neve caindo, quando os flocos giravam no eixo Y, então viravam quadrados "de lado" (riscos/formato errado) | Flocos hexagonais (CircleGeometry 6 lados) sempre de frente pra câmera, rodopiando no próprio plano | manual |
| 30 | 🟠 alta | mundo | Dado o ciclo dia/noite, quando cada cliente rodava o próprio relógio (pausa, aba oculta, slow-mo de morte), então **cada jogador via um horário diferente** | Horário = função pura do relógio da partida (`todAt(matchT)`), aplicado todo frame; validado em jogo: tod exato pro tempo decorrido | manual |
| 31 | 🟠 alta | mundo | Dado o clima (chuva/neve), quando cada cliente sorteava o próprio, então um via neve e outro sol | Clima determinístico por `seed ^ época` (troca a cada ~75s), igual em todo cliente; validado: override manual é corrigido em 1s | manual |

### Anti-cheat adicionado (servidor)

| Proteção | Regra | Teste |
|----------|-------|-------|
| Speedhack/teleporte | >90 m/s horizontal ou >120 m/s vertical → posição rejeitada; 10 rejeições seguidas re-ancoram (lag legítimo); >120 strikes → expulso | Anti-cheat |
| Abuso do flag "nave" | Dizer que está na nave fora do tempo/rota real (>60m da rota conhecida) → rejeitado e vira AFK pra zona | Zona |
| Dano infinito | Orçamento de 520 dano/s por atirador (pior caso legítimo: fuzil automático só de headshot ≈ 450/s) | Anti-cheat |
| Dano no boss | Orçamento de 1200/s por jogador (cap por hit continua 150) | Loot (boss) |
| Farm de baús | Intervalo mínimo de 300ms entre aberturas | Anti-cheat |
| Já existentes | 12 hits/s, cap 95/hit, baú single-open, drop por proximidade, 1 drop/vida, formato de item sanitizado | suite |

## Testes de unidade novos (`test/plan.test.js`)

- **300 seeds de plano**: 5 fases de zona, raio sempre encolhe, tempos crescentes, centro dentro do mapa, próximo círculo **contido** no atual (senão a safe teleporta)
- **zoneAt ao longo de 900s**: raio monotônico, zona final dói mais
- **500 baús**: tipos conhecidos, arma 0–3 com munição, limites de valores, todas as raridades aparecem

## Comportamentos verificados pela suite (já corretos)

- Sanitização de nick e chat (HTML removido), anti-spam de chat (1,2 s)
- Anti-flood de tiros (máx. 12/s) e teto de dano por mensagem (95)
- Baú abre uma única vez; corrida entre jogadores resolve no servidor
- Suicídio não credita kill; colocação (#) correta; ranking ordenado no fim
- Só o host inicia; código errado negado; host não migra ao desconectar

## Limitações conhecidas (não corrigidas — decisão de escopo)

- **Anti-cheat é leve**: posição dos baús não é validada no servidor (cliente gera pelo seed); dano é reportado pelo atirador (com teto + flood control)
- **Morte por lobo** aparece no feed como "morreu pro gás" (animais continuam ativos no BR)
- **Ranking global em disco**: some quando o serviço reinicia no free tier (cada navegador guarda espelho em localStorage)
- **Pickups do modo solo** continuam spawnando no BR (loot extra de chão — tratado como feature)
- **Dois cliques rápidos** no mesmo drop por jogadores diferentes: o primeiro ack ganha (comportamento correto, mas o segundo vê o item sumir "na mão")

## Knobs de teste (env vars)

`COUNTDOWN_S`, `NEXT_IN_S`, `FLY_TIME`, `BR_FAST` (acelera a zona autoritativa) — usados pela suite; em produção ficam nos padrões.

## Stress test (30/60/100 jogadores) — `npm run stress [n] [--client]`

Enxame de bots socket.io joga uma partida completa: nave → queda → andar
dentro da zona → tiroteio → mortes/drops → vencedor. 5% dos bots "travam"
(aba oculta) e 10% caem no meio — exercitando o backstop da zona e o churn.
Um monitor mede RTT e valida invariantes (1 matchEnd, vencedor coerente,
colocações únicas). `--client` põe um Chrome real no meio do enxame.

| Bots | Resultado | RTT p95 | RSS servidor | Mensagens |
|------|-----------|---------|--------------|-----------|
| 30   | vencedor ok, 29 kills | 1,6 ms | 74 MB | ~99k |
| 60   | vencedor ok, 59 kills | 0,5 ms | 74 MB | ~407k |
| 100  | vencedor ok, 99 kills | 0,5 ms | 98 MB | ~1,14M |
| 60 + cliente real | zero erros JS · 60 avatares · FPS lógico 46 | — | — | — |
| 100 + cliente real | zero erros JS · 100 avatares · FPS lógico 44 | — | — | — |

(FPS lógico = loop do jogo com render desligado, medido em Chrome headless na
MESMA máquina que roda os 100 bots e o servidor — em máquina de jogador, com
GPU real e sem o enxame local, a folga é maior.)

### Bug encontrado e corrigido pelo stress
| # | Sev. | Bug | Correção |
|---|------|-----|----------|
| 32 | 🟡 média | Dado churn de jogadores (entra/sai), então geometrias, materiais e texturas dos avatares e dos drops de loot **nunca eram liberados da GPU** (vazamento crescia partida após partida) | `disposeGroup()` em `removeRemote`/`removeDrop` |

## Testes de colisão (`test/collision.test.js`, 13 cenários)

Todas as camadas: parede AABB pelos 4 lados + expulsão de quem nasce dentro,
andares de prédio (floorY), círculo de árvores/pedras, física CANNON dos
veículos (parede, telhado e tronco), heli vs terreno, bala e explosão barradas
por parede, limites do mundo e empurrão entre jogadores (com bot de rede real).

### Bug crítico encontrado pelos testes de colisão
| # | Sev. | Bug | Correção |
|---|------|-----|----------|
| 33 | 🔴 crítica | Dado qualquer corpo estático criado com `position.set()` após o construtor (paredes, árvores, pedras), então o AABB ficava **na origem para sempre** (o cannon-es calcula na criação e a flag já nasce consumida) → o broadphase nunca enxergava os corpos: **carros atravessavam prédios, árvores e pedras desde sempre** — a colisão de veículos contra o mundo simplesmente não existia | `body.updateAABB()` após posicionar, nos 4 pontos (paredes, árvores, pedras, heightfield) + 2 testes de regressão (telhado e tronco) |

Nota: ninguém percebeu antes porque jogador e balas usam colisão própria em
JS (funcionava); só a física dos veículos dependia do broadphase do CANNON.

## Rodada das hipóteses (TEST-PLAN-HIPOTESES.md) — 4 bugs + 2 blindagens

| # | Sev. | Bug (BDD) | Correção | Teste |
|---|------|-----------|----------|-------|
| 34 | 🟠 alta | Dado um telhado de prédio, quando o jogador pousava nele, então era **cuspido pra fora** (colisão AABB tratava "pés no topo" como "dentro do bloco") e o telhado nem era pisável | Telhados da cidade viram plataformas + `collide` ignora quem está pisando no topo | Colisão 12 |
| 35 | 🟠 alta | Dada uma granada em andar/telhado, então ela **atravessava o piso** e explodia no térreo (quique usava `heightAt`) | Quique usa `groundAt` (+normal reta em plataforma) | Colisão 13 |
| 36 | 🟠 alta | Dado o helicóptero, então ele **atravessava prédios** (só colidia com o terreno) | Push-out AABB no update do heli | Colisão 14 |
| 37 | 🟠 alta | Dado loot dropado em cima de andar/torre, então ele caía 27m até o terreno | `spawnDrop` com `groundAt` | BR-drops |
| 38 | 🟡 média | Dados os dois últimos morrendo juntos, então "sem sobreviventes" com alguém em #1 no ranking (tela contraditória) | Último a morrer vence (`match.lastDead`) | Servidor |
| 39 | 🟡 média | Dado martelar códigos de anfitrião, então dava pra força-bruta sem limite | Cooldown: 5 tentativas por janela | Anti-cheat |

**Hipótese descartada com teste**: spawns de carro seguem saudáveis com a
colisão real ligada (3 seeds — teste fica de regressão).

**Performance (na mesma rodada)**: `sbox`/`cityBox` criavam corpos CANNON
**duplicados e quebrados** (mesmo bug de AABB do #33) — removidos ~400 corpos
mortos do mundo físico; a fonte única é o loop do game.js com `updateAABB()`.

**Novos sistemas de teste**: partida BR real no harness (`startBRMatch`),
proxy TCP de latência (+120ms/sentido) com 3 sentinelas de crash sob lag,
posse de veículo arbitrada no servidor (mata a corrida do "mesmo carro")
com 2 cenários, prune do ranking global (teto de 500) com teste de unidade.

## Auditoria da própria suite (anti falso-positivo) + invariante das entidades

**Mutação (`node scripts/mutation.js`)**: 10 correções quebradas de propósito —
o teste correspondente TEM que ficar vermelho. Resultado final: **10/10
mutantes mortos**. No caminho, a mutação capturou 2 problemas reais na suite:

| Meta-bug | O que era | Correção |
|----------|-----------|----------|
| Teste engolido | O teste "carro parado não atravessa" foi removido acidentalmente por um replace em cadeia ANTES do primeiro commit — a suite parecia cobrir jogador×carro e não cobria (mutante M7 sobreviveu por falta de alvo) | Teste restaurado + o script de mutação agora acusa "pattern sem teste" como erro |
| Oráculo cego a travessia | O mesmo teste olhava só a posição FINAL: com a colisão desligada o jogador atravessava o carro e parava do outro lado a 3m — passava. E o caminho original roçava na fogueira do acampamento, que barrava o jogador antes do carro | Distância MÍNIMA amostrada por tick + aproximação por rota limpa |

**Passes vazios eliminados**: 19 saídas silenciosas (`if (!x) return` quando o
seletor não acha o cenário na seed) viraram `t.skip()` VISÍVEL — e a suite
completa roda com **0 skipped** na seed fixa (toda pré-condição existe).
Oráculos apertados: parede/árvore/empurrão agora exigem que o jogador tenha
realmente CHEGADO no alvo (sem "passou porque nem testou").

**Invariante das entidades (`test/entities.test.js`)**: nenhum boneco voando
ou enterrado — inimigos, animais, pickups, veículos e bosses comparados com o
chão real (groundAt), no spawn e após 5s de IA andando; reporta TODOS os
violadores. O detector foi validado plantando um inimigo a 12m do chão
(acusou na hora). Resultado no jogo: **zero violadores** nos dois cenários.
