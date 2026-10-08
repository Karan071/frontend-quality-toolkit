/**
 * Guards for URLs the extension fetches or loads on behalf of the inspected page.
 *
 * The extension has <all_urls> access and no CORS, so a hostile page that lists
 * http://127.0.0.1:2375/ or http://192.168.0.1/ as an image would otherwise make the user's
 * browser send requests into their local network. Only public hosts are fetched, unless the
 * page itself is on a private host (a dev server), where private targets are expected.
 */

function ipv4Octets(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  return octets.every((n) => n <= 255) ? octets : null;
}

function isPrivateIpv4([a, b]: number[]): boolean {
  return (
    a === 0 || // "this" network
    a === 10 ||
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224 // multicast and reserved
  );
}

function isPrivateIpv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === '::' || h === '::1') return true;
  if (/^f[cd]/.test(h)) return true; // unique local fc00::/7
  if (/^fe[89ab]/.test(h)) return true; // link-local fe80::/10
  // IPv4-mapped (::ffff:7f00:1 after URL normalisation, or ::ffff:127.0.0.1).
  const mapped = /^::ffff:(?:([0-9a-f]{1,4}):([0-9a-f]{1,4})|(\d+\.\d+\.\d+\.\d+))$/.exec(h);
  if (mapped) {
    if (mapped[3]) {
      const octets = ipv4Octets(mapped[3]);
      return !octets || isPrivateIpv4(octets);
    }
    const hi = parseInt(mapped[1], 16);
    const lo = parseInt(mapped[2], 16);
    return isPrivateIpv4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
  }
  return false;
}

/** True for loopback, LAN, link-local and intranet-style host names. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!host) return true;
  if (host.includes(':')) return isPrivateIpv6(host);
  const octets = ipv4Octets(host);
  if (octets) return isPrivateIpv4(octets);
  if (!host.includes('.')) return true; // single-label names resolve on the local network
  return /\.(localhost|local|localdomain|internal|intranet|lan|home|corp|private)$/.test(host);
}

function parse(url: string | undefined): URL | null {
  if (!url) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * Whether the extension may request `url` for the page at `pageUrl`.
 * Allows http(s) to public hosts, and private hosts only when the page is itself private.
 * `file:` is allowed only for pages that are themselves `file:` pages.
 */
export function isSafeFetchUrl(url: string, pageUrl?: string): boolean {
  const target = parse(url);
  if (!target) return false;
  const page = parse(pageUrl);
  if (target.protocol === 'file:') return page?.protocol === 'file:';
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;
  if (!isPrivateHost(target.hostname)) return true;
  if (page && page.hostname === target.hostname) return true;
  return !!page && (page.protocol === 'http:' || page.protocol === 'https:') && isPrivateHost(page.hostname);
}

/**
 * True when `value` is a plain CSS color and nothing else, so it is safe to use as an inline
 * style. Rejects url(), image-set(), var() chains with extra tokens and any trailing declarations
 * that would make the browser fetch a page-chosen address.
 */
export function isPlainColorValue(value: string): boolean {
  const v = value.trim();
  if (!v || v.length > 120) return false;
  if (/url\s*\(|image-set|image\(|element\(|expression|[;{}\\@]|\/\*/i.test(v)) return false;
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return true;
  if (/^[a-z]+$/i.test(v)) return true; // named colors, currentcolor, transparent
  // A single function call with a flat argument list, e.g. hsl(0 0% 0% / 50%) or color(srgb 1 0 0).
  return /^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(\s*[-+\w.%\s,/]*\)$/i.test(v);
}

/** Drops credentials, query string and fragment, which often carry tokens, from a URL shown or exported. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'file:') return url;
    u.username = '';
    u.password = '';
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}
