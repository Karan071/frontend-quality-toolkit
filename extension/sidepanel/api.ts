import type {
  BackgroundRequests,
  BackgroundType,
  BroadcastEvents,
  EventType,
  PageRequests,
  PageType,
  Result,
} from '../shared/messages';
import { errorMessage } from '../shared/messages';

const NO_RECEIVER = /receiving end does not exist|could not establish connection|message port closed/i;

/** Rejects if `promise` has not settled in `ms`, so a stalled page or browser call can never freeze the UI. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s. The page may be busy, loading, or in a background tab — try again.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Per-call budgets (ms). Everything else gets DEFAULT_TIMEOUT. */
const DEFAULT_TIMEOUT = 30_000;
const TIMEOUTS: Record<string, number> = {
  'page:collect': 60_000,
  'shot:warmup': 90_000,
  'bg:probe': 45_000,
  'bg:capture': 600_000, // very tall pages are captured tile by tile at ~2 tiles/second
};

async function unwrap<T>(promise: Promise<Result<T> | undefined>, label: string): Promise<T> {
  const result = await withTimeout(promise, TIMEOUTS[label] ?? DEFAULT_TIMEOUT, label);
  if (!result) throw new Error('No response from the page. Reload the tab and try again.');
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

export function callPage<K extends PageType>(tabId: number, type: K, payload: PageRequests[K]['req'] = {} as never): Promise<PageRequests[K]['res']> {
  return unwrap(chrome.tabs.sendMessage(tabId, { type, payload }) as Promise<Result<PageRequests[K]['res']>>, type);
}

export function callBg<K extends BackgroundType>(type: K, payload: BackgroundRequests[K]['req']): Promise<BackgroundRequests[K]['res']> {
  return unwrap(chrome.runtime.sendMessage({ type, payload }) as Promise<Result<BackgroundRequests[K]['res']>>, type);
}

/** URLs the extension cannot (or should not) run on. */
export function isRestricted(url: string | undefined): boolean {
  if (!url) return true;
  if (!/^(https?|file):/i.test(url)) return true;
  return /^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/i.test(url);
}

/**
 * The content script is declared in the manifest, but tabs that were open
 * before install/reload have none. Inject on demand.
 */
export async function ensureContent(tabId: number): Promise<void> {
  const ping = () => callPage(tabId, 'page:ping');
  try {
    await ping();
    return;
  } catch (e) {
    if (!NO_RECEIVER.test(errorMessage(e))) throw e;
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  await ping();
}

export function onBroadcast<K extends EventType>(type: K, fn: (payload: BroadcastEvents[K], sender: chrome.runtime.MessageSender) => void): () => void {
  const listener = (message: { type?: string }, sender: chrome.runtime.MessageSender) => {
    if (message?.type === type) fn({ ...(message as object), tabId: (message as { tabId?: number }).tabId ?? sender.tab?.id } as BroadcastEvents[K], sender);
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The clipboard API only accepts PNG for images, so JPEG captures are re-encoded. */
export async function copyImage(blob: Blob): Promise<void> {
  let png = blob;
  if (blob.type !== 'image/png') {
    const bmp = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0);
    png = await canvas.convertToBlob({ type: 'image/png' });
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

export function openViewer(id: string) {
  return chrome.tabs.create({ url: chrome.runtime.getURL(`viewer.html?id=${encodeURIComponent(id)}`) });
}
