// Keyboard + mouse input with pointer lock. Uses physical key codes so WASD
// works on QWERTZ/AZERTY layouts the same way it does on QWERTY.

export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'sprint'
  | 'jump'
  | 'crouch'
  | 'use'
  | 'flashlight'
  | 'mute'
  | 'talk'
  | 'crew';

const BINDINGS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  crouch: ['KeyC', 'ControlLeft'],
  use: ['KeyE'],
  flashlight: ['KeyF'],
  mute: ['KeyM'],
  talk: ['KeyV'],
  crew: ['Tab'],
};

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  private mouseDown = false;
  private mousePressed = false;
  private mouseReleased = false;
  dx = 0;
  dy = 0;
  locked = false;
  /** When false, game actions read as idle (menus open, typing in a field). */
  enabled = true;
  onLockChange: ((locked: boolean) => void) | null = null;

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (this.isTyping(e)) return;
      if (this.locked && (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow'))) e.preventDefault();
      if (this.locked && e.ctrlKey && ['KeyS', 'KeyD', 'KeyW'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => this.reset());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Some browsers report one huge spurious delta right after locking.
      if (Math.abs(e.movementX) > 600 || Math.abs(e.movementY) > 600) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (!this.locked) return;
      this.mouseDown = true;
      this.mousePressed = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return;
      if (this.mouseDown) this.mouseReleased = true;
      this.mouseDown = false;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) this.reset();
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      this.locked = false;
      this.onLockChange?.(false);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private isTyping(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  private reset() {
    this.down.clear();
    this.mouseDown = false;
    this.dx = 0;
    this.dy = 0;
  }

  async lock(): Promise<boolean> {
    if (this.locked) return true;
    try {
      // unadjustedMovement gives raw mouse input (no OS acceleration) where supported.
      const p = (this.el as any).requestPointerLock({ unadjustedMovement: true });
      if (p && typeof p.then === 'function') await p;
      return true;
    } catch {
      try {
        const p = this.el.requestPointerLock() as unknown;
        if (p && typeof (p as Promise<void>).then === 'function') await p;
        return true;
      } catch {
        return false;
      }
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  held(a: Action): boolean {
    if (!this.enabled) return false;
    return BINDINGS[a].some((c) => this.down.has(c));
  }

  justPressed(a: Action): boolean {
    if (!this.enabled) return false;
    return BINDINGS[a].some((c) => this.pressed.has(c));
  }

  justReleased(a: Action): boolean {
    return BINDINGS[a].some((c) => this.released.has(c));
  }

  /** Edge-triggered check for a physical key that is not a bound action (number keys). */
  codePressed(code: string): boolean {
    return this.enabled && this.pressed.has(code);
  }

  /** "Use" is E or the left mouse button. */
  useHeld(): boolean {
    return this.enabled && (this.held('use') || this.mouseDown);
  }
  usePressed(): boolean {
    return this.enabled && (this.justPressed('use') || this.mousePressed);
  }

  consumeMouse(): [number, number] {
    const r: [number, number] = [this.dx, this.dy];
    this.dx = 0;
    this.dy = 0;
    return r;
  }

  /** Call once at the end of every frame. */
  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mousePressed = false;
    this.mouseReleased = false;
  }

  // --- test hooks -----------------------------------------------------------
  /** Simulate a key state from automated tests. */
  debugSet(code: string, isDown: boolean) {
    if (isDown) {
      if (!this.down.has(code)) this.pressed.add(code);
      this.down.add(code);
    } else {
      this.down.delete(code);
      this.released.add(code);
    }
  }
}
