import type { OverflowCulprit, OverflowData, Visitor } from '@ftk/audit-core';
import { isToolkitNode, uniqueSelector } from '@ftk/dom-analyzer/collect';
import { anchorOf } from './index';
import type { PositionedElement } from './index';

const MAX_CULPRITS = 25;

function clippedByAncestor(el: Element, clientWidth: number): boolean {
  for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (s.position === 'fixed') return true;
    if (s.overflowX !== 'visible') {
      const r = p.getBoundingClientRect();
      if (r.right <= clientWidth + 1) return true;
    }
  }
  return false;
}

/**
 * Finds the outermost elements that stick out past the right edge of the
 * layout viewport and are not clipped by an overflow container.
 */
export function overflowVisitor(): Visitor<OverflowData> {
  const root = document.documentElement;
  const clientWidth = root.clientWidth;
  const hasHorizontalScroll = root.scrollWidth > clientWidth + 1;
  const culprits: OverflowCulprit[] = [];
  const covered = new WeakSet<Element>();
  let culpritCount = 0;

  return {
    visit(ctx) {
      if (!hasHorizontalScroll) return;
      const { el } = ctx;
      const parent = el.parentElement;
      if (parent && covered.has(parent)) {
        covered.add(el);
        return;
      }
      if (!ctx.visible()) return;
      const rect = ctx.rect();
      if (rect.right <= clientWidth + 1) return;
      if (ctx.style.position === 'fixed' || clippedByAncestor(el, clientWidth)) return;
      covered.add(el);
      culpritCount++;
      if (culprits.length < MAX_CULPRITS) {
        const inlineWidth = (el as HTMLElement).style?.width ?? '';
        culprits.push({
          selector: ctx.selector(),
          tag: el.localName,
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          fixedWidth: /px$/.test(inlineWidth) || /^\d+$/.test(el.getAttribute('width') ?? ''),
        });
      }
    },
    result: () => ({
      hasHorizontalScroll,
      scrollWidth: root.scrollWidth,
      clientWidth,
      culprits,
      culpritCount,
    }),
  };
}

/** All position:fixed / position:sticky elements currently rendered. */
export function findPositioned(): PositionedElement[] {
  const out: PositionedElement[] = [];
  const vh = window.innerHeight;
  for (const el of Array.from(document.body?.querySelectorAll('*') ?? [])) {
    if (isToolkitNode(el)) continue;
    const pos = getComputedStyle(el).position;
    if (pos !== 'fixed' && pos !== 'sticky') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    out.push({
      selector: uniqueSelector(el),
      kind: pos,
      anchor: anchorOf(r, vh),
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    });
  }
  return out;
}
