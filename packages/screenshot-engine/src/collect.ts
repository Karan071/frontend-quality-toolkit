import { anchorOf } from '@ftk/layout-analyzer';
import { isToolkitNode, queryAllSafe } from '@ftk/dom-analyzer/collect';
import type { PageDriver } from './engine';
import type { ElementTarget, PrepareInfo } from './index';

const STYLE_ID = '__ftk-shot-style';

const CAPTURE_CSS = `
html { scroll-behavior: auto !important; scroll-snap-type: none !important; scrollbar-width: none !important; }
html::-webkit-scrollbar, body::-webkit-scrollbar { display: none !important; }
html[data-ftk-hide="bottom"] [data-ftk-pos="bottom"],
html[data-ftk-hide="top"] [data-ftk-pos="top"],
html[data-ftk-hide="all"] [data-ftk-pos] { visibility: hidden !important; }
[data-ftk-sticky] { position: relative !important; inset: auto !important; }
`;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** rAF does not fire in background tabs, so never wait on it alone. */
const nextFrame = () =>
  Promise.race([new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))), sleep(150)]);

async function settle() {
  await nextFrame();
  await sleep(60);
}

function docSize() {
  const de = document.documentElement;
  return {
    width: Math.max(de.scrollWidth, document.body?.scrollWidth ?? 0, de.clientWidth),
    height: Math.max(de.scrollHeight, document.body?.scrollHeight ?? 0, de.clientHeight),
  };
}

interface Session {
  scroll: { x: number; y: number };
  style: HTMLStyleElement | null;
  marked: Element[];
  /** Inner scroll container, when the document itself does not scroll. */
  scroller: { el: Element; scrollLeft: number; scrollTop: number } | null;
}

export interface OverlayControl {
  /** Hides toolkit overlays so they do not appear in the screenshot. */
  suspend(keepHighlight: boolean): void;
  resume(): void;
}

/**
 * Finds the main inner scroll container when the document itself does not scroll
 * (app-shell layouts). Picks the largest one that is mostly on screen.
 */
function findInnerScroller(): Element | null {
  const vh = innerHeight;
  const vw = innerWidth;
  let best: { el: Element; area: number } | null = null;
  for (const el of Array.from(document.body?.querySelectorAll('*') ?? [])) {
    if (isToolkitNode(el)) continue;
    const s = getComputedStyle(el);
    if (!/(auto|scroll)/.test(s.overflowY) || el.scrollHeight <= el.clientHeight + 100) continue;
    if (el.clientHeight < vh * 0.5 || el.clientWidth < vw * 0.4) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > vh) continue;
    const area = el.clientWidth * el.clientHeight;
    if (!best || area > best.area) best = { el, area };
  }
  return best?.el ?? null;
}

const describe = (el: Element) => el.localName + (el.id ? `#${el.id}` : el.classList[0] ? `.${el.classList[0]}` : '');

export function createShotDriver(overlay: OverlayControl): PageDriver {
  let session: Session | null = null;

  const restore = async () => {
    if (!session) return;
    session.style?.remove();
    session.marked.forEach((el) => {
      el.removeAttribute('data-ftk-pos');
      el.removeAttribute('data-ftk-sticky');
    });
    document.documentElement.removeAttribute('data-ftk-hide');
    window.scrollTo({ left: session.scroll.x, top: session.scroll.y, behavior: 'instant' as ScrollBehavior });
    if (session.scroller) {
      session.scroller.el.scrollTo({ left: session.scroller.scrollLeft, top: session.scroller.scrollTop, behavior: 'instant' as ScrollBehavior });
    }
    overlay.resume();
    session = null;
  };

  return {
    async prepare({ mode, keepHighlight }) {
      await restore();
      overlay.suspend(keepHighlight);
      const warnings: string[] = [];
      const marked: Element[] = [];
      let style: HTMLStyleElement | null = null;
      let bottomFixedHeight = 0;
      const vh = innerHeight;

      if (mode !== 'viewport') {
        style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CAPTURE_CSS;
        document.documentElement.appendChild(style);

        for (const el of Array.from(document.body?.querySelectorAll('*') ?? [])) {
          if (isToolkitNode(el)) continue;
          const pos = getComputedStyle(el).position;
          if (pos === 'sticky') {
            el.setAttribute('data-ftk-sticky', '');
            marked.push(el);
          } else if (pos === 'fixed') {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            const anchor = anchorOf(r, vh);
            el.setAttribute('data-ftk-pos', anchor);
            marked.push(el);
            if (anchor === 'bottom') bottomFixedHeight = Math.max(bottomFixedHeight, vh - r.y);
          }
        }
      }

      session = { scroll: { x: scrollX, y: scrollY }, style, marked, scroller: null };
      const doc = docSize();
      let scroller: PrepareInfo['scroller'];
      if (mode === 'fullpage' && doc.height <= vh * 1.05) {
        const inner = findInnerScroller();
        if (inner) {
          session.scroller = { el: inner, scrollLeft: inner.scrollLeft, scrollTop: inner.scrollTop };
          const r = inner.getBoundingClientRect();
          scroller = {
            label: describe(inner),
            rect: { x: r.x + inner.clientLeft, y: r.y + inner.clientTop, width: inner.clientWidth, height: inner.clientHeight },
            scrollWidth: inner.scrollWidth,
            scrollHeight: inner.scrollHeight,
          };
          warnings.push(`This page scrolls inside <${scroller.label}>; the capture shows that scrolling area (everything outside it is omitted).`);
        }
      }
      const info: PrepareInfo = {
        viewport: { width: innerWidth, height: vh, dpr: devicePixelRatio },
        doc,
        scroll: session.scroll,
        url: location.href,
        title: document.title,
        bottomFixedHeight: Math.min(bottomFixedHeight, vh),
        warnings,
        scroller,
      };
      return info;
    },

    async warmUp() {
      const inner = session?.scroller?.el;
      if (inner) {
        // Same pre-scroll pass, on the inner container.
        const step = Math.max(200, Math.round(inner.clientHeight * 0.8));
        for (let y = 0, i = 0; y < inner.scrollHeight && i < 80 && y < 40000; y += step, i++) {
          inner.scrollTo({ left: 0, top: y, behavior: 'instant' as ScrollBehavior });
          await sleep(90);
        }
        inner.scrollTo({ left: 0, top: 0, behavior: 'instant' as ScrollBehavior });
        await settle();
        return { width: inner.scrollWidth, height: inner.scrollHeight };
      }
      // Scroll through the page so lazy images and reveal-on-scroll content load before capture.
      let { height } = docSize();
      const step = Math.max(200, Math.round(innerHeight * 0.8));
      for (let y = 0, i = 0; y < height && i < 80 && y < 40000; y += step, i++) {
        window.scrollTo({ left: 0, top: y, behavior: 'instant' as ScrollBehavior });
        await sleep(90);
        height = docSize().height;
      }
      window.scrollTo({ left: 0, top: 0, behavior: 'instant' as ScrollBehavior });
      // Give just-requested images a moment to decode.
      const pending = Array.from(document.images).filter((i) => !i.complete && i.src);
      if (pending.length) {
        await Promise.race([Promise.all(pending.map((i) => i.decode().catch(() => undefined))), sleep(1500)]);
      }
      await settle();
      return docSize();
    },

    async scroll({ x, y, hide }) {
      document.documentElement.setAttribute('data-ftk-hide', hide);
      const inner = session?.scroller?.el;
      if (inner) {
        inner.scrollTo({ left: x, top: y, behavior: 'instant' as ScrollBehavior });
        await settle();
        return { x: inner.scrollLeft, y: inner.scrollTop };
      }
      window.scrollTo({ left: x, top: y, behavior: 'instant' as ScrollBehavior });
      await settle();
      return { x: scrollX, y: scrollY };
    },

    async element(selector): Promise<ElementTarget | null> {
      const el = queryAllSafe(selector, 1)[0];
      if (!el) return null;
      let r = el.getBoundingClientRect();
      const fits = r.width <= innerWidth + 1 && r.height <= innerHeight + 1;
      if (fits) {
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
        await settle();
        r = el.getBoundingClientRect();
      }
      const x = Math.max(0, r.x + scrollX);
      const y = Math.max(0, r.y + scrollY);
      return {
        fits,
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        docRect: { x, y, width: r.width - (x - (r.x + scrollX)), height: r.height - (y - (r.y + scrollY)) },
      };
    },

    restore,
  };
}
