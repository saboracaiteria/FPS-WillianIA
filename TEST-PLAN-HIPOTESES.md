# Plano de testes — hipóteses de bugs remanescentes

Método das rodadas anteriores: **teste vermelho primeiro** (prova que o bug
existe), correção depois, teste vira regressão permanente. Harness existente:
`test/helpers/harness.js` (Chrome headless + tick manual + seed fixa).

## Infra nova necessária

| Peça | Para quê | Esforço |
|------|----------|---------|
| `startBRMatch(h)` no harness: bot-host conecta, inicia partida, página entra no BR de verdade | H1B, H6 | pequeno (o stress já provou o fluxo) |
| Proxy TCP com atraso configurável (~40 linhas Node) | H6 (latência real) | pequeno |

## Hipóteses e desenhos de teste

### H1A — Granada atravessa andar de prédio 🔴 prioridade 1
- **Dado** o jogador parado num andar elevado (`enemyCamps.floorY`, o mesmo do
  teste de pouso), **quando** joga uma granada quase reta pra cima e espera o
  fuse (~180 ticks), **então** a explosão acontece NO andar — o jogador toma dano.
- **Oráculo**: `player.health < 100`. Se a granada atravessou o piso (quique usa
  `heightAt`, que ignora plataformas), ela explode no térreo e o dano é 0.
- **Arquivo**: `test/collision.test.js`. **Flake**: baixo (tudo determinístico).
- **Fix esperado**: quique da granada usar `groundAt` em `js/grenades.js`.

### H1B — Loot de morte cai do andar pro térreo 🔴 prioridade 6
- **Dado** uma partida BR real no harness (`startBRMatch`), **quando** um bot
  emite `deathDrop` com posição em cima de um andar, **então** o drop aparece
  na altura do andar (`__BR_debug.drops` → `g.position.y ≈ floorY`).
- **Fix esperado**: `spawnDrop` usar `groundAt(pos[0], pos[2], pos[1])` no
  `br-game.js` (hoje usa `heightAt`, que joga tudo pro terreno).

### H2 — Efeito colateral do fix do AABB nos spawns de carro 🔴 prioridade 4
- **Dado** o boot do mundo (que agora TEM colisão de veículo de verdade),
  **quando** a física assenta por 5s sem ninguém dirigir, **então** cada
  veículo: ficou a <3m do spawn, não capotou (`up.y > 0.7`) e está quase
  parado (`|v| < 2`).
- **Rodar em 3 seeds** (424242, 99, 7) — vagas de carro mudam por seed e o bug
  seria "vaga encostada em colisor de prédio".
- **Arquivo**: `test/collision.test.js` (boots extras ~+20s).
- **Fix esperado se vermelho**: afastar `carSpots` de paredes na geração, ou
  spawn com busca de espaço livre.

### H3 — Pouso em telhado deixa o jogador preso 🔴 prioridade 3
- **Dado** o prédio mais alto da cidade, **quando** o jogador é solto 10m acima
  do telhado e a gravidade age por 600 ticks, **então** ele NUNCA termina com o
  centro dentro do bloco do prédio (preso na geometria).
- **Oráculo**: posição final fora do AABB interno `[x0+r..x1-r]×[y0..y1]×[z0+r..z1-r]`.
- **Fix esperado**: registrar telhados dos prédios da cidade como `platforms`
  (pisáveis) no `createStructures` — pousar no telhado vira feature.

### H4 — Helicóptero atravessa prédios 🔴 prioridade 2
- **Dado** o heli voando na altura do meio de um prédio, **quando** voa reto
  contra ele por 5s, **então** o centro nunca penetra o AABB (mesma detecção
  por tick do teste do carro).
- **Fix esperado**: `Structures.collide(group.position, ~2.2, 2)` no update do
  heli (reuso do push-out do jogador — barato e suficiente pra arcade).

### H7 — Morte simultânea dos 2 últimos 🟠 prioridade 5
- **Dado** 2 vivos, **quando** ambos emitem `died` apontando um pro outro na
  mesma rajada (sem await entre os emits), **então** a partida termina com
  vencedor DEFINIDO e coerente com o ranking (`winner.id` = placement 1).
- **Hoje esperado vermelho**: winner null ("sem sobreviventes") com alguém em
  #1 no ranking — tela contraditória.
- **Arquivo**: `test/server.test.js` (puro socket, determinístico).
- **Fix esperado**: em `checkVictory` com 0 vivos, promover o último morto a
  vencedor (morreu por último = placement 1).

### H8 — claimHost sem rate limit 🟠 prioridade 5
- **Dado** 10 códigos errados em rajada, **quando** a 11ª tentativa vem com o
  código CERTO dentro da janela de bloqueio, **então** é negada; após a janela,
  aceita.
- **Arquivo**: `test/server.test.js`. **Fix**: 5 tentativas por 30s por socket.

### H6 — Comportamento sob latência real 🟠 prioridade 7
- Proxy TCP com 150ms por sentido entre cliente e servidor.
- **Cenários** (asserts frouxos de propósito — o objetivo é caracterizar e
  garantir ZERO exceptions, não cravar números):
  1. tiro de bot com lag ainda aplica dano e a morte fecha a partida;
  2. bot congela 1s e volta → cliente não lança exception (avatar salta, ok);
  3. `S.clockOffset` do cliente difere do atraso real por <100ms.
- **Sem "fix"** — lag compensation é feature futura; o teste vira sentinela de
  crash sob lag.

### H5 — Corrida de posse do carro 🟡 prioridade 8 (mais invasivo)
- Reproduzir a janela de 200ms no cliente é flaky por natureza. O caminho certo
  é **promover a posse pro servidor**: eventos `enterCar/leaveCar` com ack,
  `carOwner[idx]` no servidor, segundo pedido negado.
- **Teste (server, determinístico)**: A pede o carro 0; B pede 10ms depois →
  B recebe `ok:false`. A sai → B consegue.
- É mudança de protocolo + cliente (tryToggleCar espera ack) — fazer por
  último, com o teste de gameplay do carro como regressão.

### H9 — Ranking global sem teto 🟢 prioridade 9
- **Unit**: 5.000 `rankEntry` → `topRank()` continua <50ms e o prune segura o
  arquivo em ≤500 entradas (fix: podar por pontos ao salvar).

### Fora de escopo de teste automatizado (documentar apenas)
- **H10** zona final na água — o servidor não conhece o terreno (gerado no
  cliente pela seed); validar água exigiria duplicar o gerador no servidor.
- **H11** CDN fora do ar — mitigação é vendorizar as libs, não testar.
- **H12** troca de resolução não recria SMAA — cosmético, teste manual.

## Ordem de execução proposta

1. H1A granada×andar → 2. H4 heli×prédio → 3. H3 telhado → 4. H2 spawns de
carro (3 seeds) → 5. H7+H8 (servidor puro) → 6. H1B loot×andar (infra BR) →
7. H6 latência (infra proxy) → 8. H5 posse do carro (protocolo) → 9. H9 prune.

Estimativa: itens 1-5 numa tacada (mesmo padrão das rodadas anteriores);
6-7 dependem da infra nova; 8 é o único que mexe em protocolo de rede.
