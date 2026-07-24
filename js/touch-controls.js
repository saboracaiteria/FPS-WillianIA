import * as THREE from 'three';

/**
 * TouchControls — Sistema de controles touch para Android
 * 
 * Fornece joystick analógico esquerdo (movimento), área de drag direita (olhar),
 * botões de ação (atirar, pular, agachar, recarregar, interagir, mirar) e
 * botão de pausa. Integra-se com o sistema de input existente do game.js
 * sem quebrar o modo desktop (mouse/teclado).
 * 
 * Uso:
 *   import { TouchControls } from './js/touch-controls.js';
 *   const tc = new TouchControls(camera, canvas);
 *   if (tc.isTouchDevice) tc.enable();
 *   // no loop: tc.update(dt);
 *   // no playerUpdate: tc.moveX, tc.moveY, tc.crouch, tc.jump, etc.
 */
export class TouchControls {
  /**
   * @param {THREE.Camera} camera — câmera do jogo (para rotação via look)
   * @param {HTMLElement} domElement — elemento canvas (para referência)
   */
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;

    // --- Estado de movimento ---
    this.moveX = 0; // -1 a 1 (direita/esquerda)
    this.moveY = 0; // -1 a 1 (frente/trás) — positivo = frente

    // --- Acumuladores de olhar (touch look) ---
    this.lookDeltaX = 0; // px acumulados para rotação horizontal
    this.lookDeltaY = 0; // px acumulados para rotação vertical

    // --- Botões (booleanos) ---
    this.shoot = false;
    this.aim = false;
    this.jump = false;         // pulso único (auto-reset)
    this.crouch = false;       // toggle/held
    this.reload = false;       // pulso único
    this.interact = false;     // pulso único (E)
    this.switchWeapon = -1;    // -1 = sem troca, 0..7 = slot
    this.grenade = false;      // pulso único (G)
    this.medkit = false;       // pulso único (Q)
    this.inventory = false;    // pulso único (Tab)
    this.toggleSight = false;  // pulso único (T)

    // --- Botão de interação contextual (aparece quando perto de algo) ---
    this.interactVisible = false;
    this.interactLabel = '✋';

    // --- Detecta se é touch device ---
    this.isTouchDevice = (
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0
    );

    // --- Estado interno ---
    this.enabled = false;
    this._joystickTouchId = null;
    this._lookTouchId = null;
    this._lastLookX = 0;
    this._lastLookY = 0;

    // --- Configuração ---
    this._joystickRadius = 60;   // raio interno do joystick em px
    this._lookSensitivity = 0.005; // rad/px

    // --- Elementos DOM (criados dinamicamente) ---
    this._container = null;
    this._joystickBase = null;
    this._joystickKnob = null;
    this._lookArea = null;
    this._btnShoot = null;
    this._btnAim = null;
    this._btnJump = null;
    this._btnCrouch = null;
    this._btnReload = null;
    this._btnGrenade = null;
    this._btnMedkit = null;
    this._btnInteract = null;
    this._btnPause = null;
    this._btnFullscreen = null;
    this._weaponBar = null;
    this._weaponSlots = [];

    // Binds
    this._bound = {};

    // --- HUD Editor ---
    this._editMode = false;
    this._doneBtn = null;
    this._resetBtn = null;
    this._editOverlay = null;
    this._dragData = null;
    this._resizeData = null;
    this._panelPositions = {};
  }

  /**
   * Ativa os controles touch: cria DOM, bind events.
   */
  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this._buildDOM();
    this._bindEvents();
    this._loadLayout();
    document.body.style.cursor = 'none';
    console.log('[TouchControls] ativado');
  }

  /**
   * Desativa os controles touch: remove DOM, unbind events.
   */
  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    this._unbindEvents();
    this._destroyDOM();
    document.body.style.cursor = '';
    console.log('[TouchControls] desativado');
  }

  /**
   * Ativa/desativa o modo de edição do HUD (chamado externamente pelo menu de configurações).
   */
  toggleEditMode() {
    this._toggleEditMode();
  }

  /**
   * Deve ser chamado a cada frame no loop do jogo.
   * Aplica rotação acumulada do look na câmera.
   * @param {number} dt — delta time em segundos
   */
  update(dt) {
    if (!this.enabled) return;

    // Aplica rotação da câmera com base nos deltas acumulados
    if (this.lookDeltaX !== 0 || this.lookDeltaY !== 0) {
      const euler = new THREE.Euler(0, 0, 0, 'YXZ');
      euler.setFromQuaternion(this.camera.quaternion);
      euler.y -= this.lookDeltaX * this._lookSensitivity;
      euler.x -= this.lookDeltaY * this._lookSensitivity;
      euler.x = Math.max(-1.55, Math.min(1.55, euler.x));
      this.camera.quaternion.setFromEuler(euler);
      this.lookDeltaX = 0;
      this.lookDeltaY = 0;
    }

    // Atualiza visibilidade do botão de interação
    if (this._btnInteract) {
      this._btnInteract.style.display = this.interactVisible ? 'flex' : 'none';
    }
  }

  // =================== Construção DOM ===================

  _buildDOM() {
    // Container principal
    this._container = document.createElement('div');
    this._container.id = 'touchControls';
    Object.assign(this._container.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '10000',
      pointerEvents: 'none',
      touchAction: 'none',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      WebkitTouchCallout: 'none',
    });

    // --- Área de look (metade direita da tela) ---
    this._lookArea = document.createElement('div');
    Object.assign(this._lookArea.style, {
      position: 'absolute',
      right: '0',
      top: '0',
      width: '55%',
      height: '100%',
      pointerEvents: 'auto',
      background: 'transparent',
    });
    this._container.appendChild(this._lookArea);

    // --- Joystick (canto inferior esquerdo) ---
    const joyContainer = document.createElement('div');
    Object.assign(joyContainer.style, {
      position: 'absolute',
      left: '24px',
      bottom: '24px',
      width: '140px',
      height: '140px',
      pointerEvents: 'auto',
    });
    joyContainer.dataset.panelId = 'joystick';
    joyContainer.dataset.editable = 'true';

    this._joystickBase = document.createElement('div');
    Object.assign(this._joystickBase.style, {
      position: 'absolute',
      width: '100%',
      height: '100%',
      borderRadius: '50%',
      background: 'rgba(255,255,255,0.08)',
      border: '2px solid rgba(255,255,255,0.12)',
    });

    this._joystickKnob = document.createElement('div');
    Object.assign(this._joystickKnob.style, {
      position: 'absolute',
      width: '50px',
      height: '50px',
      borderRadius: '50%',
      background: 'radial-gradient(circle, rgba(255,255,255,0.25), rgba(255,255,255,0.08))',
      border: '2px solid rgba(255,255,255,0.18)',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%,-50%)',
      transition: 'none',
    });

    joyContainer.appendChild(this._joystickBase);
    joyContainer.appendChild(this._joystickKnob);
    this._container.appendChild(joyContainer);

    // --- Botões individuais (cada um posicionável) ---
    // ATIRAR (grande)
    this._btnShoot = this._createBtn('', '72px', '#ff4444', 'rgba(255,68,68,0.3)');
    this._btnShoot.dataset.action = 'shoot';
    this._btnShoot.dataset.editable = 'true';
    this._btnShoot.dataset.panelId = 'shoot';
    Object.assign(this._btnShoot.style, { position: 'absolute', right: '24px', bottom: '24px' });
    const inner = document.createElement('div');
    Object.assign(inner.style, { width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(255,255,255,0.5)' });
    this._btnShoot.appendChild(inner);
    this._container.appendChild(this._btnShoot);

    // MIRAR (ADS)
    this._btnAim = this._createBtn('🎯', '46px', '#ffcc44', 'rgba(255,204,68,0.2)');
    this._btnAim.dataset.action = 'aim';
    this._btnAim.dataset.editable = 'true';
    this._btnAim.dataset.panelId = 'aim';
    Object.assign(this._btnAim.style, { position: 'absolute', right: '110px', bottom: '40px' });
    this._container.appendChild(this._btnAim);

    // PULAR
    this._btnJump = this._createBtn('⤊', '48px', '#5ab0ff', 'rgba(90,176,255,0.25)');
    this._btnJump.dataset.action = 'jump';
    this._btnJump.dataset.editable = 'true';
    this._btnJump.dataset.panelId = 'jump';
    Object.assign(this._btnJump.style, { position: 'absolute', right: '24px', bottom: '110px' });
    this._container.appendChild(this._btnJump);

    // AGACHAR
    this._btnCrouch = this._createBtn('⤋', '44px', '#a0a0a0', 'rgba(160,160,160,0.2)');
    this._btnCrouch.dataset.action = 'crouch';
    this._btnCrouch.dataset.editable = 'true';
    this._btnCrouch.dataset.panelId = 'crouch';
    Object.assign(this._btnCrouch.style, { position: 'absolute', right: '80px', bottom: '110px' });
    this._container.appendChild(this._btnCrouch);

    // RECARREGAR
    this._btnReload = this._createBtn('↺', '40px', '#cccccc', 'rgba(200,200,200,0.15)');
    this._btnReload.dataset.action = 'reload';
    this._btnReload.dataset.editable = 'true';
    this._btnReload.dataset.panelId = 'reload';
    Object.assign(this._btnReload.style, { position: 'absolute', right: '130px', bottom: '110px' });
    this._container.appendChild(this._btnReload);

    // GRANADA
    this._btnGrenade = this._createBtn('●', '40px', '#ff8844', 'rgba(255,136,68,0.2)');
    this._btnGrenade.dataset.action = 'grenade';
    this._btnGrenade.dataset.editable = 'true';
    this._btnGrenade.dataset.panelId = 'grenade';
    Object.assign(this._btnGrenade.style, { position: 'absolute', right: '24px', bottom: '170px' });
    this._container.appendChild(this._btnGrenade);

    // MEDKIT
    this._btnMedkit = this._createBtn('✚', '40px', '#ff6a5e', 'rgba(255,106,94,0.2)');
    this._btnMedkit.dataset.action = 'medkit';
    this._btnMedkit.dataset.editable = 'true';
    this._btnMedkit.dataset.panelId = 'medkit';
    Object.assign(this._btnMedkit.style, { position: 'absolute', right: '80px', bottom: '170px' });
    this._container.appendChild(this._btnMedkit);

    // INTERAGIR (contextual)
    this._btnInteract = this._createBtn('✋', '50px', '#4CAF50', 'rgba(76,175,80,0.25)');
    this._btnInteract.dataset.action = 'interact';
    this._btnInteract.dataset.editable = 'true';
    this._btnInteract.dataset.panelId = 'interact';
    this._btnInteract.style.display = 'none';
    Object.assign(this._btnInteract.style, { position: 'absolute', right: '24px', bottom: '230px' });
    this._container.appendChild(this._btnInteract);

    // PAUSA (canto superior esquerdo)
    this._btnPause = this._createBtn('⏸', '40px', '#ffffff', 'rgba(0,0,0,0.3)');
    this._btnPause.dataset.action = 'pause';
    this._btnPause.dataset.editable = 'true';
    this._btnPause.dataset.panelId = 'pause';
    Object.assign(this._btnPause.style, { position: 'absolute', left: '12px', top: '12px' });
    this._container.appendChild(this._btnPause);

    // FULLSCREEN (ao lado do pausa)
    this._btnFullscreen = this._createBtn('⛶', '40px', '#ffffff', 'rgba(0,0,0,0.3)');
    this._btnFullscreen.dataset.action = 'fullscreen';
    this._btnFullscreen.dataset.editable = 'true';
    this._btnFullscreen.dataset.panelId = 'fullscreen';
    Object.assign(this._btnFullscreen.style, { position: 'absolute', left: '60px', top: '12px' });
    this._container.appendChild(this._btnFullscreen);

    // --- Barra de armas (lateral direita) ---
    this._weaponBar = document.createElement('div');
    Object.assign(this._weaponBar.style, {
      position: 'absolute',
      right: '8px',
      top: '50%',
      transform: 'translateY(-50%)',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      pointerEvents: 'auto',
    });
    this._weaponBar.dataset.panelId = 'weaponBar';
    this._weaponBar.dataset.editable = 'true';
    for (let i = 0; i < 4; i++) {
      const slot = this._createBtn(`${i + 1}`, '36px', '#888888', 'rgba(0,0,0,0.35)');
      slot.style.fontSize = '14px';
      slot.style.fontWeight = 'bold';
      slot.style.borderRadius = '8px';
      slot.dataset.action = 'weapon';
      slot.dataset.slot = i;
      this._weaponSlots.push(slot);
      this._weaponBar.appendChild(slot);
    }
    this._container.appendChild(this._weaponBar);

    // --- Overlay de edição ---
    this._editOverlay = document.createElement('div');
    this._editOverlay.style.display = 'none';
    Object.assign(this._editOverlay.style, {
      position: 'fixed', inset: '0', zIndex: '10002',
      background: 'rgba(0,0,0,0.35)', pointerEvents: 'none',
    });
    const editInner = document.createElement('div');
    Object.assign(editInner.style, {
      position: 'absolute', bottom: '40px', left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex', gap: '14px', alignItems: 'center',
      pointerEvents: 'auto',
    });
    this._doneBtn = document.createElement('div');
    this._doneBtn.textContent = '✔ PRONTO';
    Object.assign(this._doneBtn.style, {
      padding: '10px 26px', fontSize: '16px', fontWeight: 'bold',
      color: '#fff', background: '#2e7d32',
      border: '2px solid #4caf50', borderRadius: '10px',
      cursor: 'pointer', userSelect: 'none',
      WebkitUserSelect: 'none', WebkitTapHighlightColor: 'transparent',
    });
    this._resetBtn = document.createElement('div');
    this._resetBtn.textContent = '↺ RESTAURAR';
    Object.assign(this._resetBtn.style, {
      padding: '10px 20px', fontSize: '14px', fontWeight: 'bold',
      color: '#ddd', background: '#5a3c1a',
      border: '2px solid #b8860b', borderRadius: '10px',
      cursor: 'pointer', userSelect: 'none',
      WebkitUserSelect: 'none', WebkitTapHighlightColor: 'transparent',
    });
    const hint = document.createElement('div');
    hint.textContent = 'Arraste para mover · pinch para redimensionar';
    Object.assign(hint.style, {
      color: 'rgba(255,255,255,0.6)', fontSize: '13px', userSelect: 'none',
    });
    editInner.appendChild(this._doneBtn);
    editInner.appendChild(this._resetBtn);
    editInner.appendChild(hint);
    this._editOverlay.appendChild(editInner);
    document.body.appendChild(this._editOverlay);

    this._injectStyles();
    document.body.appendChild(this._container);
  }

  /**
   * Cria um botão circular com estilo padronizado.
   */
  _createBtn(text, size, color, bg) {
    const btn = document.createElement('div');
    btn.textContent = text || '';
    Object.assign(btn.style, {
      width: size,
      height: size,
      borderRadius: '50%',
      background: bg || `rgba(0,0,0,0.3)`,
      border: `2px solid ${color}`,
      color: color,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '20px',
      fontWeight: 'bold',
      pointerEvents: 'auto',
      boxSizing: 'border-box',
      transition: 'transform 0.1s, opacity 0.2s',
      WebkitTapHighlightColor: 'transparent',
      touchAction: 'none',
    });
    return btn;
  }

  // =================== Eventos Touch ===================

  _bindEvents() {
    const b = this._bound;

    // Joystick
    b.joyStart = e => this._onJoyStart(e);
    b.joyMove = e => this._onJoyMove(e);
    b.joyEnd = e => this._onJoyEnd(e);

    const joyEl = this._joystickBase.parentElement;
    joyEl.addEventListener('touchstart', b.joyStart, { passive: true });
    joyEl.addEventListener('touchmove', b.joyMove, { passive: true });
    joyEl.addEventListener('touchend', b.joyEnd, { passive: true });
    joyEl.addEventListener('touchcancel', b.joyEnd, { passive: true });

    // Look area
    b.lookStart = e => this._onLookStart(e);
    b.lookMove = e => this._onLookMove(e);
    b.lookEnd = e => this._onLookEnd(e);

    this._lookArea.addEventListener('touchstart', b.lookStart, { passive: true });
    this._lookArea.addEventListener('touchmove', b.lookMove, { passive: true });
    this._lookArea.addEventListener('touchend', b.lookEnd, { passive: true });
    this._lookArea.addEventListener('touchcancel', b.lookEnd, { passive: true });

    // Botões individuais
    // TIRO HÍBRIDO (CoD Mobile style): tap = tiro rápido, hold = mira (ADS)
    let shootHoldTimer = null;
    let shootHeld = false;
    this._bindBtn('shoot', {
      start: () => {
        shootHeld = true;
        // Se segurar por mais de 180ms, entra em modo mira (ADS)
        shootHoldTimer = setTimeout(() => {
          if (shootHeld) {
            this.aim = true;
            this._pulse(this._btnAim);
          }
        }, 180);
      },
      end: () => {
        shootHeld = false;
        clearTimeout(shootHoldTimer);
        if (this.aim) {
          // Estava mirando — atira ao soltar
          this.shoot = true;
          this.aim = false;
          setTimeout(() => { this.shoot = false; }, 50);
        } else {
          // Tap rápido — tiro direto
          this.shoot = true;
          setTimeout(() => { this.shoot = false; }, 80);
        }
      },
    });
    this._bindBtn('aim', {
      start: () => { this.aim = true; this._pulse(this._btnAim); },
      end: () => { this.aim = false; },
    });
    this._bindBtn('jump', {
      start: () => { this.jump = true; this._pulse(this._btnJump); },
    });
    this._bindBtn('crouch', {
      start: () => { this.crouch = !this.crouch; this._pulse(this._btnCrouch); },
    });
    this._bindBtn('reload', {
      start: () => { this.reload = true; this._pulse(this._btnReload); },
    });
    this._bindBtn('grenade', {
      start: () => { this.grenade = true; this._pulse(this._btnGrenade); },
    });
    this._bindBtn('medkit', {
      start: () => { this.medkit = true; this._pulse(this._btnMedkit); },
    });
    this._bindBtn('interact', {
      start: () => { this.interact = true; this._pulse(this._btnInteract); },
    });
    this._bindBtn('pause', {
      start: () => {
        this._pulse(this._btnPause);
        // No mobile, pointer lock não existe — chama setPaused diretamente
        if (window.__setPaused) {
          window.__setPaused(true);
        } else {
          if (document.pointerLockElement) document.exitPointerLock();
          window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
        }
      },
    });
    this._bindBtn('fullscreen', {
      start: () => {
        this._pulse(this._btnFullscreen);
        this._toggleFullscreen();
      },
    });

    // Botões de arma
    for (const slot of this._weaponSlots) {
      const i = parseInt(slot.dataset.slot, 10);
      slot.addEventListener('touchstart', e => {
        if (this._editMode) return;
        e.preventDefault();
        this.switchWeapon = i;
        this._pulse(slot);
      }, { passive: false });
    }

    // --- Editor: PRONTO ---
    if (this._doneBtn) {
      this._bound.editDone = e => { e.preventDefault(); this._saveAndExit(); };
      this._doneBtn.addEventListener('touchstart', this._bound.editDone, { passive: false });
      this._doneBtn.addEventListener('mousedown', e => { e.preventDefault(); this._saveAndExit(); });
    }
    // --- Editor: RESTAURAR ---
    if (this._resetBtn) {
      this._bound.editReset = e => { e.preventDefault(); this._resetLayout(); };
      this._resetBtn.addEventListener('touchstart', this._bound.editReset, { passive: false });
      this._resetBtn.addEventListener('mousedown', e => { e.preventDefault(); this._resetLayout(); });
    }

    // --- Drag e Resize: elementos editáveis individuais ---
    const editableEls = this._container.querySelectorAll('[data-editable="true"]');
    for (const el of editableEls) {
      const pid = el.dataset.panelId;
      // Drag
      const startDrag = (e) => { this._startDrag(pid, e); };
      el.addEventListener('touchstart', startDrag, { passive: true });
      el.addEventListener('mousedown', startDrag);
      // Resize (long press ou pinch)
      let resizeTimer = null;
      el.addEventListener('touchstart', (e) => {
        if (!this._editMode) return;
        if (e.touches.length >= 2) {
          resizeTimer = setTimeout(() => this._startResize(pid, e), 300);
        }
      }, { passive: true });
      el.addEventListener('touchmove', (e) => {
        if (resizeTimer) { clearTimeout(resizeTimer); resizeTimer = null; }
        if (this._resizeData) this._onResize(e);
      }, { passive: true });
      el.addEventListener('touchend', () => {
        if (resizeTimer) { clearTimeout(resizeTimer); resizeTimer = null; }
        if (this._resizeData) this._endResize();
      }, { passive: true });
    }

    this._bound.docMove = e => {
      if (this._dragData) this._onDrag(e);
      if (this._resizeData) this._onResize(e);
    };
    this._bound.docEnd = e => {
      this._endDrag(e);
      if (this._resizeData) this._endResize();
    };
    document.addEventListener('touchmove', this._bound.docMove, { passive: true });
    document.addEventListener('mousemove', this._bound.docMove);
    document.addEventListener('touchend', this._bound.docEnd, { passive: true });
    document.addEventListener('mouseup', this._bound.docEnd);
  }

  _unbindEvents() {
    // Remove event listeners (não há referências globais, o DOM será removido)
  }

  _destroyDOM() {
    if (this._container && this._container.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    if (this._editOverlay && this._editOverlay.parentNode) {
      this._editOverlay.parentNode.removeChild(this._editOverlay);
    }
    this._container = null;
    this._joystickBase = null;
    this._joystickKnob = null;
    this._lookArea = null;
    this._btnShoot = null;
    this._btnAim = null;
    this._btnJump = null;
    this._btnCrouch = null;
    this._btnReload = null;
    this._btnGrenade = null;
    this._btnMedkit = null;
    this._btnInteract = null;
    this._btnPause = null;
    this._btnFullscreen = null;
    this._weaponSlots = [];
    this._doneBtn = null;
    this._resetBtn = null;
    this._editOverlay = null;
  }

  _bindBtn(action, handlers) {
    const el = this._container.querySelector(`[data-action="${action}"]`);
    if (!el) return;
    el.addEventListener('touchstart', e => {
      if (this._editMode) return;
      e.preventDefault();
      if (handlers.start) handlers.start();
    }, { passive: false });
    el.addEventListener('touchend', e => {
      if (this._editMode) return;
      e.preventDefault();
      if (handlers.end) handlers.end();
    }, { passive: false });
    el.addEventListener('touchcancel', e => {
      if (handlers.end) handlers.end();
    }, { passive: true });
  }

  _pulse(el) {
    if (!el) return;
    el.style.transform = 'scale(0.9)';
    setTimeout(() => { if (el) el.style.transform = ''; }, 100);
  }

  // =================== HUD Editor ===================

  _injectStyles() {
    if (document.getElementById('tc-editor-styles')) return;
    const s = document.createElement('style');
    s.id = 'tc-editor-styles';
    s.textContent = `
.tc-edit-panel { outline: 2px dashed #d4a017 !important; outline-offset: 2px !important; transition: none !important; }
.tc-edit-panel-dragging { outline: 3px solid #ffd700 !important; opacity: 0.85 !important; }
#touchControls .tc-edit-joystick-knob { width: clamp(30px, 10vmin, 50px) !important; height: clamp(30px, 10vmin, 50px) !important; }
`;
    document.head.appendChild(s);
  }

  _toggleEditMode() {
    if (this._editMode) {
      this._saveAndExit();
    } else {
      this._enterEditMode();
    }
  }

  _enterEditMode() {
    this._editMode = true;
    if (this._editOverlay) this._editOverlay.style.display = 'block';
    // destaca painéis
    for (const pid of ['joystick', 'rightPanel', 'weaponBar', 'pause']) {
      const el = document.querySelector(`[data-panel-id="${pid}"]`);
      if (el) el.classList.add('tc-edit-panel');
    }
  }

  _exitEditMode() {
    this._editMode = false;
    if (this._editOverlay) this._editOverlay.style.display = 'none';
    for (const pid of ['joystick', 'rightPanel', 'weaponBar', 'pause']) {
      const el = document.querySelector(`[data-panel-id="${pid}"]`);
      if (el) el.classList.remove('tc-edit-panel', 'tc-edit-panel-dragging');
    }
  }

  _saveAndExit() {
    this._saveLayout();
    this._exitEditMode();
  }

  _saveLayout() {
    const layout = {};
    const editableEls = this._container.querySelectorAll('[data-editable="true"]');
    for (const el of editableEls) {
      const pid = el.dataset.panelId;
      if (!pid) continue;
      const rect = el.getBoundingClientRect();
      layout[pid] = {
        left: rect.left + 'px',
        top: rect.top + 'px',
        right: document.body.clientWidth - rect.right + 'px',
        bottom: document.body.clientHeight - rect.bottom + 'px',
        width: rect.width + 'px',
        height: rect.height + 'px',
      };
    }
    try { localStorage.setItem('tc_panel_layout', JSON.stringify(layout)); } catch (e) {}
  }

  _loadLayout() {
    let layout;
    try { layout = JSON.parse(localStorage.getItem('tc_panel_layout')); } catch (e) { return; }
    if (!layout) return;
    const editableEls = this._container.querySelectorAll('[data-editable="true"]');
    for (const el of editableEls) {
      const pid = el.dataset.panelId;
      if (!pid || !layout[pid]) continue;
      const p = layout[pid];
      el.style.left = ''; el.style.right = ''; el.style.top = ''; el.style.bottom = '';
      el.style.width = ''; el.style.height = ''; el.style.transform = '';
      if (p.left !== undefined) el.style.left = p.left;
      if (p.top !== undefined) el.style.top = p.top;
      if (p.right !== undefined) el.style.right = p.right;
      if (p.bottom !== undefined) el.style.bottom = p.bottom;
      if (p.width !== undefined) el.style.width = p.width;
      if (p.height !== undefined) el.style.height = p.height;
    }
  }

  _resetLayout() {
    try { localStorage.removeItem('tc_panel_layout'); } catch (e) {}
    const editableEls = this._container.querySelectorAll('[data-editable="true"]');
    for (const el of editableEls) {
      el.style.left = ''; el.style.right = ''; el.style.top = ''; el.style.bottom = '';
      el.style.width = ''; el.style.height = ''; el.style.transform = '';
    }
    this._saveAndExit();
  }

  // --- Drag helpers ---
  _startDrag(pid, e) {
    if (!this._editMode) return;
    const el = document.querySelector(`[data-panel-id="${pid}"]`);
    if (!el) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const rect = el.getBoundingClientRect();
    this._dragData = {
      pid, el,
      offsetX: clientX - rect.left,
      offsetY: clientY - rect.top,
    };
    el.classList.add('tc-edit-panel-dragging');
    e.preventDefault && e.preventDefault();
  }

  _onDrag(e) {
    if (!this._dragData) return;
    const { el, offsetX, offsetY } = this._dragData;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    el.style.left = (clientX - offsetX) + 'px';
    el.style.top = (clientY - offsetY) + 'px';
    el.style.right = '';
    el.style.bottom = '';
  }

  _endDrag(e) {
    if (this._dragData) {
      const { el } = this._dragData;
      if (el) el.classList.remove('tc-edit-panel-dragging');
      this._dragData = null;
    }
  }

  // --- Resize helpers ---
  _startResize(pid, e) {
    if (!this._editMode || e.touches.length < 2) return;
    const el = document.querySelector(`[data-panel-id="${pid}"]`);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    this._resizeData = { pid, el, initialDist: dist, initialSize: rect.width };
    el.classList.add('tc-edit-panel-dragging');
  }

  _onResize(e) {
    if (!this._resizeData || e.touches.length < 2) return;
    const { el, initialDist, initialSize } = this._resizeData;
    const dist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    const scale = dist / initialDist;
    const newSize = Math.max(24, Math.min(120, initialSize * scale));
    el.style.width = newSize + 'px';
    el.style.height = newSize + 'px';
  }

  _endResize() {
    if (this._resizeData) {
      const { el } = this._resizeData;
      if (el) el.classList.remove('tc-edit-panel-dragging');
      this._resizeData = null;
    }
  }

  // =================== Joystick ===================

  _onJoyStart(e) {
    const touch = e.changedTouches[0];
    this._joystickTouchId = touch.identifier;
    const rect = this._joystickBase.getBoundingClientRect();
    this._joyCenterX = rect.left + rect.width / 2;
    this._joyCenterY = rect.top + rect.height / 2;
    this._updateJoystick(touch.clientX, touch.clientY);
  }

  _onJoyMove(e) {
    const touch = Array.from(e.changedTouches).find(t => t.identifier === this._joystickTouchId);
    if (touch) this._updateJoystick(touch.clientX, touch.clientY);
  }

  _onJoyEnd(e) {
    if (Array.from(e.changedTouches).some(t => t.identifier === this._joystickTouchId)) {
      this._joystickTouchId = null;
      this.moveX = 0;
      this.moveY = 0;
      if (this._joystickKnob) {
        this._joystickKnob.style.transform = 'translate(-50%,-50%)';
      }
    }
  }

  _updateJoystick(cx, cy) {
    const dx = cx - this._joyCenterX;
    const dy = cy - this._joyCenterY;
    const dist = Math.hypot(dx, dy);
    const maxDist = this._joystickRadius;
    const clampedDist = Math.min(dist, maxDist);

    // Normaliza e aplica dead zone
    let nx = 0, ny = 0;
    if (dist > 5) {
      const ratio = clampedDist / maxDist;
      nx = (dx / dist) * ratio;
      ny = (dy / dist) * ratio;
    }

    this.moveX = nx;
    this.moveY = -ny; // positivo = frente

    // Move o knob visualmente
    if (this._joystickKnob) {
      const pct = clampedDist / maxDist;
      const knobX = (dx / (dist || 1)) * pct * 45; // 45px max deslocamento
      const knobY = (dy / (dist || 1)) * pct * 45;
      this._joystickKnob.style.transform = `translate(calc(-50% + ${knobX}px), calc(-50% + ${knobY}px))`;
    }
  }

  // =================== Look (arrastar para olhar) ===================

  _onLookStart(e) {
    const touch = e.changedTouches[0];
    this._lookTouchId = touch.identifier;
    this._lastLookX = touch.clientX;
    this._lastLookY = touch.clientY;
  }

  _onLookMove(e) {
    const touch = Array.from(e.changedTouches).find(t => t.identifier === this._lookTouchId);
    if (!touch) return;
    const dx = touch.clientX - this._lastLookX;
    const dy = touch.clientY - this._lastLookY;
    this.lookDeltaX += dx;
    this.lookDeltaY += dy;
    this._lastLookX = touch.clientX;
    this._lastLookY = touch.clientY;
  }

  _onLookEnd(e) {
    if (Array.from(e.changedTouches).some(t => t.identifier === this._lookTouchId)) {
      this._lookTouchId = null;
    }
  }

  /**
   * Define se o botão de interagir deve aparecer e com qual label.
   */
  showInteract(visible, label) {
    this.interactVisible = visible;
    if (label) this.interactLabel = label;
    if (this._btnInteract) {
      this._btnInteract.textContent = this.interactLabel;
    }
  }

  _toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }
}
