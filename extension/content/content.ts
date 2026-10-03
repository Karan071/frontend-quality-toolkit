import { describeElement, relativeElement, TOOLKIT_ID_PREFIX } from '@ftk/dom-analyzer/collect';
import { queryAllSafe, uniqueSelector } from '@ftk/dom-analyzer/collect';
import { matchedRules } from '@ftk/css-analyzer/collect';
import { startVitals } from '@ftk/performance-analyzer/collect';
import { createShotDriver } from '@ftk/screenshot-engine/collect';
import type { BroadcastEvents, PageRequests, PageType, Result } from '../shared/messages';
import { errorMessage } from '../shared/messages';
import { collectSnapshot, viewportInfo } from './collect';
import { FixStore } from './fixes';
import { Inspector } from './inspector';
import { Overlay } from './overlay';

declare global {
  interface Window {
    __ftkLoaded?: boolean;
  }
}

/**
 * Content script. Runs at document_start so Web Vitals observers are attached
 * before the page paints; everything else waits for a message from the panel.
 */
function main() {
  if (window.__ftkLoaded || window.top !== window) return;
  window.__ftkLoaded = true;

  let panelSeen = false;
  const emit = <K extends keyof BroadcastEvents>(type: K, payload: Omit<BroadcastEvents[K], 'tabId'>) => {
    try {
      chrome.runtime.sendMessage({ type, ...payload }).catch(() => undefined);
    } catch {
      /* extension context invalidated (extension reloaded) */
    }
  };

  const vitals = startVitals(() => {
    if (panelSeen) emit('evt:vitals', { vitals: vitals.snapshot() });
  });

  const overlay = new Overlay();
  const fixes = new FixStore();
  const inspector = new Inspector(
    overlay,
    (selector) => emit('evt:picked', { selector }),
    () => emit('evt:pick-ended', {}),
  );
  const shots = createShotDriver(overlay);

  type Handlers = { [K in PageType]: (req: PageRequests[K]['req']) => PageRequests[K]['res'] | Promise<PageRequests[K]['res']> };

  const handlers: Handlers = {
    'page:ping': () => ({ url: location.href, title: document.title }),
    'page:collect': ({ kinds }) => collectSnapshot(kinds, () => vitals.snapshot()),
    'page:vitals': () => vitals.snapshot(),
    'page:viewport': () => viewportInfo(),

    'page:describe': ({ selector, all }) => {
      const el = queryAllSafe(selector, 1)[0];
      if (!el) return null;
      const { rules, inaccessible } = matchedRules(el);
      return { info: describeElement(el, all), rules, inaccessibleSheets: inaccessible };
    },
    'page:relative': ({ selector, rel }) => {
      const el = queryAllSafe(selector, 1)[0];
      const next = el && relativeElement(el, rel);
      if (!next) return null;
      overlay.setSelected(next);
      next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return { selector: uniqueSelector(next) };
    },

    'inspect:pick': ({ on }) => {
      if (on) inspector.start();
      else inspector.stop();
      return { on: inspector.isActive };
    },
    'inspect:select': ({ selector }) => {
      const el = selector ? queryAllSafe(selector, 1)[0] : null;
      overlay.setSelected(el ?? null);
      if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return { ok: !selector || !!el };
    },

    'highlight:set': ({ selectors, severity, scroll }) => {
      const els = [...new Set(selectors.flatMap((s) => queryAllSafe(s, 40)))].filter((e) => !e.id.startsWith(TOOLKIT_ID_PREFIX));
      overlay.setIssues(els, severity ?? 'warning');
      if (scroll && els[0]) {
        const r = els[0].getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight) els[0].scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
      }
      return { matched: els.length };
    },
    'highlight:clear': () => {
      overlay.clearIssues();
      return {};
    },

    'fix:apply': ({ id, css, label }) => ({ count: fixes.apply(id, css, label) }),
    'fix:remove': ({ id }) => ({ count: fixes.remove(id) }),
    'fix:clear': () => ({ count: fixes.clear() }),
    'fix:list': () => ({ fixes: fixes.list() }),

    'shot:prepare': (req) => shots.prepare(req),
    'shot:warmup': () => shots.warmUp(),
    'shot:scroll': (req) => shots.scroll(req),
    'shot:element': ({ selector }) => shots.element(selector),
    'shot:restore': async () => {
      await shots.restore();
      return {};
    },
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const type = message?.type as PageType | undefined;
    if (!type || !(type in handlers)) return false;
    panelSeen = true;
    const run = async (): Promise<Result<unknown>> => {
      try {
        const handler = handlers[type] as (req: unknown) => unknown;
        return { ok: true, data: await handler(message.payload ?? {}) };
      } catch (e) {
        return { ok: false, error: errorMessage(e) };
      }
    };
    run().then(sendResponse);
    return true; // async response
  });
}

main();
