#!/usr/bin/env python3
# ============================================================
# E2E — Destruição da cidade com 2 jogadores reais (Playwright).
#   Jogador Renato  (host)   -> nasce NA cidade  -> morre no míssil
#   Jogador William (comum)  -> longe da cidade  -> sobrevive e vence
# Verifica: mesmo eventId/seed/timestamps nos 2 clientes, assinatura
# "By RenatoDReis" no míssil, impacto dentro da tolerância, cidade
# destruída nos 2, câmera devolvida, console limpo, socket vivo.
# Screenshots numerados em docs/plans/e2e-shots/.
# Rodar: npm run test:e2e   (ou: python3 tests/city-destruction-e2e.py)
# ============================================================
import os
import sys
import time
import socket
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# sem playwright no python do sistema? re-executa com o venv do repo
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    venv_py = ROOT / '.venv' / 'bin' / 'python'
    if venv_py.exists() and not os.environ.get('E2E_REEXEC'):
        os.environ['E2E_REEXEC'] = '1'
        os.execv(str(venv_py), [str(venv_py)] + sys.argv)
    print('ERRO: playwright não instalado. Rode:')
    print('  python3 -m venv .venv && .venv/bin/pip install playwright')
    sys.exit(2)

PORT = 3199
URL = f'http://localhost:{PORT}/'
SHOTS = ROOT / 'docs' / 'plans' / 'e2e-shots'
DELAY_MS = 16000       # ataque 16s após o início (produção: 90000) — folga
                       # pros passos pré-cinemática no headless lento
IMPACT_MS = 8500       # impacto 8,5s após o começo da cinemática (= produção)
CITY = (-340, 130)     # centro da cidade (protocolo)
FAR = (200, 200)       # bem fora do raio letal (100)

CHROME_ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
               '--use-gl=angle', '--use-angle=swiftshader', '--mute-audio']

passed, failed = [], []


def check(name, ok, detail=''):
    mark = '✔' if ok else '✘'
    print(f'  {mark} {name}' + (f' — {detail}' if detail else ''))
    (passed if ok else failed).append(name)


def wait_port(port, timeout=15):
    t0 = time.time()
    while time.time() - t0 < timeout:
        with socket.socket() as s:
            if s.connect_ex(('localhost', port)) == 0:
                return True
        time.sleep(0.2)
    return False


def boot_player(pw, nick):
    """navegador PRÓPRIO por jogador (perfil isolado — 2 contexts num só
    browser deixam o 2º WebGL/SwiftShader travado no headless)"""
    browser = pw.chromium.launch(channel='chrome', headless=True, args=CHROME_ARGS)
    ctx = browser.new_context(viewport={'width': 1024, 'height': 640})
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    def on_console(m):
        if m.type != 'error':
            return
        url = (m.location or {}).get('url', '')
        benign = ('WebGL', 'GPU', 'swiftshader', 'GroupMarkerNotSet', 'Automatic fallback')
        if any(k in m.text for k in benign) or 'favicon' in url:
            return
        errors.append(f'console.error: {m.text} ({url})')
    page.on('console', on_console)
    page.goto(URL, wait_until='domcontentloaded')
    page.wait_for_function(polling=200, expression='!!window.__game && !!window.__MP && !!window.__BR_debug', timeout=60000)
    page.wait_for_selector('#brNick', timeout=30000)
    # gráficos no mínimo: sem GPU real um único frame chega a custar 4s e
    # rouba as janelas da timeline — em modo desempenho cai pra ~1s
    page.evaluate('''() => {
        const setv = (id, v) => {
            const e = document.getElementById(id);
            if (e) { e.value = v; if (e.onchange) e.onchange(); }
        };
        setv('setRes', '1'); setv('setShadow', '0'); setv('setBloom', '0');
    }''')
    page.fill('#brNick', nick)   # dispara o evento input -> hello com o nick
    page.wait_for_timeout(300)
    return browser, page, errors


def enter_ground(page, x, z):
    """pula nave/queda (atalho de QA, igual ao harness) e põe o jogador no chão"""
    page.evaluate('''([x, z]) => {
        const S = window.__BR_debug.S, MP = window.__MP;
        S.phase = 'PLAY';
        window.__BR_freeze = false;
        // o atalho pula a nave: limpa overlay do menu solo e o hint "NA NAVE"
        const ov = document.getElementById('overlay');
        if (ov) ov.style.display = 'none';
        const hb = document.getElementById('brHint');
        if (hb) hb.style.display = 'none';
        const P = MP.player;
        const y = MP.groundAt(x, z, 999);
        P.pos.set(x, y, z); P.vel.set(0, 0, 0); P.onGround = true;
        P.dead = false;
        // vigias do e2e: instante em que a cidade cai + killfeed do ataque
        // (a entrada do feed vive só 4,4s — capturada aqui, lida depois).
        // destroy é medido NA CHAMADA: um interval atrasaria a medição quando
        // o main thread está ocupado com o render sincrono dos screenshots
        window.__e2e_destroyedAt = null;
        window.__e2e_feed = null;
        window.__e2e_died = false;
        window.__e2e_deathMsg = null;
        window.__e2e_cinOn = false;
        const city = window.__game.Structures.city;
        const origDestroy = city.destroy.bind(city);
        window.__e2e_boom = false;
        city.destroy = () => {
            if (!window.__e2e_destroyedAt) window.__e2e_destroyedAt = Date.now();
            origDestroy();
            // a explosão (cityBoom) entra na cena no MESMO task do destroy;
            // microtask roda antes de timers (ela vive só 2,2s de relógio)
            queueMicrotask(() => {
                if (window.__MP.scene.getObjectByName('cityBoom')) window.__e2e_boom = true;
            });
        };
        const iv = setInterval(() => {
            if (MP.state.cinematic === true) window.__e2e_cinOn = true;
            const f = document.getElementById('killfeed').innerHTML;
            if (!window.__e2e_feed && /ataque de m\u00edsseis \u00e0 cidade/.test(f))
                window.__e2e_feed = f;
            if (!window.__e2e_died && MP.player.dead === true) {
                window.__e2e_died = true;
                window.__e2e_deathMsg = document.getElementById('deathSub').textContent;
            }
        }, 60);
    }''', [x, z])


def main():
    SHOTS.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, PORT=str(PORT), WORLD_SEED='424242', COUNTDOWN_S='1',
               NEXT_IN_S='600', CITY_DESTRUCTION_DELAY_MS=str(DELAY_MS),
               CITY_DESTRUCTION_IMPACT_DELAY_MS=str(IMPACT_MS))
    srv = subprocess.Popen(['node', str(ROOT / 'server.js')], env=env,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    bot = None
    try:
        assert wait_port(PORT), f'servidor não subiu na porta {PORT}'
        with sync_playwright() as p:
            print('\n== LOBBY ==')
            b1, renato, err1 = boot_player(p, 'Jogador Renato')
            renato.fill('#brHostCode', 'QUEDALIVRE')
            renato.click('#brHostBtn')
            renato.wait_for_selector('#brStartBtn:not([disabled])', timeout=10000)
            check('Renato virou anfitrião (botão INICIAR liberado)', True)
            flag = renato.is_checked('#fgCidade')
            check('flag "Destruição automática da cidade" visível e LIGADA por padrão', flag)
            renato.screenshot(path=str(SHOTS / '01-lobby-renato-host-flag.png'))

            b2, william, err2 = boot_player(p, 'Jogador William')
            # o jogo limita nick a 14 chars: "Jogador William" vira "Jogador Willia"
            nick2 = william.evaluate('() => window.__BR_debug.S.nick')
            renato.wait_for_function(
                'n => document.getElementById("brLobbyList").textContent.includes(n)',
                arg=nick2, timeout=10000, polling=200)
            check('os 2 jogadores aparecem na sala', True, f'nick efetivo: {nick2}')
            william.screenshot(path=str(SHOTS / '02-lobby-william-sala.png'))

            # 3º jogador (socket puro) longe da cidade: mantém a partida viva
            # depois que o Renato morre — sem ele, o overlay de vitória cobre
            # os screenshots do impacto/ruínas
            bot_js = (
                "const {io}=require('socket.io-client');"
                f"const s=io('http://localhost:{PORT}',{{transports:['websocket']}});"
                "s.on('connect',()=>s.emit('hello',{nick:'Sentinela'}));"
                "s.on('matchStart',()=>setInterval(()=>s.emit('state',{pos:[250,3,-250],rotY:0}),2000));"
                "setInterval(()=>{},10000);")
            bot = subprocess.Popen(['node', '-e', bot_js], cwd=str(ROOT),
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            renato.wait_for_function(
                polling=200, expression='document.getElementById("brLobbyList").textContent.includes("Sentinela")',
                timeout=10000)

            print('\n== PARTIDA ==')
            renato.click('#brStartBtn')
            for pg in (renato, william):
                pg.wait_for_function(
                    polling=200, expression='window.__BR_debug.S.plan && !!window.__BR_debug.S.plan.city', timeout=20000)
            plan1 = renato.evaluate('() => window.__BR_debug.S.plan.city')
            plan2 = william.evaluate('() => window.__BR_debug.S.plan.city')
            same = all(plan1[k] == plan2[k] for k in
                       ('eventId', 'seed', 'cinematicStartedAt', 'impactAt'))
            check('mesmo eventId/seed/timestamps nos 2 clientes', same,
                  f'eventId={plan1["eventId"]} seed={plan1["seed"]}')

            enter_ground(renato, *CITY)    # Renato NA cidade -> morre
            enter_ground(william, *FAR)    # William longe    -> sobrevive
            check('jogadores no chão (Renato na cidade, William longe)', True)

            # fotógrafo PLANTADO nas páginas: nos instantes-alvo da timeline
            # faz tick manual + render + canvas.toDataURL no MESMO task (o
            # buffer WebGL ainda está fresco) — screenshots via CDP custam
            # 4s cada e perderiam a cinemática inteira. Colhidos no final.
            plant_shots = '''(alvos) => {
                const S = window.__BR_debug.S, cd = S.plan.city;
                const el = () => (Date.now() + (S.clockOffset || 0) + (S.halfRtt || 0)
                                  - cd.cinematicStartedAt) / 1000;
                window.__e2e_shots = {};
                const cv = document.getElementById('game');
                const cap = k => {
                    window.__e2e_shots[k] = cv.toDataURL('image/jpeg', 0.9);
                };
                // 1º time: captura o frame NATURAL do jogo dentro da janela
                // [el, max] de cada alvo (hook no render — buffer fresco)
                const MPc = window.__MP.composer;
                const orig = MPc.render.bind(MPc);
                MPc.render = () => {
                    orig();
                    for (const a of alvos)
                        if (!a.done && a.max !== null && el() >= a.el && el() < a.max) { a.done = true; cap(a.k); }
                };
                // 2º time: se o rAF pulou a janela inteira (ou o alvo é
                // fallback-only, max==null), tick manual + render no prazo
                window.__e2e_shotsP = (async () => {
                    for (const a of alvos) {
                        const prazo = a.max === null ? a.el : a.max;
                        while (!a.done && el() < prazo)
                            await new Promise(r => setTimeout(r, 80));
                        if (!a.done) {
                            a.done = true;
                            window.__game.tick(0.34);
                            orig();
                            cap(a.k);
                        }
                    }
                    return Object.keys(window.__e2e_shots);
                })();
            }'''
            # cada captura custa ~2-3s de readback no SwiftShader; divididas
            # pra não roubar a fase close do William (onde o check de fov roda).
            # 04/05 são da câmera cinematográfica — a imagem independe da página
            # William: o close do míssil assinado (readback livre até lá) e as
            # ruínas; Renato: skyPan e impacto por tick direto (fallback-only)
            william.evaluate(plant_shots, [
                {'k': '04-misseis-sobre-a-cidade', 'el': 3.4, 'max': 5.3},
                {'k': '06-cidade-destruida-aftermath', 'el': 9.8, 'max': 11.0}])
            renato.evaluate(plant_shots, [
                {'k': '03-cinematica-skypan', 'el': 2.0, 'max': None},
                {'k': '05-impacto', 'el': 8.9, 'max': None}])

            renato.evaluate('''() => {
                // toda troca de fov fica registrada com o instante da timeline:
                // prova a fase close mesmo se o rAF pular a janela inteira
                const cam = window.__MP.camera, S0 = window.__BR_debug.S;
                const el0 = () => (Date.now() + (S0.clockOffset || 0) + (S0.halfRtt || 0)
                                   - S0.plan.city.cinematicStartedAt) / 1000;
                window.__e2e_fovLog = [];
                const orig = cam.updateProjectionMatrix.bind(cam);
                cam.updateProjectionMatrix = () => {
                    window.__e2e_fovLog.push({ fov: Math.round(cam.fov), el: +el0().toFixed(2) });
                    orig();
                };
                // 3 ticks agendados DENTRO da fase close (3,0-5,5s): garantem
                // pelo menos uma aplicação da câmera close mesmo se o rAF e o
                // capturador perderem a janela por bloqueio do main thread
                for (const alvo of [3.3, 4.0, 4.7]) {
                    const ms = (alvo - el0()) * 1000;
                    if (ms > 0) setTimeout(() => {
                        if (el0() < 5.4) window.__game.tick(0.016);
                    }, ms);
                }
                window.__e2e_sigP = (async () => {
                    const S = window.__BR_debug.S, cd = S.plan.city;
                    const el = () => (Date.now() + (S.clockOffset || 0) + (S.halfRtt || 0)
                                      - cd.cinematicStartedAt) / 1000;
                    while (el() < 3.05)
                        await new Promise(r => setTimeout(r, 60));
                    // close vai de 3,0 a 5,5s; cada tick manual custa ~1s aqui
                    let fov = 0;
                    for (let i = 0; i < 3 && fov !== 52 && el() < 5.3; i++) {
                        window.__game.tick(0.016);
                        fov = Math.round(window.__MP.camera.fov);
                    }
                    const grp = window.__MP.scene.getObjectByName('cityMissiles');
                    if (!grp) return { grp: false, el: +el().toFixed(2) };
                    let signed = null;
                    grp.traverse(o => { if (o.userData && o.userData.signed) signed = o; });
                    const plates = signed
                        ? signed.children.filter(c => c.material && c.material.map).length : 0;
                    return { grp: true, signed: !!signed, plates, fov, el: +el().toFixed(2) };
                })();
            }''')

            print('\n== CINEMÁTICA ==')
            # colhe o resultado do capturador plantado (espera a promise)
            sig = renato.evaluate('() => window.__e2e_sigP')
            check('míssil assinado "By RenatoDReis" na cena (2 placas com textura)',
                  sig.get('signed') and sig.get('plates', 0) >= 2, str(sig))
            fov_log = renato.evaluate('() => window.__e2e_fovLog || []')
            close_logged = any(e['fov'] == 52 and 2.9 <= e['el'] <= 5.6 for e in fov_log)
            check('câmera em close (fov 52) na fase do míssil assinado',
                  sig.get('fov') == 52 or close_logged,
                  f"sig el={sig.get('el')} log: {fov_log[:14]}")
            for pg, who in ((william, 'William'), (renato, 'Renato')):
                pg.wait_for_function(polling=200, expression='window.__e2e_cinOn === true',
                                     timeout=DELAY_MS + 15000)
                check(f'cinemática ligou para {who}', True)

            print('\n== MORTE (logo após o impacto) ==')
            renato.wait_for_function(polling=200, expression='window.__e2e_died === true',
                                     timeout=IMPACT_MS + 20000)
            check('Renato (na cidade) morreu no ataque', True)
            msg = renato.evaluate('() => window.__e2e_deathMsg')
            check('mensagem oficial de morte',
                  msg == 'Você morreu atingido pelo ataque de mísseis próximo à cidade!', repr(msg))
            renato.screenshot(path=str(SHOTS / '07-morte-renato.png'))
            feed = william.evaluate('''async () => {
                const t0 = Date.now();
                while (!window.__e2e_feed && Date.now() - t0 < 8000)
                    await new Promise(r => setTimeout(r, 150));
                return window.__e2e_feed;
            }''')
            check('killfeed do ataque no cliente do William',
                  bool(feed) and 'ataque de mísseis à cidade' in feed)

            print('\n== IMPACTO ==')
            ats = {}
            for pg, who in ((renato, 'Renato'), (william, 'William')):
                pg.wait_for_function(polling=200, expression='window.__e2e_destroyedAt !== null', timeout=20000)
                r = pg.evaluate('''() => {
                    const S = window.__BR_debug.S;
                    return { at: window.__e2e_destroyedAt + (S.clockOffset || 0) + (S.halfRtt || 0),
                             impactAt: S.plan.city.impactAt };
                }''')
                ats[who] = r['at']
                dt = abs(r['at'] - r['impactAt'])
                # tolerância do AMBIENTE: um único frame do SwiftShader chega a
                # segurar o main thread por ~3s bem na janela do impacto; em
                # máquina real a medição fica <100ms (runs típicas: 1-50ms)
                check(f'impacto de {who} dentro da tolerância (±4000ms)', dt <= 4000, f'{dt:.0f}ms')
            drel = abs(ats['Renato'] - ats['William'])
            check('impacto SINCRONIZADO entre os 2 clientes (±3000ms)', drel <= 3000, f'{drel:.0f}ms')

            print('\n== DESFECHO ==')
            for pg in (renato, william):
                pg.wait_for_function(polling=200, expression='window.__MP.state.cinematic === false', timeout=25000)
            for pg, who in ((renato, 'Renato'), (william, 'William')):
                st = pg.evaluate('() => window.__game.Structures.city.getState()')
                check(f'cidade destruída para {who}', st == 'destroyed', st)
            boom = william.evaluate('() => window.__e2e_boom === true')
            check('explosão (fireball/anel de choque) apareceu no impacto', boom)


            vivo = william.evaluate('() => window.__MP.player.dead !== true')
            check('William (longe) sobreviveu', vivo)
            dcam = william.evaluate('''() => {
                const MP = window.__MP, P = MP.player;
                return MP.camera.position.distanceTo(
                    new MP.THREE.Vector3(P.pos.x, P.pos.y + 1.62, P.pos.z));
            }''')
            check('câmera do William devolvida ao FPS', dcam < 3, f'd={dcam:.2f}m')

            import base64
            for pg in (renato, william):
                for k, data in pg.evaluate(
                        'async () => (await window.__e2e_shotsP, window.__e2e_shots)').items():
                    ext = 'jpg' if data.startswith('data:image/jpeg') else 'png'
                    (SHOTS / f'{k}.{ext}').write_bytes(
                        base64.b64decode(data.split(',', 1)[1]))

            for pg, who in ((renato, 'Renato'), (william, 'William')):
                ok = pg.evaluate('() => !!(window.__MP.socket && window.__MP.socket.connected)')
                check(f'socket de {who} continua conectado', ok)
            check('console do Renato limpo (0 erros)', not err1, ' | '.join(err1[:3]))
            check('console do William limpo (0 erros)', not err2, ' | '.join(err2[:3]))

            b1.close()
            b2.close()
    finally:
        if bot:
            bot.kill()
        srv.kill()

    print(f'\n===== E2E: {len(passed)} ok, {len(failed)} falhas =====')
    if failed:
        for f in failed:
            print(f'  FALHOU: {f}')
        sys.exit(1)
    print(f'screenshots: {SHOTS}')


if __name__ == '__main__':
    main()
