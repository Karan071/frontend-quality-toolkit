import { ALL_KINDS } from '@ftk/audit-core';
import type { PageSnapshot, ProbeInfo, Severity } from '@ftk/audit-core';
import { toMarkdown } from '@ftk/recommendation-engine';
import { DEVICE_PRESETS, summarizeViewportTest } from '@ftk/responsive-analyzer';
import type { DevicePreset } from '@ftk/responsive-analyzer';
import type { ShotType } from '@ftk/screenshot-engine';
import type { EnrichedFinding } from '@ftk/audit-core';
import { PANEL_PORT, errorMessage } from '../shared/messages';
import { applyProbes, buildAudit, urlsToProbe } from '../shared/audit';
import { deleteScreenshot, clearScreenshots, listScreenshots } from '../shared/store';
import { callBg, callPage, downloadBlob, ensureContent, isRestricted, onBroadcast, sleep } from './api';
import { currentAudit, currentBaseline, getState, setState } from './state';
import type { AppliedFix, RouteId, Settings, Theme, Toast } from './state';

const SETTINGS_KEY = 'ftk:settings';

// ───────────────────────────── helpers ─────────────────────────────

let toastSeq = 0;
export function toast(message: string, tone: Toast['tone'] = 'info', action?: Toast['action']) {
  const id = ++toastSeq;
  setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, tone, action }] }));
  setTimeout(() => dismissToast(id), tone === 'error' ? 8000 : 4500);
}

export function dismissToast(id: number) {
  setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

function requireTab(): number {
  const { tab } = getState();
  if (tab.id == null || tab.status === 'restricted') throw new Error('Open a regular web page (http/https) to use the toolkit.');
  return tab.id;
}

/** Runs an action, surfacing any failure as a toast instead of an unhandled rejection. */
export async function guarded<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    toast(errorMessage(e), 'error');
    return undefined;
  }
}

export function navigate(route: RouteId, focusFinding: string | null = null) {
  setState({ route, focusFinding });
}

// ───────────────────────────── bootstrap & tab tracking ─────────────────────────────

let port: chrome.runtime.Port | null = null;
let targetParam: number | null = null;
let windowId: number | undefined;

function connectPort() {
  try {
    port = chrome.runtime.connect({ name: PANEL_PORT });
    port.onDisconnect.addListener(() => {
      port = null;
      setTimeout(() => {
        connectPort();
        const id = getState().tab.id;
        if (id != null) port?.postMessage({ type: 'touch', tabId: id });
      }, 500);
    });
  } catch {
    port = null;
  }
}

export async function init() {
  const params = new URLSearchParams(location.search);
  targetParam = params.get('tab') ? Number(params.get('tab')) : null;

  const stored = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as Settings | undefined;
  if (stored) setState((s) => ({ settings: { ...s.settings, ...stored } }));
  applyTheme(getState().settings.theme);
  setState({ screenshots: await listScreenshots() });

  connectPort();
  setInterval(() => port?.postMessage({ type: 'ping' }), 20_000);

  windowId = (await chrome.windows.getCurrent()).id;
  const tab = await resolveTarget();
  if (tab) await setTarget(tab);
  setState({ ready: true });

  chrome.tabs.onActivated.addListener(async ({ tabId, windowId: w }) => {
    if (targetParam != null || w !== windowId) return;
    await setTarget(await chrome.tabs.get(tabId));
  });
  chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (tabId !== getState().tab.id) return;
    if (change.status === 'loading') onNavigationStart(tab);
    else if (change.status === 'complete') void setTarget(tab);
    else if (change.url) setState((s) => ({ tab: { ...s.tab, url: tab.url ?? s.tab.url, title: tab.title ?? s.tab.title } }));
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === getState().tab.id && targetParam != null) setState((s) => ({ tab: { ...s.tab, status: 'none' } }));
  });

  onBroadcast('evt:picked', ({ tabId, selector }) => {
    if (tabId !== getState().tab.id) return;
    setState({ picking: false, route: 'inspect' });
    void guarded(() => selectSelector(selector));
  });
  onBroadcast('evt:pick-ended', ({ tabId }) => {
    if (tabId === getState().tab.id) setState({ picking: false });
  });
  onBroadcast('evt:vitals', ({ tabId, vitals }) => {
    if (tabId !== getState().tab.id) return;
    setState({ vitals, measuring: getState().measuring && vitals.load == null });
  });
  onBroadcast('evt:shot-progress', ({ tabId, done, total }) => {
    if (tabId !== getState().tab.id) return;
    setState((s) => (s.shotBusy ? { shotBusy: { ...s.shotBusy, done, total } } : {}));
  });
  onBroadcast('evt:emulation', ({ tabId, state }) => {
    if (tabId !== getState().tab.id) return;
    setState((s) => ({ emulation: state.active ? { ...state, label: s.emulation.label } : { active: false } }));
  });
}

async function resolveTarget(): Promise<chrome.tabs.Tab | undefined> {
  if (targetParam != null) return chrome.tabs.get(targetParam).catch(() => undefined);
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  return tab;
}

function onNavigationStart(tab: chrome.tabs.Tab) {
  // Everything injected into the old document is gone.
  setState({
    tab: { id: tab.id ?? null, url: tab.url ?? '', title: tab.title ?? '', status: 'loading' },
    selection: null,
    picking: false,
    fixes: {},
    highlightedId: null,
    vitals: null,
    viewportTests: [],
  });
}

export async function setTarget(tab: chrome.tabs.Tab) {
  const id = tab.id ?? null;
  const url = tab.url ?? '';
  const prev = getState().tab;
  const switching = prev.id !== id;
  if (id == null || isRestricted(url)) {
    setState({ tab: { id, url, title: tab.title ?? '', status: 'restricted' }, selection: null, picking: false, fixes: {} });
    return;
  }
  setState((s) => ({
    tab: { id, url, title: tab.title ?? '', status: 'loading' },
    ...(switching ? { selection: null, picking: false, fixes: {}, highlightedId: null, vitals: null, viewportTests: [], emulation: { active: false } } : {}),
    auditError: null,
  }));
  try {
    await ensureContent(id);
    port?.postMessage({ type: 'touch', tabId: id });
    const [vitals, fixList, emu] = await Promise.all([
      callPage(id, 'page:vitals'),
      callPage(id, 'fix:list'),
      callBg('bg:emulation-state', { tabId: id }),
    ]);
    const fixes: Record<string, AppliedFix> = {};
    for (const f of fixList.fixes) {
      fixes[f.id] = { id: f.id, ruleId: f.id.split(':')[0], label: f.label ?? f.id, css: f.css, findingId: f.id.startsWith('custom:') ? null : f.id };
    }
    setState((s) => ({ tab: { ...s.tab, status: 'ready' }, vitals, fixes, emulation: emu.active ? { ...emu } : { active: false } }));
  } catch (e) {
    setState((s) => ({ tab: { ...s.tab, status: 'ready' }, auditError: errorMessage(e) }));
  }
}

/** `system` removes the override so the stylesheet follows prefers-color-scheme. */
export function applyTheme(theme: Theme) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

const THEME_ORDER: Theme[] = ['system', 'light', 'dark'];

export function cycleTheme() {
  const cur = getState().settings.theme;
  const next = THEME_ORDER[(THEME_ORDER.indexOf(cur) + 1) % THEME_ORDER.length];
  applyTheme(next);
  return saveSettings({ theme: next });
}

export async function saveSettings(patch: Partial<Settings>) {
  const settings = { ...getState().settings, ...patch };
  setState({ settings });
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

// ───────────────────────────── audit ─────────────────────────────

const probeCache = new Map<string, ProbeInfo>();

export async function runAudit(opts: { quiet?: boolean } = {}) {
  if (getState().auditRunning) return;
  const tabId = requireTab();
  setState({ auditRunning: true, auditError: null });
  try {
    await ensureContent(tabId);
    const raw = await callPage(tabId, 'page:collect', { kinds: ALL_KINDS });
    let snapshot = raw as PageSnapshot;

    const wanted = urlsToProbe(snapshot).filter((u) => !probeCache.has(u));
    if (wanted.length) {
      const probes = await callBg('bg:probe', { urls: wanted }).catch(() => ({}));
      Object.entries(probes).forEach(([u, p]) => probeCache.set(u, p));
    }
    snapshot = applyProbes(snapshot, Object.fromEntries(probeCache));
    const emu = getState().emulation;
    if (emu.active && emu.width && emu.height) {
      snapshot = { ...snapshot, viewport: { ...snapshot.viewport, width: emu.width, height: emu.height } };
    }

    const audit = buildAudit(snapshot, !!raw.truncated);
    setState((s) => ({ audits: { ...s.audits, [tabId]: audit }, vitals: snapshot.vitals }));
    if (!opts.quiet) toast(`Audit complete: ${audit.findings.length} findings`, 'success');
    // Re-apply the highlight so it follows the (possibly changed) elements.
    const { highlightedId } = getState();
    const f = audit.findings.find((x) => x.id === highlightedId);
    if (f) void highlightFinding(f, { scroll: false });
  } catch (e) {
    setState({ auditError: errorMessage(e) });
    if (!opts.quiet) toast(errorMessage(e), 'error');
  } finally {
    setState({ auditRunning: false });
  }
}

// ───────────────────────────── highlight & fixes ─────────────────────────────

export async function highlightFinding(f: EnrichedFinding, opts: { scroll?: boolean } = {}) {
  const tabId = requireTab();
  if (!f.selectors?.length) return;
  const { matched } = await callPage(tabId, 'highlight:set', { selectors: f.selectors, severity: f.severity, scroll: opts.scroll ?? true });
  setState({ highlightedId: f.id });
  if (!matched) toast('Those elements are no longer on the page.', 'info');
}

export async function highlightSelectors(selectors: string[], severity: Severity = 'warning') {
  const tabId = requireTab();
  const { matched } = await callPage(tabId, 'highlight:set', { selectors, severity, scroll: true });
  if (!matched) toast('Those elements are no longer on the page.', 'info');
}

export async function clearHighlight() {
  const tabId = getState().tab.id;
  setState({ highlightedId: null });
  if (tabId != null) await callPage(tabId, 'highlight:clear').catch(() => undefined);
}

export async function applyFix(f: EnrichedFinding) {
  const tabId = requireTab();
  if (!f.fix) return;
  const s = getState();
  if (!currentBaseline(s)) {
    const audit = currentAudit(s);
    if (audit) setState((st) => ({ baselines: { ...st.baselines, [tabId]: audit } }));
  }
  await callPage(tabId, 'fix:apply', { id: f.id, css: f.fix.css, label: f.fix.label });
  setState((st) => ({ fixes: { ...st.fixes, [f.id]: { id: f.id, ruleId: f.ruleId, label: f.fix!.label, css: f.fix!.css, findingId: f.id } } }));
  await runAudit({ quiet: true });
}

export async function revertFix(id: string) {
  const tabId = requireTab();
  await callPage(tabId, 'fix:remove', { id });
  setState((st) => {
    const { [id]: _removed, ...rest } = st.fixes;
    return { fixes: rest };
  });
  await runAudit({ quiet: true });
}

export async function clearFixes() {
  const tabId = requireTab();
  await callPage(tabId, 'fix:clear');
  setState({ fixes: {} });
  await runAudit({ quiet: true });
}

/** Applies hand-written CSS to the selected element. */
export async function applyCustomCss(selector: string, declarations: string, important: boolean) {
  const tabId = requireTab();
  const body = declarations
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => (important && !/!important/i.test(d) ? `${d} !important` : d))
    .join('; ');
  const css = `${selector} { ${body}; }`;
  const id = `custom:${selector}`;
  await callPage(tabId, 'fix:apply', { id, css, label: `Custom CSS on ${selector}` });
  setState((st) => ({ fixes: { ...st.fixes, [id]: { id, ruleId: 'custom', label: `Custom CSS on ${selector}`, css, findingId: null } } }));
}

// ───────────────────────────── inspector ─────────────────────────────

export async function togglePick() {
  const tabId = requireTab();
  const next = !getState().picking;
  const res = await callPage(tabId, 'inspect:pick', { on: next });
  setState({ picking: res.on });
}

export async function selectSelector(selector: string, opts: { all?: boolean; reveal?: boolean } = {}) {
  const tabId = requireTab();
  const described = await callPage(tabId, 'page:describe', { selector, all: opts.all });
  if (!described) {
    toast('That element is no longer on the page.', 'info');
    setState({ selection: null });
    return;
  }
  if (opts.reveal) await callPage(tabId, 'inspect:select', { selector });
  setState({
    selection: {
      selector: described.info.selector,
      info: described.info,
      rules: described.rules,
      inaccessibleSheets: described.inaccessibleSheets,
      allStyles: !!opts.all,
    },
  });
}

export async function navigateSelection(rel: 'parent' | 'child' | 'next' | 'prev') {
  const tabId = requireTab();
  const sel = getState().selection;
  if (!sel) return;
  const next = await callPage(tabId, 'page:relative', { selector: sel.selector, rel });
  if (next) await selectSelector(next.selector);
}

export async function clearSelection() {
  const tabId = getState().tab.id;
  setState({ selection: null });
  if (tabId != null) await callPage(tabId, 'inspect:select', { selector: null }).catch(() => undefined);
}

// ───────────────────────────── performance ─────────────────────────────

export async function refreshVitals() {
  const tabId = requireTab();
  setState({ vitals: await callPage(tabId, 'page:vitals') });
}

/** Reloads the page and lets the content script (document_start) measure it from scratch. */
export async function reloadAndMeasure() {
  const tabId = requireTab();
  setState({ measuring: true });
  await callBg('bg:reload', { tabId, bypassCache: false });
  // setTarget runs on the 'complete' event; poll until the load event has been recorded.
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const t = getState().tab;
    if (t.status !== 'ready') continue;
    const v = await callPage(tabId, 'page:vitals').catch(() => null);
    if (v) {
      setState({ vitals: v });
      if (v.load != null && v.lcp) break;
    }
  }
  setState({ measuring: false });
  await runAudit({ quiet: true });
}

// ───────────────────────────── responsive lab ─────────────────────────────

export async function applyEmulation(p: { label: string; width: number; height: number; mobile: boolean }) {
  const tabId = requireTab();
  const state = await callBg('bg:emulate', { tabId, width: p.width, height: p.height, mobile: p.mobile });
  setState({ emulation: { ...state, label: p.label } });
  await sleep(300);
}

export async function resetEmulation() {
  const tabId = requireTab();
  const state = await callBg('bg:emulate-clear', { tabId });
  setState({ emulation: state });
}

export async function testViewport(p: { label: string; width: number; height: number; mobile: boolean }) {
  const tabId = requireTab();
  setState({ testing: p.label });
  try {
    await applyEmulation(p);
    await sleep(250);
    const snap = await callPage(tabId, 'page:collect', { kinds: ['meta', 'overflow', 'css'] });
    // In mobile emulation Chrome widens the layout viewport to fit overflowing content,
    // so innerWidth is not the emulated width. Report what was requested.
    const viewport = { ...snap.viewport!, width: p.width, height: p.height };
    const result = summarizeViewportTest(p.label, { meta: snap.meta!, viewport, overflow: snap.overflow!, css: snap.css });
    setState((s) => ({
      viewportTests: [...s.viewportTests.filter((r) => !(r.label === result.label && r.width === result.width)), result].sort((a, b) => a.width - b.width),
    }));
    return result;
  } finally {
    setState({ testing: null });
  }
}

export async function testAllViewports() {
  const before = getState().emulation;
  for (const preset of DEVICE_PRESETS) await testViewport(preset);
  if (before.active && before.width && before.height) {
    await applyEmulation({ label: before.label ?? 'Custom', width: before.width, height: before.height, mobile: !!before.mobile });
  } else {
    await resetEmulation();
  }
}

export function presetOf(label: string): DevicePreset | undefined {
  return DEVICE_PRESETS.find((p) => p.label === label);
}

// ───────────────────────────── screenshots ─────────────────────────────

export async function reloadShots() {
  setState({ screenshots: await listScreenshots() });
}

export async function takeScreenshot(opts: { type: ShotType; selector?: string; keepHighlight?: boolean; label?: string }) {
  const tabId = requireTab();
  const { settings, selection } = getState();
  const selector = opts.selector ?? selection?.selector;
  if (opts.type === 'element' && !selector) {
    toast('Select an element first (Inspect → Pick element).', 'info');
    return;
  }
  setState({ shotBusy: { type: opts.type, done: 0, total: opts.type === 'viewport' ? 1 : 0 } });
  try {
    await ensureContent(tabId);
    const { id } = await callBg('bg:capture', {
      tabId,
      type: opts.type,
      format: settings.format,
      quality: settings.quality / 100,
      selector,
      keepHighlight: opts.keepHighlight,
      label: opts.label,
    });
    await reloadShots();
    setState({ lastShotId: id });
    const shot = getState().screenshots.find((s) => s.id === id);
    toast(`Screenshot captured${shot ? ` — ${shot.width} × ${shot.height}` : ''}`, 'success', {
      label: 'Open',
      run: () => navigate('screenshots'),
    });
    shot?.warnings.forEach((w) => toast(w, 'info'));
  } catch (e) {
    toast(errorMessage(e), 'error');
  } finally {
    setState({ shotBusy: null });
  }
}

/** Highlights a finding's elements and captures the viewport with the highlight visible. */
export async function screenshotFinding(f: EnrichedFinding) {
  await highlightFinding(f, { scroll: true });
  await sleep(350);
  await takeScreenshot({ type: 'viewport', keepHighlight: true, label: f.title });
}

export async function removeShot(id: string) {
  await deleteScreenshot(id);
  await reloadShots();
}

export async function removeAllShots() {
  await clearScreenshots();
  await reloadShots();
}

// ───────────────────────────── export ─────────────────────────────

export function exportMarkdown(): string | null {
  const audit = currentAudit(getState());
  if (!audit) return null;
  return toMarkdown({
    url: audit.url,
    title: audit.title,
    takenAt: audit.takenAt,
    viewport: { width: audit.snapshot.viewport.width, height: audit.snapshot.viewport.height },
    vitals: audit.snapshot.vitals,
    findings: audit.findings,
  });
}

export function downloadAudit(kind: 'md' | 'json') {
  const audit = currentAudit(getState());
  if (!audit) return;
  const host = (() => {
    try {
      return new URL(audit.url).hostname.replace(/[^a-z0-9]+/gi, '-');
    } catch {
      return 'page';
    }
  })();
  if (kind === 'md') {
    downloadBlob(new Blob([exportMarkdown() ?? ''], { type: 'text/markdown' }), `${host}-audit.md`);
  } else {
    const { snapshot: _snapshot, ...rest } = audit;
    downloadBlob(new Blob([JSON.stringify({ ...rest, viewport: audit.snapshot.viewport, vitals: audit.snapshot.vitals }, null, 2)], { type: 'application/json' }), `${host}-audit.json`);
  }
}
