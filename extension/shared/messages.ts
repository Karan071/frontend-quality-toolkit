import type { CollectKind, PageSnapshot, ProbeInfo, Severity, VitalsSnapshot, ViewportInfo } from '@ftk/audit-core';
import type { ElementInfo, MatchedRule } from '@ftk/dom-analyzer';
import type { AssetSample } from '@ftk/asset-extractor';
import type { CaptureRequest, ElementTarget, PrepareInfo } from '@ftk/screenshot-engine';

/** Panel → content script. Sent with chrome.tabs.sendMessage. */
export interface PageRequests {
  'page:ping': { req: Record<string, never>; res: { url: string; title: string } };
  'page:collect': { req: { kinds: CollectKind[] }; res: Partial<PageSnapshot> & { truncated?: boolean } };
  'page:vitals': { req: Record<string, never>; res: VitalsSnapshot };
  'page:assets': { req: Record<string, never>; res: { assets: AssetSample[]; truncated: boolean } };
  'page:viewport': { req: Record<string, never>; res: ViewportInfo };
  'page:describe': {
    req: { selector: string; all?: boolean };
    res: { info: ElementInfo; rules: MatchedRule[]; inaccessibleSheets: number } | null;
  };
  'page:relative': { req: { selector: string; rel: 'parent' | 'child' | 'next' | 'prev' }; res: { selector: string } | null };
  'inspect:pick': { req: { on: boolean }; res: { on: boolean } };
  'inspect:select': { req: { selector: string | null }; res: { ok: boolean } };
  'highlight:set': { req: { selectors: string[]; severity?: Severity; scroll?: boolean }; res: { matched: number } };
  'highlight:clear': { req: Record<string, never>; res: Record<string, never> };
  'fix:apply': { req: { id: string; css: string; label?: string }; res: { count: number } };
  'fix:remove': { req: { id: string }; res: { count: number } };
  'fix:clear': { req: Record<string, never>; res: { count: number } };
  'fix:list': { req: Record<string, never>; res: { fixes: { id: string; label?: string; css: string }[] } };
  'shot:prepare': { req: { mode: CaptureRequest['type']; keepHighlight: boolean }; res: PrepareInfo };
  'shot:warmup': { req: Record<string, never>; res: { width: number; height: number } };
  'shot:scroll': { req: { x: number; y: number; hide: 'none' | 'bottom' | 'top' | 'all' }; res: { x: number; y: number } };
  'shot:element': { req: { selector: string }; res: ElementTarget | null };
  'shot:restore': { req: Record<string, never>; res: Record<string, never> };
}

export interface EmulationState {
  active: boolean;
  width?: number;
  height?: number;
  mobile?: boolean;
  dpr?: number;
}

/** Panel → service worker. Sent with chrome.runtime.sendMessage. */
export interface BackgroundRequests {
  'bg:probe': { req: { urls: string[]; pageUrl?: string }; res: Record<string, ProbeInfo> };
  'bg:fetch-css': { req: { urls: string[]; pageUrl?: string }; res: Record<string, string> };
  'bg:emulate': { req: { tabId: number; width: number; height: number; mobile: boolean; dpr?: number }; res: EmulationState };
  'bg:emulate-clear': { req: { tabId: number }; res: EmulationState };
  'bg:emulation-state': { req: { tabId: number }; res: EmulationState };
  'bg:capture': { req: CaptureRequest; res: { id: string; ids: string[] } };
  'bg:reload': { req: { tabId: number; bypassCache?: boolean }; res: Record<string, never> };
  'bg:cleanup': { req: { tabId: number }; res: Record<string, never> };
}

/** Fire-and-forget events broadcast to every extension page. */
export interface BroadcastEvents {
  'evt:picked': { tabId?: number; selector: string };
  'evt:pick-ended': { tabId?: number };
  'evt:vitals': { tabId?: number; vitals: VitalsSnapshot };
  'evt:shot-progress': { tabId: number; done: number; total: number };
  'evt:emulation': { tabId: number; state: EmulationState };
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export type PageType = keyof PageRequests;
export type BackgroundType = keyof BackgroundRequests;
export type EventType = keyof BroadcastEvents;

export const PANEL_PORT = 'ftk-panel';

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
