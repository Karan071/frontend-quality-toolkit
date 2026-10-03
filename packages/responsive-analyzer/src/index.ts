import { makeFinding, plural } from '@ftk/audit-core';
import type { Finding, OverflowData, PageMeta, ViewportInfo, CssData, TypographyData } from '@ftk/audit-core';

export type DeviceMode = 'mobile' | 'tablet' | 'desktop' | 'ultrawide' | 'tv';

export type DeviceCategory = 'phone' | 'tablet' | 'laptop' | 'desktop' | 'ultrawide' | 'tv';

export type DeviceBrand = 'Apple' | 'Samsung' | 'Google' | 'Microsoft';

/** How the front of the device is drawn in the simulator: what cuts into (or sits around) the screen. */
export type DeviceCutout = 'island' | 'notch' | 'punch' | 'home-button' | 'none';

export const CATEGORY_LABELS: Record<DeviceCategory, string> = {
  phone: 'Phones',
  tablet: 'Tablets',
  laptop: 'Laptops',
  desktop: 'Desktops',
  ultrawide: 'Ultrawide',
  tv: 'TVs',
};

export interface DevicePreset {
  id: string;
  label: string;
  /** CSS pixels in portrait/default orientation, i.e. what window.innerWidth/innerHeight report. */
  width: number;
  height: number;
  /** Device pixel ratio. 0 keeps the real one. */
  dpr: number;
  category: DeviceCategory;
  brand?: DeviceBrand;
  mode: DeviceMode;
  mobile: boolean;
  /** Typical physical diagonal, for the devices where size is the point. */
  inches?: number;
  note?: string;
  /** Front-camera / sensor style, for the simulator's device frame. Defaults by category, see cutoutFor. */
  cutout?: DeviceCutout;
}

/** Phones default to a punch-hole camera; everything else has no screen cutout. */
export function cutoutFor(p: Pick<DevicePreset, 'category' | 'cutout'>): DeviceCutout {
  return p.cutout ?? (p.category === 'phone' ? 'punch' : 'none');
}

const d = (
  id: string, label: string, width: number, height: number, dpr: number, category: DeviceCategory,
  extra: Partial<Pick<DevicePreset, 'inches' | 'note' | 'brand' | 'cutout'>> = {},
): DevicePreset => ({
  id, label, width, height, dpr, category, ...extra,
  mode: deviceModeFor(width, height),
  mobile: category === 'phone' || category === 'tablet',
});

/**
 * Viewport sizes in CSS pixels (Apple's published point dimensions for its devices). TVs and
 * signage are listed the way their browsers report them: most 4K TVs expose a 1920×1080 viewport
 * at 2× density; some expose the full 3840×2160. Individual models can differ — use Custom size
 * for an exact match.
 */
export const DEVICE_PRESETS: DevicePreset[] = [
  // ── phones ──
  d('fold', 'Galaxy Fold (folded)', 280, 653, 3, 'phone', { brand: 'Samsung', note: 'Narrowest common phone' }),
  d('fold5', 'Galaxy Z Fold 5 (folded)', 344, 882, 3, 'phone', { brand: 'Samsung' }),
  d('mobile-s', 'Small mobile', 320, 640, 2, 'phone'),
  d('iphone-se', 'iPhone SE', 375, 667, 2, 'phone', { brand: 'Apple', inches: 4.7, note: 'SE 2nd/3rd gen, 8', cutout: 'home-button' }),
  d('iphone-mini', 'iPhone 13 mini', 375, 812, 3, 'phone', { brand: 'Apple', inches: 5.4, note: 'also 12 mini, X, 11 Pro', cutout: 'notch' }),
  d('galaxy-s24', 'Galaxy S24', 360, 780, 3, 'phone', { brand: 'Samsung', inches: 6.2, note: 'also S25, S26' }),
  d('mobile', 'Mobile', 390, 844, 3, 'phone'),
  d('iphone-14', 'iPhone 14', 390, 844, 3, 'phone', { brand: 'Apple', inches: 6.1, note: 'also 12, 13, 13 Pro', cutout: 'notch' }),
  d('iphone-15', 'iPhone 15 / 16', 393, 852, 3, 'phone', { brand: 'Apple', inches: 6.1, note: 'also 14 Pro, 15 Pro', cutout: 'island' }),
  d('iphone-16-pro', 'iPhone 16 Pro', 402, 874, 3, 'phone', { brand: 'Apple', inches: 6.3, note: 'also 17, 17 Pro', cutout: 'island' }),
  d('pixel-8', 'Pixel 8', 412, 915, 2.625, 'phone', { brand: 'Google', inches: 6.2, note: 'also Pixel 7' }),
  d('galaxy-a51', 'Galaxy A51/A71', 412, 914, 2.625, 'phone', { brand: 'Samsung' }),
  d('iphone-plus', 'iPhone 14 Plus', 428, 926, 3, 'phone', { brand: 'Apple', inches: 6.7, note: 'also 12/13 Pro Max', cutout: 'notch' }),
  d('mobile-l', 'Large phone', 430, 932, 3, 'phone'),
  d('iphone-pro-max', 'iPhone 15 Pro Max / 16 Plus', 430, 932, 3, 'phone', { brand: 'Apple', inches: 6.7, note: 'also 14 Pro Max', cutout: 'island' }),
  d('iphone-16-pm', 'iPhone 16 Pro Max', 440, 956, 3, 'phone', { brand: 'Apple', inches: 6.9, note: 'also 17 Pro Max', cutout: 'island' }),
  d('galaxy-z-flip', 'Galaxy Z Flip 7', 360, 840, 3, 'phone', { brand: 'Samsung', inches: 6.9, note: 'unfolded' }),
  d('pixel-9', 'Pixel 9', 360, 808, 3, 'phone', { brand: 'Google', inches: 6.3 }),
  d('iphone-17e', 'iPhone 17e', 390, 844, 3, 'phone', { brand: 'Apple', inches: 6.1, cutout: 'notch' }),
  d('pixel-9-pro', 'Pixel 9 Pro', 427, 952, 3, 'phone', { brand: 'Google', inches: 6.3 }),
  d('iphone-air', 'iPhone Air', 420, 912, 3, 'phone', { brand: 'Apple', inches: 6.5, cutout: 'island' }),
  d('galaxy-s25-ultra', 'Galaxy S25 Ultra', 412, 891, 3.5, 'phone', { brand: 'Samsung', inches: 6.9, note: 'also S25+, S26 Ultra' }),
  d('oneplus-13', 'OnePlus 13', 412, 905, 3.5, 'phone', { inches: 6.8 }),
  d('pixel-9-pro-xl', 'Pixel 9 Pro XL', 448, 997, 3, 'phone', { brand: 'Google', inches: 6.8 }),
  d('surface-duo', 'Surface Duo', 540, 720, 2.5, 'phone', { brand: 'Microsoft', note: 'one screen', cutout: 'none' }),
  d('fold-open', 'Foldable (unfolded)', 884, 1104, 2, 'phone'),
  d('fold7-open', 'Galaxy Z Fold 7 (unfolded)', 984, 1092, 2, 'phone', { brand: 'Samsung', inches: 8 }),

  // ── tablets ──
  d('ipad-mini', 'iPad mini', 744, 1133, 2, 'tablet', { brand: 'Apple', inches: 8.3 }),
  d('tablet', 'Tablet', 768, 1024, 2, 'tablet'),
  d('ipad-9', 'iPad 10.2″', 810, 1080, 2, 'tablet', { brand: 'Apple', inches: 10.2, note: '7th–9th gen', cutout: 'home-button' }),
  d('ipad-10', 'iPad 10th gen / Air 11″', 820, 1180, 2, 'tablet', { brand: 'Apple', inches: 10.9 }),
  d('ipad-pro-11', 'iPad Pro 11″', 834, 1194, 2, 'tablet', { brand: 'Apple', inches: 11 }),
  d('ipad-pro-11-m4', 'iPad Pro 11″ (M4)', 834, 1210, 2, 'tablet', { brand: 'Apple', inches: 11 }),
  d('galaxy-tab-s9', 'Galaxy Tab S9', 800, 1280, 2, 'tablet', { brand: 'Samsung', inches: 11 }),
  d('kindle-fire', 'Kindle Fire HDX', 800, 1280, 2, 'tablet', { inches: 8.9 }),
  d('surface-pro', 'Surface Pro 7', 912, 1368, 2, 'tablet', { brand: 'Microsoft', inches: 12.3 }),
  d('tablet-land', 'Tablet landscape', 1024, 768, 2, 'tablet'),
  d('ipad-pro-13', 'iPad Pro 12.9″', 1024, 1366, 2, 'tablet', { brand: 'Apple', inches: 12.9, note: 'also Air 13″' }),
  d('ipad-pro-m4', 'iPad Pro 13″ (M4)', 1032, 1376, 2, 'tablet', { brand: 'Apple', inches: 13 }),

  // ── laptops ──
  d('laptop-hd', 'Laptop HD', 1366, 768, 1, 'laptop', { inches: 14 }),
  d('laptop', 'Laptop', 1280, 800, 2, 'laptop', { inches: 13 }),
  d('macbook-air-m1', 'MacBook Air 13″ (M1)', 1440, 900, 2, 'laptop', { brand: 'Apple', inches: 13.3 }),
  d('macbook-air-13', 'MacBook Air 13″ (M2/M3)', 1470, 956, 2, 'laptop', { brand: 'Apple', inches: 13.6 }),
  d('macbook-pro-14', 'MacBook Pro 14″', 1512, 982, 2, 'laptop', { brand: 'Apple', inches: 14.2 }),
  d('laptop-15', 'Laptop 15″', 1536, 864, 1.25, 'laptop', { inches: 15.6 }),
  d('macbook-air-15', 'MacBook Air 15″', 1710, 1107, 2, 'laptop', { brand: 'Apple', inches: 15.3 }),
  d('macbook-pro-16', 'MacBook Pro 16″', 1728, 1117, 2, 'laptop', { brand: 'Apple', inches: 16.2 }),

  // ── desktops ──
  d('desktop', 'Desktop', 1440, 900, 1, 'desktop'),
  d('hd-720', 'HD 720p', 1280, 720, 1, 'desktop', { note: 'small windows, older monitors' }),
  d('hd-plus', 'HD+ 900p', 1600, 900, 1, 'desktop', { inches: 20 }),
  d('fhd', 'Full HD 24″', 1920, 1080, 1, 'desktop', { inches: 24 }),
  d('wuxga', 'WUXGA 24″ (16:10)', 1920, 1200, 1, 'desktop', { inches: 24 }),
  d('imac-24', 'iMac 24″', 2240, 1260, 2, 'desktop', { brand: 'Apple', inches: 23.5, note: '4.5K' }),
  d('qhd', 'QHD 27″', 2560, 1440, 1, 'desktop', { inches: 27 }),
  d('studio-display', 'Studio Display 27″', 2560, 1440, 2, 'desktop', { brand: 'Apple', inches: 27, note: '5K' }),
  d('qhd-plus', 'QHD+ 30″ (16:10)', 2560, 1600, 1, 'desktop', { inches: 30 }),
  d('uhd-32', '4K monitor 32″', 3840, 2160, 1, 'desktop', { inches: 32 }),
  d('pro-display', 'Pro Display XDR 32″', 3008, 1692, 2, 'desktop', { brand: 'Apple', inches: 32, note: '6K' }),

  // ── ultrawide monitors ──
  d('uw-29', 'Ultrawide 29″', 2560, 1080, 1, 'ultrawide', { inches: 29, note: '21:9' }),
  d('uw-34', 'Ultrawide 34″', 3440, 1440, 1, 'ultrawide', { inches: 34, note: '21:9' }),
  d('uw-38', 'Ultrawide 38″', 3840, 1600, 1, 'ultrawide', { inches: 38, note: '24:10' }),
  d('uw-49', 'Super ultrawide 49″', 5120, 1440, 1, 'ultrawide', { inches: 49, note: '32:9' }),

  // ── TVs & signage ──
  d('tv-43-fhd', 'TV 43″ Full HD', 1920, 1080, 1, 'tv', { inches: 43 }),
  d('tv-50-4k', 'TV 50″ 4K', 1920, 1080, 2, 'tv', { inches: 50, note: '4K panel, 1080p CSS @2×' }),
  d('tv-55-fhd', 'TV 55″ Full HD', 1920, 1080, 1, 'tv', { inches: 55, note: '10-foot UI' }),
  d('tv-55-4k', 'TV 55″ 4K', 1920, 1080, 2, 'tv', { inches: 55, note: '4K panel, 1080p CSS @2×' }),
  d('tv-55-uw', 'Ultrawide TV 55″ (21:9)', 2560, 1080, 1, 'tv', { inches: 55, note: 'cinema-ratio TV / signage' }),
  d('tv-60-4k-scaled', 'TV 60″ 4K', 1920, 1080, 2, 'tv', { inches: 60, note: '4K panel, 1080p CSS @2×' }),
  d('tv-60-4k', 'TV 60″ 4K native', 3840, 2160, 1, 'tv', { inches: 60, note: 'Full 4K CSS pixels' }),
  d('tv-60-uw', 'Ultrawide TV 60″ (21:9)', 3440, 1440, 1, 'tv', { inches: 60, note: 'cinema-ratio TV / signage' }),
  d('tv-65-4k', 'TV 65″ 4K', 1920, 1080, 2, 'tv', { inches: 65, note: '4K panel, 1080p CSS @2×' }),
  d('tv-75-4k', 'TV 75″ 4K', 1920, 1080, 2, 'tv', { inches: 75, note: '4K panel, 1080p CSS @2×' }),
  d('apple-tv', 'Apple TV 4K', 1920, 1080, 2, 'tv', { brand: 'Apple', note: 'tvOS' }),
];

/** Phones and tablets can be rotated; desktops and TVs are fixed-orientation. */
export function orientPreset(p: DevicePreset, landscape: boolean): DevicePreset {
  if (!landscape || !p.mobile) return p;
  return { ...p, width: p.height, height: p.width, label: `${p.label} (landscape)` };
}

/** Physical pixel resolution of the screen. */
export function physicalSize(p: Pick<DevicePreset, 'width' | 'height' | 'dpr'>): { width: number; height: number } {
  return { width: Math.round(p.width * p.dpr), height: Math.round(p.height * p.dpr) };
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** 1920×1080 → "16:9"; awkward ratios fall back to a decimal like "2.17:1". */
export function aspectLabel(width: number, height: number): string {
  const g = gcd(Math.round(width), Math.round(height));
  const w = Math.round(width) / g;
  const h = Math.round(height) / g;
  if (w <= 32 && h <= 32) return `${w}:${h}`;
  const r = Math.max(width, height) / Math.min(width, height);
  return `${r.toFixed(2)}:1`;
}

/** Media query that matches exactly this viewport (handy for targeting it in CSS). */
export function mediaQueryFor(p: Pick<DevicePreset, 'width' | 'height'>): string {
  return `@media (width: ${p.width}px) and (height: ${p.height}px)`;
}

/** Everything about a device as copy-pasteable text. */
export function describeDevice(p: DevicePreset): string {
  const phys = physicalSize(p);
  return [
    `${p.label}${p.inches ? ` (${p.inches}″)` : ''}`,
    `CSS viewport: ${p.width} × ${p.height} px @${p.dpr}×`,
    `Physical: ${phys.width} × ${phys.height} px`,
    `Aspect: ${aspectLabel(p.width, p.height)}`,
    mediaQueryFor(p),
  ].join('\n');
}

/** One representative size per category: a fast first pass before "Test all". */
export const CORE_PRESET_IDS = ['mobile-s', 'mobile', 'tablet', 'laptop', 'desktop', 'qhd', 'uw-49', 'tv-55-4k'];

/**
 * Coarse class of a viewport. Aspect ratio matters: 3440×1440 is "ultrawide" while 2560×1440 is a
 * regular desktop, and a 3840-wide 16:9 viewport is a 4K/TV-class screen.
 */
export function deviceModeFor(width: number, height?: number): DeviceMode {
  if (width <= 480) return 'mobile';
  if (width <= 1024) return 'tablet';
  const aspect = height ? width / height : 1.6;
  if (aspect >= 2.2) return 'ultrawide';
  if (width >= 3200) return 'tv';
  return 'desktop';
}

export interface ResponsiveInput {
  meta: Pick<PageMeta, 'viewportMeta'>;
  viewport: Pick<ViewportInfo, 'width'>;
  overflow: OverflowData;
  css?: Pick<CssData, 'breakpoints' | 'stylesheets'>;
  /** Paragraph-like blocks, used to spot text that stretches across very wide screens. */
  blocks?: TypographyData['blocks'];
}

export function analyzeResponsive(input: ResponsiveInput): Finding[] {
  const out: Finding[] = [];
  const { meta, viewport, overflow } = input;

  if (!meta.viewportMeta) {
    out.push(
      makeFinding({
        ruleId: 'resp.no-viewport-meta',
        category: 'responsive',
        severity: 'error',
        title: 'Missing viewport meta tag',
        message: 'Mobile browsers will lay the page out at ~980px and scale it down.',
        key: 'viewport-meta',
      }),
    );
  } else {
    const content = meta.viewportMeta.toLowerCase().replace(/\s+/g, '');
    const fixed = /(^|,)width=(\d+)/.exec(content);
    if (fixed) {
      out.push(
        makeFinding({
          ruleId: 'resp.viewport-fixed-width',
          category: 'responsive',
          severity: 'warning',
          title: 'Viewport meta uses a fixed width',
          message: `width=${fixed[2]} prevents the layout from adapting to the device width.`,
          evidence: { content: meta.viewportMeta },
          key: 'viewport-fixed',
        }),
      );
    }
  }

  if (overflow.hasHorizontalScroll) {
    const extra = overflow.scrollWidth - overflow.clientWidth;
    const tags = [...new Set(overflow.culprits.map((c) => c.tag))].join(', ');
    out.push(
      makeFinding({
        ruleId: 'resp.horizontal-scroll',
        category: 'responsive',
        severity: viewport.width <= 768 ? 'error' : 'warning',
        title: `Horizontal scroll at ${viewport.width}px`,
        message: `Content is ${extra}px wider than the viewport${
          overflow.culpritCount ? ` — ${plural(overflow.culpritCount, 'element')} extend past the right edge` : ''
        }.`,
        selectors: overflow.culprits.map((c) => c.selector),
        count: overflow.culpritCount || undefined,
        evidence: {
          viewportWidth: viewport.width,
          scrollWidth: overflow.scrollWidth,
          clientWidth: overflow.clientWidth,
          tags,
        },
        key: `h-scroll:${viewport.width}`,
      }),
    );
  }

  // Wide screens: body text that runs edge to edge is unreadable (and TVs are read from 3 m away).
  if (input.blocks && viewport.width >= 1600) {
    const stretched = input.blocks.filter((b) => b.width >= viewport.width * 0.7 && b.charsPerLine > 100);
    if (stretched.length) {
      const widest = Math.max(...stretched.map((b) => b.width));
      out.push(
        makeFinding({
          ruleId: 'resp.stretched-content',
          category: 'responsive',
          severity: viewport.width >= 2400 ? 'warning' : 'info',
          title: `Text stretches ${widest}px across a ${viewport.width}px screen`,
          message: `${plural(stretched.length, 'text block')} ${stretched.length === 1 ? 'runs' : 'run'} at 100+ characters per line. Constrain the reading column on wide monitors and TVs.`,
          selectors: stretched.slice(0, 20).map((b) => b.selector),
          count: stretched.length,
          evidence: { viewportWidth: viewport.width, widestBlock: widest },
          fix: {
            label: 'Cap text at 75ch and centre it',
            css: stretched.slice(0, 15).map((b) => `${b.selector} { max-width: 75ch !important; margin-inline: auto !important; }`).join('\n'),
          },
          key: `stretched:${viewport.width}`,
        }),
      );
    }
  }

  if (input.css && input.css.breakpoints.length === 0 && input.css.stylesheets.some((s) => s.accessible || s.parsed)) {
    out.push(
      makeFinding({
        ruleId: 'resp.no-breakpoints',
        category: 'responsive',
        severity: 'info',
        title: 'No width-based media queries found',
        message:
          'The readable stylesheets contain no min-width / max-width @media rules. The layout may rely on fluid sizing alone, or breakpoints live in stylesheets that could not be read.',
        key: 'no-breakpoints',
      }),
    );
  }
  return out;
}

export interface ViewportTestResult {
  label: string;
  width: number;
  height: number;
  hasHorizontalScroll: boolean;
  scrollWidth: number;
  clientWidth: number;
  culpritCount: number;
  findings: Finding[];
}

export function summarizeViewportTest(
  label: string,
  input: ResponsiveInput & { viewport: ViewportInfo },
): ViewportTestResult {
  const findings = analyzeResponsive(input);
  return {
    label,
    width: input.viewport.width,
    height: input.viewport.height,
    hasHorizontalScroll: input.overflow.hasHorizontalScroll,
    scrollWidth: input.overflow.scrollWidth,
    clientWidth: input.overflow.clientWidth,
    culpritCount: input.overflow.culpritCount,
    findings,
  };
}
