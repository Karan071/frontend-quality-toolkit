import type { Severity } from '@ftk/audit-core';
import { elementLabel } from '@ftk/dom-analyzer';
import { isToolkitNode } from '@ftk/dom-analyzer/collect';

const HOST_ID = '__ftk-host';

const COLORS = {
  margin: 'rgba(246, 178, 107, 0.62)',
  border: 'rgba(255, 229, 153, 0.66)',
  padding: 'rgba(147, 196, 125, 0.6)',
  content: 'rgba(111, 168, 220, 0.62)',
  selected: '#1a73e8',
};

const SEVERITY_COLOR: Record<Severity, string> = { error: '#e5484d', warning: '#f5a524', info: '#3e8ef7' };

const px = (v: string) => parseFloat(v) || 0;

const CSS = `
:host { all: initial; }
.layer { position: fixed; box-sizing: border-box; pointer-events: none; }
.tip { position: fixed; pointer-events: none; font: 11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; color: #fff; background: #1f2430; padding: 3px 6px; border-radius: 4px; white-space: nowrap; max-width: 90vw; overflow: hidden; text-overflow: ellipsis; box-shadow: 0 2px 8px rgba(0,0,0,.35); }
.tip b { color: #7cc4ff; font-weight: 600; }
.tip i { color: #ffcf99; font-style: normal; margin-left: 6px; }
.issue { position: fixed; box-sizing: border-box; pointer-events: none; border: 2px dashed; border-radius: 2px; }
.badge { position: fixed; pointer-events: none; font: 700 10px/16px system-ui, sans-serif; color: #fff; min-width: 16px; height: 16px; text-align: center; border-radius: 8px; padding: 0 4px; box-sizing: border-box; }
`;

interface Box { x: number; y: number; w: number; h: number }

/**
 * Draws hover/selection box-model overlays and issue highlights inside a
 * shadow root, so page CSS cannot affect them and they never match page selectors.
 */
export class Overlay {
  private host: HTMLElement;
  private root: ShadowRoot;
  private hover: Element | null = null;
  private selected: Element | null = null;
  private issues: { els: Element[]; severity: Severity } | null = null;
  private suspended = false;
  private keepIssuesWhenSuspended = false;
  private raf = 0;

  constructor() {
    this.host = document.createElement('div');
    this.host.id = HOST_ID;
    this.host.setAttribute('style', 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; contain: layout style;');
    this.root = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    this.root.append(style);
    const mount = () => (document.documentElement.appendChild(this.host));
    if (document.documentElement) mount();
    else document.addEventListener('DOMContentLoaded', mount, { once: true });

    const schedule = () => this.schedule();
    addEventListener('scroll', schedule, { capture: true, passive: true });
    addEventListener('resize', schedule, { passive: true });
  }

  setHover(el: Element | null) {
    if (this.hover === el) return;
    this.hover = el && !isToolkitNode(el) ? el : null;
    this.schedule();
  }

  setSelected(el: Element | null) {
    this.selected = el;
    this.schedule();
  }

  getSelected() {
    return this.selected;
  }

  setIssues(els: Element[], severity: Severity) {
    this.issues = els.length ? { els, severity } : null;
    this.schedule();
  }

  clearIssues() {
    this.setIssues([], 'info');
  }

  clearAll() {
    this.hover = null;
    this.selected = null;
    this.issues = null;
    this.schedule();
  }

  /** Hides everything (for screenshots). Issue highlights can be kept for finding captures. */
  suspend(keepIssues: boolean) {
    this.suspended = true;
    this.keepIssuesWhenSuspended = keepIssues;
    this.render();
  }

  resume() {
    this.suspended = false;
    this.render();
  }

  private schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  private clearLayers() {
    this.root.querySelectorAll('.layer,.tip,.issue,.badge').forEach((n) => n.remove());
  }

  private render() {
    this.clearLayers();
    // Re-attach if the page removed us (SPA frameworks sometimes rebuild <html> children).
    if (!this.host.isConnected && document.documentElement) document.documentElement.appendChild(this.host);

    if (this.suspended) {
      if (this.keepIssuesWhenSuspended) this.renderIssues();
      return;
    }
    if (this.hover && this.hover !== this.selected && this.hover.isConnected) this.renderBox(this.hover, false);
    if (this.selected?.isConnected) this.renderBox(this.selected, true);
    this.renderIssues();
  }

  private div(cls: string, box: Box, style: Partial<CSSStyleDeclaration> = {}): HTMLDivElement {
    const d = document.createElement('div');
    d.className = cls;
    Object.assign(d.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${Math.max(0, box.w)}px`, height: `${Math.max(0, box.h)}px` }, style);
    this.root.append(d);
    return d;
  }

  private renderBox(el: Element, selected: boolean) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const cs = getComputedStyle(el);
    const m = { t: px(cs.marginTop), r: px(cs.marginRight), b: px(cs.marginBottom), l: px(cs.marginLeft) };
    const b = { t: px(cs.borderTopWidth), r: px(cs.borderRightWidth), b: px(cs.borderBottomWidth), l: px(cs.borderLeftWidth) };
    const p = { t: px(cs.paddingTop), r: px(cs.paddingRight), b: px(cs.paddingBottom), l: px(cs.paddingLeft) };

    const frame = (box: Box, widths: typeof m, color: string) =>
      this.div('layer', box, {
        borderStyle: 'solid',
        borderColor: color,
        borderWidth: `${widths.t}px ${widths.r}px ${widths.b}px ${widths.l}px`,
      });

    frame({ x: r.x - m.l, y: r.y - m.t, w: r.width + m.l + m.r, h: r.height + m.t + m.b }, m, COLORS.margin);
    frame({ x: r.x, y: r.y, w: r.width, h: r.height }, b, COLORS.border);
    const pad = { x: r.x + b.l, y: r.y + b.t, w: r.width - b.l - b.r, h: r.height - b.t - b.b };
    frame(pad, p, COLORS.padding);
    this.div('layer', { x: pad.x + p.l, y: pad.y + p.t, w: pad.w - p.l - p.r, h: pad.h - p.t - p.b }, { background: COLORS.content });
    if (selected) this.div('layer', { x: r.x, y: r.y, w: r.width, h: r.height }, { outline: `2px solid ${COLORS.selected}`, outlineOffset: '0' });

    const tip = document.createElement('div');
    tip.className = 'tip';
    const label = elementLabel(el.localName, el.id || null, Array.from(el.classList).slice(0, 2));
    tip.innerHTML = '';
    const b1 = document.createElement('b');
    b1.textContent = label;
    const i1 = document.createElement('i');
    i1.textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`;
    tip.append(b1, i1);
    this.root.append(tip);
    const th = 22;
    let ty = r.y - m.t - th - 4;
    if (ty < 2) ty = Math.min(innerHeight - th - 2, r.y + r.height + m.b + 4);
    tip.style.left = `${Math.min(Math.max(2, r.x), Math.max(2, innerWidth - 200))}px`;
    tip.style.top = `${ty}px`;
  }

  private renderIssues() {
    if (!this.issues) return;
    const color = SEVERITY_COLOR[this.issues.severity];
    this.issues.els.slice(0, 40).forEach((el, i) => {
      if (!el.isConnected) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      if (r.bottom < -50 || r.top > innerHeight + 50) return;
      this.div('issue', { x: r.x, y: r.y, w: r.width, h: r.height }, { borderColor: color, background: `${color}22` });
      const badge = document.createElement('div');
      badge.className = 'badge';
      badge.textContent = String(i + 1);
      badge.style.background = color;
      badge.style.left = `${Math.max(0, r.x - 2)}px`;
      badge.style.top = `${Math.max(0, r.y - 18)}px`;
      this.root.append(badge);
    });
  }
}
