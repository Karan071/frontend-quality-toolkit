import type { DevicePreset } from '@ftk/responsive-analyzer';

/**
 * The simulator shows the page in an <iframe> sized to the device. Two things stop that from
 * behaving like a real device, and both are fixed with session-scoped declarativeNetRequest rules
 * that apply only to this simulator tab (never to normal browsing):
 *   1. X-Frame-Options / Content-Security-Policy headers that forbid framing.
 *   2. The desktop User-Agent, so servers that sniff it send the mobile or tablet site.
 */

// Rule ids must fit in 32 bits and tab ids can be huge, so each simulator page picks its own pair.
const RULE_BASE = 1 + Math.floor(Math.random() * 1_000_000_000);

function chromeMajor(): string {
  return /Chrome\/(\d+)/.exec(navigator.userAgent)?.[1] ?? '130';
}

/** A representative UA for the device, or null to keep the browser's own (desktops, TVs). */
export function userAgentFor(p: DevicePreset): string | null {
  if (!p.mobile) return null;
  const tablet = p.category === 'tablet';
  if (p.brand === 'Apple') {
    return tablet
      ? 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
      : 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  }
  return `Mozilla/5.0 (Linux; Android 14; ${p.label.replace(/[^\w .+-]/g, '')}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor()}.0.0.0 ${tablet ? '' : 'Mobile '}Safari/537.36`;
}

export type NetworkResult = { ok: true; userAgent: string | null } | { ok: false; error: string };

const RESPONSE_HEADERS = ['x-frame-options', 'content-security-policy', 'content-security-policy-report-only'];
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function applyNetworkRules(device: DevicePreset): Promise<NetworkResult> {
  const tab = await chrome.tabs.getCurrent().catch(() => undefined);
  if (tab?.id == null) return { ok: false, error: 'Could not identify this tab.' };
  const base = RULE_BASE;
  const scope = { tabIds: [tab.id] };
  const ua = userAgentFor(device);

  const frameRule: chrome.declarativeNetRequest.Rule = {
    id: base,
    priority: 1,
    action: {
      type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
      responseHeaders: RESPONSE_HEADERS.map((header) => ({ header, operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation })),
    },
    condition: { ...scope, resourceTypes: ['sub_frame' as chrome.declarativeNetRequest.ResourceType] },
  };
  const uaRule = (withClientHints: boolean): chrome.declarativeNetRequest.Rule => ({
    id: base + 1,
    priority: 1,
    action: {
      type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
      requestHeaders: [
        { header: 'user-agent', operation: 'set' as chrome.declarativeNetRequest.HeaderOperation, value: ua! },
        ...(withClientHints ? [{ header: 'sec-ch-ua-mobile', operation: 'set' as chrome.declarativeNetRequest.HeaderOperation, value: '?1' }] : []),
      ],
    },
    condition: {
      ...scope,
      // Everything the framed page loads, not only the document, so API calls see the same device.
      resourceTypes: ['sub_frame', 'xmlhttprequest', 'script', 'stylesheet', 'image', 'font', 'media', 'other'] as chrome.declarativeNetRequest.ResourceType[],
    },
  });

  const removeRuleIds = [base, base + 1];
  try {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules: ua ? [frameRule, uaRule(true)] : [frameRule] });
  } catch (first) {
    try {
      // Some Chrome versions reject Sec-CH-* edits; the UA header alone still gets most sites to switch layout.
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules: ua ? [frameRule, uaRule(false)] : [frameRule] });
    } catch (e) {
      return { ok: false, error: msg(e) || msg(first) };
    }
  }
  return { ok: true, userAgent: ua };
}

export async function clearNetworkRules(): Promise<void> {
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [RULE_BASE, RULE_BASE + 1] }).catch(() => undefined);
}
