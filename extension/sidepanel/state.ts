import { useSyncExternalStore } from 'react';
import type { VitalsSnapshot } from '@ftk/audit-core';
import type { ElementInfo, MatchedRule } from '@ftk/dom-analyzer';
import type { ViewportTestResult } from '@ftk/responsive-analyzer';
import type { ScreenshotRecord, ShotFormat, ShotType } from '@ftk/screenshot-engine';
import type { EmulationState } from '../shared/messages';
import type { AuditResult } from '../shared/audit';

export type RouteId =
  | 'overview'
  | 'inspect'
  | 'responsive'
  | 'performance'
  | 'images'
  | 'bundles'
  | 'accessibility'
  | 'uxui'
  | 'screenshots';

export const ROUTES: { id: RouteId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'inspect', label: 'Inspect' },
  { id: 'responsive', label: 'Responsive' },
  { id: 'performance', label: 'Performance' },
  { id: 'images', label: 'Images' },
  { id: 'bundles', label: 'Bundles' },
  { id: 'accessibility', label: 'Accessibility' },
  { id: 'uxui', label: 'UI / UX' },
  { id: 'screenshots', label: 'Screenshots' },
];

export interface TabInfo {
  id: number | null;
  url: string;
  title: string;
  status: 'none' | 'loading' | 'ready' | 'restricted';
}

export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  theme: Theme;
  format: ShotFormat;
  /** 10–100. */
  quality: number;
}

export interface Selection {
  selector: string;
  info: ElementInfo;
  rules: MatchedRule[];
  inaccessibleSheets: number;
  allStyles: boolean;
}

export interface AppliedFix {
  id: string;
  ruleId: string;
  label: string;
  css: string;
  /** Finding id this fix was created from, or null for hand-written CSS. */
  findingId: string | null;
}

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'error';
  action?: { label: string; run: () => void };
}

export interface EmulationView extends EmulationState {
  label?: string;
}

export interface AppState {
  ready: boolean;
  tab: TabInfo;
  route: RouteId;
  settings: Settings;

  audits: Record<number, AuditResult>;
  baselines: Record<number, AuditResult>;
  auditRunning: boolean;
  auditError: string | null;
  focusFinding: string | null;
  highlightedId: string | null;

  fixes: Record<string, AppliedFix>;

  selection: Selection | null;
  picking: boolean;

  vitals: VitalsSnapshot | null;
  measuring: boolean;

  emulation: EmulationView;
  viewportTests: ViewportTestResult[];
  testing: string | null;

  screenshots: ScreenshotRecord[];
  lastShotId: string | null;
  shotBusy: { type: ShotType; done: number; total: number } | null;

  toasts: Toast[];
}

export const initialState: AppState = {
  ready: false,
  tab: { id: null, url: '', title: '', status: 'none' },
  route: 'overview',
  settings: { theme: 'system', format: 'png', quality: 80 },
  audits: {},
  baselines: {},
  auditRunning: false,
  auditError: null,
  focusFinding: null,
  highlightedId: null,
  fixes: {},
  selection: null,
  picking: false,
  vitals: null,
  measuring: false,
  emulation: { active: false },
  viewportTests: [],
  testing: null,
  screenshots: [],
  lastShotId: null,
  shotBusy: null,
  toasts: [],
};

type Listener = () => void;

let state: AppState = initialState;
const listeners = new Set<Listener>();

export const getState = () => state;

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  listeners.forEach((l) => l());
}

const subscribe = (l: Listener) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Subscribes a component to the whole app state; the app is small enough that this is fine. */
export function useApp(): AppState {
  return useSyncExternalStore(subscribe, getState);
}

/** Same document for our purposes: ignores hash and query changes. */
function samePage(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.origin === ub.origin && ua.pathname === ub.pathname;
  } catch {
    return a === b;
  }
}

/** The audit for the current tab, if it still matches the tab's URL. */
export function currentAudit(s: AppState): AuditResult | null {
  if (s.tab.id == null) return null;
  const a = s.audits[s.tab.id];
  return a && samePage(a.url, s.tab.url) ? a : null;
}

export function currentBaseline(s: AppState): AuditResult | null {
  return s.tab.id == null ? null : (s.baselines[s.tab.id] ?? null);
}
