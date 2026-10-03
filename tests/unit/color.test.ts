import { describe, expect, it } from 'vitest';
import { composite, contrastRatio, deltaE, parseColor, suggestForeground, toHex } from '@ftk/audit-core';

const c = (s: string) => parseColor(s)!;

describe('parseColor', () => {
  it('parses hex, rgb, rgba and space-separated syntax', () => {
    expect(c('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(c('#336699')).toEqual({ r: 51, g: 102, b: 153, a: 1 });
    expect(c('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(c('rgba(10, 20, 30, 0.5)').a).toBe(0.5);
    expect(c('rgb(10 20 30 / 25%)').a).toBeCloseTo(0.25);
    expect(c('transparent').a).toBe(0);
  });
  it('returns null for things it cannot parse', () => {
    expect(parseColor('oklch(0.5 0.1 200)')).toBeNull();
    expect(parseColor('')).toBeNull();
    expect(parseColor(null)).toBeNull();
  });
});

describe('contrast', () => {
  it('matches known WCAG values', () => {
    expect(contrastRatio(c('#000'), c('#fff'))).toBeCloseTo(21, 1);
    expect(contrastRatio(c('#777'), c('#fff'))).toBeCloseTo(4.48, 1);
    expect(contrastRatio(c('#fff'), c('#fff'))).toBeCloseTo(1, 5);
  });
  it('is symmetric', () => {
    expect(contrastRatio(c('#123'), c('#eee'))).toBeCloseTo(contrastRatio(c('#eee'), c('#123')), 8);
  });
  it('suggestForeground reaches the target and keeps hue family', () => {
    const bg = c('#ffffff');
    const fixed = suggestForeground(c('#9aa5b1'), bg, 4.5);
    expect(contrastRatio(fixed, bg)).toBeGreaterThanOrEqual(4.5);
    expect(fixed.b).toBeGreaterThan(fixed.r - 1); // bluish grey stays bluish
    const dark = suggestForeground(c('#555555'), c('#111111'), 4.5);
    expect(contrastRatio(dark, c('#111111'))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('composite & misc', () => {
  it('blends translucent foreground over background', () => {
    const out = composite({ r: 0, g: 0, b: 0, a: 0.5 }, { r: 255, g: 255, b: 255, a: 1 });
    expect(Math.round(out.r)).toBe(128);
    expect(out.a).toBe(1);
  });
  it('toHex round-trips', () => {
    expect(toHex(c('rgb(1, 2, 3)'))).toBe('#010203');
  });
  it('deltaE is zero for identical colours and large for opposites', () => {
    expect(deltaE(c('#336699'), c('#336699'))).toBe(0);
    expect(deltaE(c('#000'), c('#fff'))).toBeGreaterThan(90);
    expect(deltaE(c('#333333'), c('#343434'))).toBeLessThan(3);
  });
});

import { cssEscape } from '@ftk/audit-core';
describe('cssEscape', () => {
  it('escapes selector-significant characters and leading digits', () => {
    expect(cssEscape('a.b:c')).toBe('a\\.b\\:c');
    expect(cssEscape('1abc')).toBe('\\31 abc');
    expect(cssEscape('héllo-ok_1')).toBe('héllo-ok_1');
  });
});
