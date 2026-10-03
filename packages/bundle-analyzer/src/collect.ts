import type { ResourceSample, ScriptSample } from '@ftk/audit-core';
import { uniqueSelector } from '@ftk/dom-analyzer/collect';
import { isThirdParty, resourceTypeOf } from './index';

const MAX_RESOURCES = 800;

export function collectResources(): ResourceSample[] {
  const pageHost = location.host;
  const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  const out: ResourceSample[] = [];
  for (const e of entries.slice(0, MAX_RESOURCES)) {
    if (e.name.startsWith('data:') || e.name.startsWith('blob:') || e.name.startsWith('chrome-extension:')) continue;
    let host = '';
    try {
      host = new URL(e.name).host;
    } catch {
      continue;
    }
    out.push({
      url: e.name,
      type: resourceTypeOf(e.name, e.initiatorType),
      host,
      thirdParty: isThirdParty(host, pageHost),
      transferSize: e.transferSize,
      encodedSize: e.encodedBodySize,
      decodedSize: e.decodedBodySize,
      duration: e.duration,
      startTime: e.startTime,
      protocol: e.nextHopProtocol,
      renderBlocking: (e as PerformanceResourceTiming & { renderBlockingStatus?: string }).renderBlockingStatus === 'blocking',
      sizeKnown: e.transferSize > 0 || e.encodedBodySize > 0 || e.decodedBodySize > 0,
    });
  }
  return out;
}

export function collectScripts(): ScriptSample[] {
  return Array.from(document.querySelectorAll('script'))
    .filter((s) => !s.id.startsWith('__ftk'))
    .map((s) => ({
      src: s.src || null,
      inlineBytes: s.src ? 0 : (s.textContent?.length ?? 0),
      // The property is also true for script-inserted scripts, which never block parsing.
      async: s.async,
      defer: s.defer,
      module: s.type === 'module',
      inHead: !!s.closest('head'),
      selector: uniqueSelector(s),
    }));
}
