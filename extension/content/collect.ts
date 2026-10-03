import type { CollectKind, PageSnapshot, Visitor, VitalsSnapshot } from '@ftk/audit-core';
import { collectMeta, walkDocument } from '@ftk/dom-analyzer/collect';
import { collectCss } from '@ftk/css-analyzer/collect';
import { overflowVisitor } from '@ftk/layout-analyzer/collect';
import { imagesVisitor } from '@ftk/image-analyzer/collect';
import { collectResources, collectScripts } from '@ftk/bundle-analyzer/collect';
import { a11yVisitor } from '@ftk/accessibility-analyzer/collect';
import { colorsVisitor } from '@ftk/color-analyzer/collect';
import { typographyVisitor } from '@ftk/typography-analyzer/collect';
import { spacingVisitor, uxVisitor } from '@ftk/ux-analyzer/collect';

export function viewportInfo() {
  const de = document.documentElement;
  return {
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio,
    clientWidth: de.clientWidth,
    scrollWidth: de.scrollWidth,
    scrollHeight: de.scrollHeight,
    scrollX: Math.round(scrollX),
    scrollY: Math.round(scrollY),
  };
}

/**
 * Builds the requested slices of a PageSnapshot. Everything that needs
 * computed styles shares one pass over the DOM.
 */
export function collectSnapshot(kinds: CollectKind[], vitals: () => VitalsSnapshot): Partial<PageSnapshot> & { truncated?: boolean } {
  const want = new Set(kinds);
  const out: Partial<PageSnapshot> & { truncated?: boolean } = { takenAt: Date.now(), viewport: viewportInfo() };
  const visitors: Visitor<unknown>[] = [];
  const finish: (() => void)[] = [];

  const use = <T,>(v: Visitor<T>, assign: (value: T) => void) => {
    visitors.push(v as Visitor<unknown>);
    finish.push(() => assign(v.result()));
  };

  if (want.has('images')) use(imagesVisitor(), (v) => (out.images = v));
  if (want.has('overflow')) use(overflowVisitor(), (v) => (out.overflow = v));
  if (want.has('a11y')) use(a11yVisitor(), (v) => (out.a11y = v));
  if (want.has('styles')) {
    use(colorsVisitor(), (v) => (out.colors = v));
    use(typographyVisitor(), (v) => (out.typography = v));
    use(spacingVisitor(), (v) => (out.spacing = v));
    use(uxVisitor(), (v) => (out.ux = v));
  }

  if (visitors.length) {
    const { truncated } = walkDocument(visitors);
    if (truncated) out.truncated = true;
    finish.forEach((f) => f());
  }

  if (want.has('meta')) out.meta = collectMeta();
  if (want.has('css')) out.css = collectCss();
  if (want.has('resources')) {
    out.resources = collectResources();
    out.scripts = collectScripts();
  }
  if (want.has('vitals')) out.vitals = vitals();
  return out;
}
