import { deltaE, makeFinding, parseColor, plural, rgbToHsl } from '@ftk/audit-core';
import type { ColorUse, Finding, HSL } from '@ftk/audit-core';

export type Scheme =
  | 'neutral'
  | 'monochromatic'
  | 'analogous'
  | 'complementary'
  | 'split-complementary'
  | 'triadic'
  | 'tetradic'
  | 'multi-hue';

export interface Swatch {
  hex: string;
  count: number;
  roles: ColorUse['role'][];
  hsl: HSL;
  neutral: boolean;
}

export interface PaletteSummary {
  swatches: Swatch[];
  /** Distinct colours after merging perceptually identical ones (ΔE < 5). */
  distinct: number;
  dominantHues: number[];
  scheme: Scheme;
  description: string;
  averageSaturation: number;
}

const isNeutral = (hsl: HSL) => hsl.s < 0.12 || hsl.l < 0.06 || hsl.l > 0.96;

const hueDistance = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

export function classifyHarmony(hues: number[]): Scheme {
  const n = hues.length;
  if (n === 0) return 'neutral';
  if (n === 1) return 'monochromatic';
  const dists = hues.flatMap((a, i) => hues.slice(i + 1).map((b) => hueDistance(a, b)));
  const maxD = Math.max(...dists);
  if (maxD <= 60) return 'analogous';
  if (n === 2) return maxD >= 150 ? 'complementary' : 'multi-hue';
  if (n === 3) {
    if (maxD <= 90) return 'analogous';
    const near = (d: number, target: number) => Math.abs(d - target) <= 30;
    if (dists.every((d) => near(d, 120))) return 'triadic';
    // One hue ~150-180° from two neighbours that sit close together.
    if (dists.some((d) => d <= 60) && dists.filter((d) => d >= 130).length >= 2) return 'split-complementary';
    return 'multi-hue';
  }
  if (n === 4) {
    const sorted = [...hues].sort((a, b) => a - b);
    const gaps = sorted.map((h, i) => (sorted[(i + 1) % 4] - h + 360) % 360);
    if (gaps.every((g) => Math.abs(g - 90) <= 35)) return 'tetradic';
  }
  return 'multi-hue';
}

const DESCRIPTIONS: Record<Scheme, string> = {
  neutral: 'Mostly neutral — no strong accent hue.',
  monochromatic: 'One accent hue with neutrals — cohesive and easy to maintain.',
  analogous: 'Neighbouring hues — harmonious, low-contrast between accents.',
  complementary: 'Two opposing hues — high energy; keep one dominant.',
  'split-complementary': 'A base hue plus two flanking its opposite — vivid but balanced.',
  triadic: 'Three evenly spaced hues — playful; needs strict role discipline.',
  tetradic: 'Four hues in two complementary pairs — rich but hard to balance.',
  'multi-hue': 'Several unrelated hues — risks looking inconsistent.',
};

export function analyzePalette(colors: ColorUse[]): PaletteSummary {
  const byHex = new Map<string, Swatch>();
  for (const c of colors) {
    const rgba = parseColor(c.value);
    if (!rgba || rgba.a < 0.05) continue;
    const hex = c.value.length > 7 ? c.value.slice(0, 7) : c.value;
    const sw = byHex.get(hex);
    if (sw) {
      sw.count += c.count;
      if (!sw.roles.includes(c.role)) sw.roles.push(c.role);
    } else {
      const hsl = rgbToHsl(rgba);
      byHex.set(hex, { hex, count: c.count, roles: [c.role], hsl, neutral: isNeutral(hsl) });
    }
  }
  const swatches = [...byHex.values()].sort((a, b) => b.count - a.count);

  // Merge perceptually identical colours for the "distinct" count.
  const reps: Swatch[] = [];
  for (const s of swatches) {
    const a = parseColor(s.hex)!;
    if (!reps.some((r) => deltaE(a, parseColor(r.hex)!) < 5)) reps.push(s);
  }

  // Hue histogram of chromatic colours, weighted by usage.
  const chromatic = swatches.filter((s) => !s.neutral);
  const total = chromatic.reduce((n, s) => n + s.count, 0);
  const bins = new Array<number>(12).fill(0);
  chromatic.forEach((s) => (bins[Math.floor(s.hsl.h / 30) % 12] += s.count));
  const hues: number[] = [];
  if (total > 0) {
    // Merge adjacent significant bins into one hue family.
    const sig = bins.map((w) => w / total >= 0.08);
    const seen = new Array<boolean>(12).fill(false);
    for (let i = 0; i < 12; i++) {
      if (!sig[i] || seen[i]) continue;
      let weight = 0;
      let sum = 0;
      let j = i;
      while (sig[j % 12] && !seen[j % 12] && j < i + 12) {
        seen[j % 12] = true;
        weight += bins[j % 12];
        sum += (j % 12) * 30 * bins[j % 12] + 15 * bins[j % 12];
        j++;
      }
      hues.push(Math.round(sum / weight) % 360);
    }
  }
  const scheme = classifyHarmony(hues);
  const avgSat = chromatic.length ? chromatic.reduce((n, s) => n + s.hsl.s, 0) / chromatic.length : 0;
  return {
    swatches: swatches.slice(0, 40),
    distinct: reps.length,
    dominantHues: hues,
    scheme,
    description: DESCRIPTIONS[scheme],
    averageSaturation: avgSat,
  };
}

export function analyzeColors(colors: ColorUse[]): Finding[] {
  const out: Finding[] = [];
  const palette = analyzePalette(colors);

  if (palette.distinct > 24) {
    out.push(
      makeFinding({
        ruleId: 'ux.color-sprawl',
        category: 'uxui',
        severity: palette.distinct > 40 ? 'warning' : 'info',
        title: `${palette.distinct} distinct colours in use`,
        message: 'A large palette usually means one-off values instead of design tokens. Aim for a small set of named roles plus tints.',
        evidence: { distinct: palette.distinct, raw: palette.swatches.length },
        key: 'color-sprawl',
      }),
    );
  }

  const used = palette.swatches.filter((s) => s.count >= 2);
  const pairs: [string, string][] = [];
  for (let i = 0; i < used.length && pairs.length < 30; i++) {
    for (let j = i + 1; j < used.length; j++) {
      const d = deltaE(parseColor(used[i].hex)!, parseColor(used[j].hex)!);
      if (d > 0 && d < 3) pairs.push([used[i].hex, used[j].hex]);
    }
  }
  if (pairs.length >= 3) {
    out.push(
      makeFinding({
        ruleId: 'ux.near-duplicate-colors',
        category: 'uxui',
        severity: 'info',
        title: `${plural(pairs.length, 'near-duplicate colour pair')}`,
        message: `Colours such as ${pairs[0][0]} and ${pairs[0][1]} are visually indistinguishable but defined separately.`,
        evidence: { pairs: pairs.length, example: `${pairs[0][0]} / ${pairs[0][1]}` },
        key: 'near-dupes',
      }),
    );
  }

  if (palette.dominantHues.length > 4) {
    out.push(
      makeFinding({
        ruleId: 'ux.many-hues',
        category: 'uxui',
        severity: 'info',
        title: `${palette.dominantHues.length} competing hue families`,
        message: `${palette.description} Pick one primary accent and derive the rest.`,
        evidence: { hues: palette.dominantHues.join(', ') },
        key: 'many-hues',
      }),
    );
  }
  return out;
}
