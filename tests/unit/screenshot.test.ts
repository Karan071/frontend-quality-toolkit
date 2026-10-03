import { describe, expect, it } from 'vitest';
import { MAX_CANVAS_AREA, MAX_CANVAS_SIDE, fitScale, hostSlug, planParts, planTiles, screenshotName, selectorSlug } from '@ftk/screenshot-engine';
import type { Rect, Tile } from '@ftk/screenshot-engine';

const vp = { width: 400, height: 800 };

/** Every document pixel in the region is drawn exactly once. */
function coverage(tiles: Tile[], region: Rect) {
  const grid = new Map<string, number>();
  for (const t of tiles) {
    for (let y = Math.floor(t.draw.y); y < t.draw.y + t.draw.height; y += 10) {
      for (let x = Math.floor(t.draw.x); x < t.draw.x + t.draw.width; x += 10) {
        const k = `${x},${y}`;
        grid.set(k, (grid.get(k) ?? 0) + 1);
      }
    }
  }
  const missing: string[] = [];
  const doubled: string[] = [];
  for (let y = region.y; y < region.y + region.height; y += 10) {
    for (let x = region.x; x < region.x + region.width; x += 10) {
      const n = grid.get(`${x},${y}`) ?? 0;
      if (n === 0) missing.push(`${x},${y}`);
      if (n > 1) doubled.push(`${x},${y}`);
    }
  }
  return { missing, doubled };
}

describe('planTiles', () => {
  it('uses a single tile with nothing hidden when the page fits', () => {
    const tiles = planTiles({ x: 0, y: 0, width: 400, height: 600 }, vp, { width: 400, height: 800 });
    expect(tiles).toHaveLength(1);
    expect(tiles[0].hide).toBe('none');
    expect(tiles[0].draw).toEqual({ x: 0, y: 0, width: 400, height: 600 });
  });

  it('covers a tall page exactly once, with the last tile clamped to the bottom', () => {
    const region = { x: 0, y: 0, width: 400, height: 2500 };
    const tiles = planTiles(region, vp, { width: 400, height: 2500 });
    expect(tiles.map((t) => t.scrollY)).toEqual([0, 800, 1600, 1700]);
    expect(tiles.map((t) => t.hide)).toEqual(['bottom', 'all', 'all', 'top']);
    const { missing, doubled } = coverage(tiles, region);
    expect(missing).toEqual([]);
    expect(doubled).toEqual([]);
  });

  it('redraws a strip in the last tile so bottom-anchored fixed bars appear whole', () => {
    const region = { x: 0, y: 0, width: 400, height: 1000 };
    const tiles = planTiles(region, vp, { width: 400, height: 1000 }, 120);
    const last = tiles[tiles.length - 1];
    // Last scroll = 200, covers 200–1000. The bar occupies 880–1000, so the tile must own at least that.
    expect(last.scrollY).toBe(200);
    expect(last.draw.y + last.draw.height).toBe(1000);
    expect(last.draw.y).toBeLessThanOrEqual(880);

    // A shorter tail than the bar needs an overdraw into already-captured area.
    const short = planTiles({ x: 0, y: 0, width: 400, height: 850 }, vp, { width: 400, height: 850 }, 120);
    expect(short[short.length - 1].draw.y).toBe(850 - 120);
    expect(last.draw.y).toBeGreaterThanOrEqual(last.scrollY); // never reaches above what the tile shows
  });

  it('tiles horizontally for horizontal overflow and hides fixed elements outside column 0', () => {
    const region = { x: 0, y: 0, width: 1000, height: 600 };
    const tiles = planTiles(region, vp, { width: 1000, height: 600 });
    expect(tiles.map((t) => t.col)).toEqual([0, 1, 2]);
    expect(tiles.map((t) => t.hide)).toEqual(['none', 'all', 'all']);
    expect(coverage(tiles, region)).toEqual({ missing: [], doubled: [] });
  });

  it('handles an element region in the middle of a long page', () => {
    const region = { x: 100, y: 1200, width: 300, height: 1500 };
    const tiles = planTiles(region, vp, { width: 400, height: 5000 });
    expect(tiles[0].draw.y).toBe(1200);
    expect(coverage(tiles, region)).toEqual({ missing: [], doubled: [] });
  });
});

describe('fitScale', () => {
  it('leaves normal sizes alone', () => {
    expect(fitScale(1440, 6840, 2)).toBe(2);
  });
  it('shrinks to fit the canvas side and area limits', () => {
    const s = fitScale(1440, 20000, 2);
    expect(1440 * s).toBeLessThanOrEqual(MAX_CANVAS_SIDE);
    expect(20000 * s).toBeLessThanOrEqual(MAX_CANVAS_SIDE + 1);
    const t = fitScale(16000, 16000, 3);
    expect(16000 * 16000 * t * t).toBeLessThanOrEqual(MAX_CANVAS_AREA * 1.001);
  });
});

describe('naming', () => {
  it('follows the PRD examples', () => {
    expect(screenshotName({ url: 'https://example.com/x', type: 'viewport', format: 'png', width: 390, height: 844 })).toBe('example-com-viewport-390x844.png');
    expect(screenshotName({ url: 'https://www.example.com', type: 'fullpage', format: 'png', width: 1440, height: 6840 })).toBe('example-com-fullpage-1440x6840.png');
    expect(screenshotName({ url: 'https://example.com', type: 'element', format: 'png', width: 0, height: 0, selector: '.hero-card' })).toBe('example-com-element-hero-card.png');
  });
  it('uses .jpg for JPEG', () => {
    expect(screenshotName({ url: 'https://example.com', type: 'viewport', format: 'jpeg', width: 1, height: 2 })).toMatch(/\.jpg$/);
  });
  it('derives readable element slugs', () => {
    expect(selectorSlug('main > section.hero:nth-of-type(2) > div.hero-card.wide')).toBe('hero-card-wide');
    expect(selectorSlug('#checkout-form')).toBe('checkout-form');
    expect(selectorSlug('body > ul > li:nth-of-type(3)')).toBe('li');
    expect(selectorSlug(undefined)).toBe('element');
    expect(hostSlug('not a url')).toBe('page');
  });
});

describe('planParts', () => {
  it('keeps a normal page in one part at full resolution', () => {
    const plan = planParts({ x: 0, y: 0, width: 1440, height: 6840 }, 2);
    expect(plan.parts).toHaveLength(1);
    expect(plan.scale).toBe(2);
  });

  it('splits a very tall page into full-resolution parts instead of scaling it down', () => {
    const region = { x: 0, y: 0, width: 1280, height: 40000 };
    const plan = planParts(region, 2);
    expect(plan.scale).toBe(2);
    expect(plan.parts.length).toBeGreaterThan(1);
    for (const p of plan.parts) {
      expect(p.height * plan.scale).toBeLessThanOrEqual(MAX_CANVAS_SIDE);
      expect(p.width * p.height * plan.scale * plan.scale).toBeLessThanOrEqual(MAX_CANVAS_AREA);
    }
    // Parts tile the region exactly: contiguous, no gaps or overlaps.
    expect(plan.parts[0].y).toBe(0);
    plan.parts.slice(1).forEach((p, i) => expect(p.y).toBe(plan.parts[i].y + plan.parts[i].height));
    const last = plan.parts[plan.parts.length - 1];
    expect(last.y + last.height).toBe(40000);
  });

  it('only scales down when a single row is too wide for a canvas', () => {
    const plan = planParts({ x: 0, y: 0, width: 10000, height: 500 }, 2);
    expect(plan.scale).toBeLessThan(2);
    expect(10000 * plan.scale).toBeLessThanOrEqual(MAX_CANVAS_SIDE);
  });

  it('names parts', () => {
    expect(screenshotName({ url: 'https://e.com', type: 'fullpage', format: 'png', width: 1280, height: 40000, part: { index: 2, total: 3 } })).toBe('e-com-fullpage-1280x40000-part2of3.png');
    expect(screenshotName({ url: 'https://e.com', type: 'fullpage', format: 'png', width: 1, height: 2, part: { index: 1, total: 1 } })).toBe('e-com-fullpage-1x2.png');
  });
});
