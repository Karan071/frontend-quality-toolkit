import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import {
  ASSET_FOLDER, assetFileName, classifyUrl, countByType, cssUrls, extFromMime, mergeAssets, parseFontFaceUrls, parseSrcset, planZipPaths, totalBytes, typeFromMime,
} from '@ftk/asset-extractor';
import type { AssetSample } from '@ftk/asset-extractor';
import { buildZip } from '@ftk/asset-extractor/zip';

const asset = (over: Partial<AssetSample> = {}): AssetSample => ({
  id: 'a1', url: 'https://cdn.example.com/img/logo.png', type: 'image', sources: ['img'], name: 'logo.png', thirdParty: false, host: 'cdn.example.com', ...over,
});

describe('classification & naming', () => {
  it('classifies by extension, query-safe, and by data-URI mime', () => {
    expect(classifyUrl('https://x.com/a/b.PNG?v=3#x')).toBe('image');
    expect(classifyUrl('https://x.com/logo.svg')).toBe('image');
    expect(classifyUrl('https://x.com/favicon.ico')).toBe('icon');
    expect(classifyUrl('https://x.com/f.woff2')).toBe('font');
    expect(classifyUrl('https://x.com/app.css')).toBe('css');
    expect(classifyUrl('https://x.com/app.min.mjs')).toBe('js');
    expect(classifyUrl('https://x.com/clip.mp4')).toBe('media');
    expect(classifyUrl('https://x.com/report.pdf')).toBe('document');
    expect(classifyUrl('https://x.com/page')).toBe('other');
    expect(classifyUrl('data:image/gif;base64,AAAA')).toBe('image');
    expect(typeFromMime('font/woff2')).toBe('font');
    expect(typeFromMime('image/x-icon')).toBe('icon');
    expect(typeFromMime('text/html')).toBe('other');
  });

  it('builds safe file names, always with an extension', () => {
    expect(assetFileName('https://x.com/img/Hero%20Image@2x.jpg?w=100', 'image')).toBe('Hero Image@2x.jpg');
    expect(assetFileName('https://x.com/a/b/', 'image')).toBe('b.png');
    expect(assetFileName('https://x.com/', 'image')).toBe('x.com.png');
    expect(assetFileName('https://x.com/download', 'document', 'application/pdf')).toBe('download.pdf');
    expect(assetFileName('https://x.com/x', 'font')).toBe('x.woff2');
    expect(assetFileName('https://x.com/we<ird>:n*ame?.png', 'image')).toBe('we_ird_n_ame.png');
    expect(assetFileName('data:image/png;base64,AAAA', 'image', undefined, 3)).toBe('inline-image-3.png');
    expect(assetFileName('inline-svg:7', 'svg', undefined, 7)).toBe('inline-svg-7.svg');
    expect(assetFileName('https://x.com/' + 'a'.repeat(300) + '.png', 'image').length).toBeLessThanOrEqual(104);
    expect(extFromMime('image/jpeg; charset=x')).toBe('jpg');
  });
});

describe('parsing', () => {
  it('parses srcset with width and density descriptors and URLs containing commas', () => {
    expect(parseSrcset('a.jpg 400w, b.jpg 800w,  c.jpg')).toEqual([
      { url: 'a.jpg', descriptor: '400w' }, { url: 'b.jpg', descriptor: '800w' }, { url: 'c.jpg', descriptor: undefined },
    ]);
    expect(parseSrcset('img@1x.png 1x, img@2x.png 2x').map((c) => c.descriptor)).toEqual(['1x', '2x']);
    expect(parseSrcset('https://cdn.x.com/i/w_400,h_300/a.jpg 400w').map((c) => c.url)).toEqual(['https://cdn.x.com/i/w_400,h_300/a.jpg']);
    expect(parseSrcset('data:image/png;base64,AAAA 1x')).toEqual([]);
  });

  it('extracts url() references from CSS values', () => {
    expect(cssUrls('url("a.png"), url(\'b.png\') , linear-gradient(red, blue), url( c.png )')).toEqual(['a.png', 'b.png', 'c.png']);
    expect(cssUrls('url(#clip)')).toEqual([]);
  });

  it('finds @font-face files and resolves them against the stylesheet URL', () => {
    const css = `/* @font-face { src: url(no.woff) } */
      @font-face { font-family: "Inter"; src: url(../fonts/inter.woff2) format("woff2"), url('/fonts/inter.woff') format('woff'); }
      @font-face { font-family: Mono; src: local(Mono), url(https://fonts.gstatic.com/m.ttf); }
      .a { background: url(x.png) }`;
    expect(parseFontFaceUrls(css, 'https://site.com/css/main.css')).toEqual([
      { url: 'https://site.com/fonts/inter.woff2', family: 'Inter' },
      { url: 'https://site.com/fonts/inter.woff', family: 'Inter' },
      { url: 'https://fonts.gstatic.com/m.ttf', family: 'Mono' },
    ]);
  });
});

describe('planning', () => {
  it('puts each type in its folder and de-duplicates colliding names case-insensitively', () => {
    const paths = planZipPaths([
      asset({ id: '1', name: 'logo.png' }), asset({ id: '2', name: 'Logo.png' }), asset({ id: '3', name: 'logo.png' }),
      asset({ id: '4', type: 'font', name: 'f.woff2' }), asset({ id: '5', type: 'svg', name: 'inline-svg-1.svg' }), asset({ id: '6', type: 'image', name: 'noext' }),
    ]);
    expect([...paths.values()]).toEqual(['images/logo.png', 'images/Logo-2.png', 'images/logo-3.png', 'fonts/f.woff2', 'svg/inline-svg-1.svg', 'images/noext']);
    expect(new Set(paths.values()).size).toBe(6);
    expect(Object.keys(ASSET_FOLDER)).toContain('document');
  });

  it('counts, sums and merges', () => {
    const list = [asset({ bytes: 10 }), asset({ id: '2', type: 'font', bytes: 5 }), asset({ id: '3' })];
    expect(countByType(list)).toMatchObject({ image: 2, font: 1, css: 0 });
    expect(totalBytes(list)).toBe(15);
    const merged = mergeAssets(asset({ type: 'other', sources: ['network'] }), asset({ width: 800, height: 600, sources: ['img', 'network'], selector: 'img.hero' }));
    expect(merged).toMatchObject({ type: 'image', width: 800, height: 600, selector: 'img.hero' });
    expect(merged.sources).toEqual(['network', 'img']);
  });
});

describe('buildZip', () => {
  const bytes = (s: string) => new TextEncoder().encode(s);

  it('writes folders, an index, survives failures and reports progress', async () => {
    const assets = [
      asset({ id: '1', name: 'logo.png' }),
      asset({ id: '2', name: 'logo.png', url: 'https://other.com/logo.png' }),
      asset({ id: '3', type: 'css', name: 'site.css', url: 'https://x.com/site.css' }),
      asset({ id: '4', type: 'svg', name: 'inline-svg-1.svg', url: 'inline-svg:1' }),
      asset({ id: '5', type: 'font', name: 'broken.woff2', url: 'https://x.com/broken.woff2' }),
      asset({ id: '6', type: 'document', name: 'download', url: 'https://x.com/download' }),
    ];
    const progress: number[] = [];
    const res = await buildZip(
      assets,
      async (a) => {
        if (a.id === '5') throw new Error('HTTP 404');
        if (a.id === '6') return { bytes: bytes('%PDF-1.4'), contentType: 'application/pdf' };
        return { bytes: a.type === 'css' ? bytes('body{margin:0}') : bytes(`data:${a.id}`) };
      },
      { onProgress: (p) => progress.push(p.done), source: { url: 'https://x.com/', title: 'X' } },
    );
    expect(res.added).toBe(5);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0].error).toBe('HTTP 404');
    expect(progress[progress.length - 1]).toBe(6);

    const files = unzipSync(new Uint8Array(await res.blob.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(['_failed.txt', 'assets.json', 'css/site.css', 'documents/download.pdf', 'images/logo-2.png', 'images/logo.png', 'svg/inline-svg-1.svg']);
    expect(strFromU8(files['css/site.css'])).toBe('body{margin:0}');
    expect(strFromU8(files['_failed.txt'])).toContain('broken.woff2\tHTTP 404');
    const index = JSON.parse(strFromU8(files['assets.json']));
    expect(index.count).toBe(5);
    expect(index.source.url).toBe('https://x.com/');
    expect(index.assets.map((a: { path: string }) => a.path)).toContain('documents/download.pdf');
  });

  it('can be cancelled, and an empty list still yields a valid archive', async () => {
    const signal = { cancelled: false };
    const many = Array.from({ length: 30 }, (_, i) => asset({ id: String(i), name: `f${i}.png` }));
    let calls = 0;
    const res = await buildZip(many, async () => { if (++calls === 3) signal.cancelled = true; return { bytes: bytes('x') }; }, { signal, concurrency: 1 });
    expect(res.cancelled).toBe(true);
    expect(res.added).toBeLessThan(30);
    const empty = await buildZip([], async () => ({ bytes: bytes('x') }));
    expect(Object.keys(unzipSync(new Uint8Array(await empty.blob.arrayBuffer())))).toEqual(['assets.json']);
  });
});
