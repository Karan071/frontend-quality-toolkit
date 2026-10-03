import { isToolkitNode, uniqueSelector } from '@ftk/dom-analyzer/collect';
import type { Overlay } from './overlay';

type Listener = { type: string; fn: (e: Event) => void };

/**
 * Element picker. While active it swallows page interaction in the capture
 * phase, previews the hovered element, and selects on click (like DevTools).
 */
export class Inspector {
  private active = false;
  private listeners: Listener[] = [];
  private lastHover: Element | null = null;

  constructor(
    private overlay: Overlay,
    private onPicked: (selector: string) => void,
    private onEnded: () => void,
  ) {}

  get isActive() {
    return this.active;
  }

  start() {
    if (this.active) return;
    this.active = true;
    const block = (e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const target = (e: Event): Element | null => {
      // composedPath()[0] is the real element even when the event was retargeted to a shadow host.
      const el = (e.composedPath?.()[0] ?? e.target) as Element | null;
      return el && el.nodeType === 1 && !isToolkitNode(el) ? el : null;
    };
    const add = (type: string, fn: (e: Event) => void) => {
      addEventListener(type, fn, { capture: true });
      this.listeners.push({ type, fn });
    };

    add('mousemove', (e) => {
      const el = target(e);
      if (el !== this.lastHover) {
        this.lastHover = el;
        this.overlay.setHover(el);
      }
    });
    add('click', (e) => {
      block(e);
      const el = target(e);
      if (!el) return;
      this.overlay.setSelected(el);
      this.stop();
      this.onPicked(uniqueSelector(el));
    });
    for (const t of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick', 'contextmenu', 'dblclick', 'touchstart', 'touchend', 'submit']) {
      add(t, block);
    }
    add('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Escape') {
        block(e);
        this.stop();
      }
    });
    document.documentElement.style.setProperty('cursor', 'crosshair', 'important');
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.listeners.forEach(({ type, fn }) => removeEventListener(type, fn, { capture: true }));
    this.listeners = [];
    this.lastHover = null;
    this.overlay.setHover(null);
    document.documentElement.style.removeProperty('cursor');
    this.onEnded();
  }
}
