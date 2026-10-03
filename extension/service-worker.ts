import type { ProbeInfo } from '@ftk/audit-core';
import { capture } from '@ftk/screenshot-engine/engine';
import type { PageDriver } from '@ftk/screenshot-engine/engine';
import type { BackgroundRequests, BackgroundType, BroadcastEvents, EmulationState, PageRequests, PageType, Result } from './shared/messages';
import { PANEL_PORT, errorMessage } from './shared/messages';
import { saveScreenshot } from './shared/store';

// ───────────────────────────── side panel ─────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
});

const broadcast = <K extends keyof BroadcastEvents>(type: K, payload: BroadcastEvents[K]) =>
  chrome.runtime.sendMessage({ type, ...payload }).catch(() => undefined);

// ───────────────────────────── page messaging ─────────────────────────────

/** Never wait forever on the page or the browser: a stalled call must surface as an error. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s. The page may be busy, loading, or in a background tab.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function callPage<K extends PageType>(tabId: number, type: K, payload: PageRequests[K]['req'] = {} as never): Promise<PageRequests[K]['res']> {
  const budget = type === 'shot:warmup' ? 90_000 : 30_000;
  const result = (await withTimeout(chrome.tabs.sendMessage(tabId, { type, payload }), budget, type)) as Result<PageRequests[K]['res']> | undefined;
  if (!result) throw new Error('The page did not respond. Reload the tab and try again.');
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

// ───────────────────────────── device emulation ─────────────────────────────

/**
 * Responsive testing uses the DevTools protocol (Emulation.setDeviceMetricsOverride)
 * so the page sees a real viewport of the requested size regardless of how wide the
 * side panel or window is. Chrome shows its "is debugging this browser" bar while attached.
 */
const attached = new Set<number>();
const emulation = new Map<number, EmulationState>();
const SESSION_KEY = 'ftk:emulated-tabs';

async function persistEmulation() {
  try {
    await chrome.storage.session.set({ [SESSION_KEY]: [...emulation.entries()] });
  } catch {
    /* storage.session unavailable */
  }
}

async function restoreEmulation() {
  try {
    const stored = (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] as [number, EmulationState][] | undefined;
    stored?.forEach(([id, state]) => {
      emulation.set(id, state);
      attached.add(id);
    });
  } catch {
    /* ignore */
  }
}
// Every handler awaits this; a slow storage read must never block them indefinitely.
const ready = Promise.race([restoreEmulation(), new Promise<void>((r) => setTimeout(r, 2000))]);

async function ensureAttached(tabId: number) {
  if (attached.has(tabId)) return;
  try {
    await withTimeout(chrome.debugger.attach({ tabId }, '1.3'), 15_000, 'debugger.attach');
  } catch (e) {
    // Already attached by us in a previous worker lifetime.
    if (!/already attached/i.test(errorMessage(e))) throw new Error(`Cannot attach debugger: ${errorMessage(e)}`, { cause: e });
  }
  attached.add(tabId);
}

const cdp = <T = unknown>(tabId: number, method: string, params?: object) =>
  withTimeout(chrome.debugger.sendCommand({ tabId }, method, params) as Promise<T>, 20_000, method);

async function setEmulation(tabId: number, width: number, height: number, mobile: boolean, dpr = 0): Promise<EmulationState> {
  await ensureAttached(tabId);
  await cdp(tabId, 'Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: dpr, // 0 keeps the real device scale factor
    mobile,
    screenWidth: width,
    screenHeight: height,
  });
  await cdp(tabId, 'Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
  const state: EmulationState = { active: true, width, height, mobile, dpr };
  emulation.set(tabId, state);
  await persistEmulation();
  return state;
}

async function clearEmulation(tabId: number): Promise<EmulationState> {
  if (attached.has(tabId)) {
    await cdp(tabId, 'Emulation.clearDeviceMetricsOverride').catch(() => undefined);
    await cdp(tabId, 'Emulation.setTouchEmulationEnabled', { enabled: false }).catch(() => undefined);
    await chrome.debugger.detach({ tabId }).catch(() => undefined);
    attached.delete(tabId);
  }
  emulation.delete(tabId);
  await persistEmulation();
  return { active: false };
}

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId == null) return;
  attached.delete(source.tabId);
  if (emulation.delete(source.tabId)) {
    persistEmulation();
    broadcast('evt:emulation', { tabId: source.tabId, state: { active: false } });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  attached.delete(tabId);
  if (emulation.delete(tabId)) persistEmulation();
});

// ───────────────────────────── size probing ─────────────────────────────

/** Fetches Content-Length for resources whose size Resource Timing hides (cross-origin). */
async function probeOne(url: string): Promise<ProbeInfo> {
  const signal = AbortSignal.timeout(8000);
  const opts = { credentials: 'omit' as const, cache: 'force-cache' as const, signal };
  const read = (res: Response, size?: number): ProbeInfo => ({
    size: size ?? (res.headers.get('content-length') ? Number(res.headers.get('content-length')) : undefined),
    contentType: res.headers.get('content-type') ?? undefined,
    contentEncoding: res.headers.get('content-encoding') ?? undefined,
    cacheControl: res.headers.get('cache-control') ?? undefined,
  });
  try {
    const head = await fetch(url, { ...opts, method: 'HEAD' });
    if (head.ok) {
      const info = read(head);
      if (info.size) return info;
      const range = await fetch(url, { ...opts, headers: { Range: 'bytes=0-0' } });
      const total = /\/(\d+)$/.exec(range.headers.get('content-range') ?? '')?.[1];
      return read(range, total ? Number(total) : undefined);
    }
  } catch {
    /* network error or timeout */
  }
  return {};
}

async function probe(urls: string[]): Promise<Record<string, ProbeInfo>> {
  const unique = [...new Set(urls.filter((u) => /^https?:/.test(u)))].slice(0, 150);
  const out: Record<string, ProbeInfo> = {};
  let i = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (i < unique.length) {
        const url = unique[i++];
        out[url] = await probeOne(url);
      }
    }),
  );
  return out;
}

/** Fetches stylesheet text the page itself cannot read (cross-origin, no CORS). Capped and credential-free. */
async function fetchCss(urls: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const list = [...new Set(urls.filter((u) => /^https?:/.test(u)))].slice(0, 15);
  await Promise.all(
    list.map(async (url) => {
      try {
        const res = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(8000) });
        if (!res.ok) return;
        out[url] = (await res.text()).slice(0, 800_000);
      } catch {
        /* unreachable or timed out: the sheet simply stays unreadable */
      }
    }),
  );
  return out;
}

// ───────────────────────────── screenshots ─────────────────────────────

// chrome.tabs.captureVisibleTab is limited to ~2 calls per second.
let lastCapture = 0;
const MIN_CAPTURE_GAP_MS = 600;

async function grabVisible(windowId: number): Promise<ImageBitmap> {
  const wait = lastCapture + MIN_CAPTURE_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCapture = Date.now();
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  return createImageBitmap(await (await fetch(dataUrl)).blob());
}

async function grabViaDebugger(tabId: number): Promise<ImageBitmap> {
  const { data } = await cdp<{ data: string }>(tabId, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  return createImageBitmap(new Blob([bytes], { type: 'image/png' }));
}

async function captureShot(req: BackgroundRequests['bg:capture']['req']): Promise<{ id: string; ids: string[] }> {
  await ready;
  const { tabId } = req;
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !/^(https?|file):/.test(tab.url)) throw new Error('Screenshots are only available on web pages.');

  // captureVisibleTab only sees the active tab; emulation also needs the DevTools protocol.
  const useDebugger = attached.has(tabId) || !tab.active;
  let temporary = false;
  if (useDebugger && !attached.has(tabId)) {
    await ensureAttached(tabId);
    temporary = true;
  }

  const driver: PageDriver = {
    prepare: (o) => callPage(tabId, 'shot:prepare', o),
    warmUp: () => callPage(tabId, 'shot:warmup'),
    scroll: (o) => callPage(tabId, 'shot:scroll', o),
    element: (selector) => callPage(tabId, 'shot:element', { selector }),
    restore: () => callPage(tabId, 'shot:restore').then(() => undefined),
  };

  try {
    const outputs = await capture(req, {
      driver,
      grab: () => (useDebugger ? grabViaDebugger(tabId) : grabVisible(tab.windowId)),
      progress: (done, total) => broadcast('evt:shot-progress', { tabId, done, total }),
    });
    const ids: string[] = [];
    const now = Date.now();
    for (const [i, out] of outputs.entries()) {
      const id = crypto.randomUUID();
      ids.push(id);
      // Parts of one capture stay together and keep their order (newest-first listing).
      await saveScreenshot({ ...out, id, createdAt: now + (outputs.length - i) });
    }
    return { id: ids[0], ids };
  } finally {
    if (temporary) {
      attached.delete(tabId);
      await chrome.debugger.detach({ tabId }).catch(() => undefined);
    }
  }
}

// ───────────────────────────── routing ─────────────────────────────

type BgHandlers = { [K in BackgroundType]: (req: BackgroundRequests[K]['req']) => Promise<BackgroundRequests[K]['res']> };

const handlers: BgHandlers = {
  'bg:probe': ({ urls }) => probe(urls),
  'bg:fetch-css': ({ urls }) => fetchCss(urls),
  'bg:emulate': async ({ tabId, width, height, mobile, dpr }) => {
    await ready;
    const state = await setEmulation(tabId, width, height, mobile, dpr);
    broadcast('evt:emulation', { tabId, state });
    return state;
  },
  'bg:emulate-clear': async ({ tabId }) => {
    await ready;
    const state = await clearEmulation(tabId);
    broadcast('evt:emulation', { tabId, state });
    return state;
  },
  'bg:emulation-state': async ({ tabId }) => {
    await ready;
    return emulation.get(tabId) ?? { active: false };
  },
  'bg:capture': (req) => captureShot(req),
  'bg:reload': async ({ tabId, bypassCache }) => {
    await chrome.tabs.reload(tabId, { bypassCache });
    return {};
  },
  'bg:cleanup': async ({ tabId }) => {
    await clearEmulation(tabId);
    await callPage(tabId, 'fix:clear').catch(() => undefined);
    await callPage(tabId, 'highlight:clear').catch(() => undefined);
    await callPage(tabId, 'inspect:pick', { on: false }).catch(() => undefined);
    await callPage(tabId, 'inspect:select', { selector: null }).catch(() => undefined);
    return {};
  },
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message?.type as BackgroundType | undefined;
  if (!type || !(type in handlers)) return false;
  (async (): Promise<Result<unknown>> => {
    try {
      const handler = handlers[type] as (req: unknown) => Promise<unknown>;
      return { ok: true, data: await handler(message.payload ?? {}) };
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
  })().then(sendResponse);
  return true;
});

// ───────────────────────────── panel lifetime ─────────────────────────────

/**
 * The panel holds a port open and pings it, which keeps this worker alive while
 * the panel is visible. When the panel closes, undo everything we changed on the
 * page: emulation, temporary CSS and overlays.
 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PANEL_PORT) return;
  const touched = new Set<number>();
  port.onMessage.addListener((msg: { type: string; tabId?: number }) => {
    if (msg.type === 'touch' && msg.tabId != null) touched.add(msg.tabId);
  });
  port.onDisconnect.addListener(() => {
    touched.forEach((tabId) => handlers['bg:cleanup']({ tabId }).catch(() => undefined));
  });
});
