import { describe, expect, it } from 'vitest';
import { isPlainColorValue, isPrivateHost, isSafeFetchUrl, redactUrl } from '@ftk/audit-core';
import { classifyToken, parseCssText } from '@ftk/css-analyzer';
import { planZipPaths, safeFileName, assetFileName } from '@ftk/asset-extractor';
import { buildZip } from '@ftk/asset-extractor/zip';
import type { AssetSample } from '@ftk/asset-extractor';
import { toMarkdown } from '@ftk/recommendation-engine';
import { TooLargeError, readCapped, readTextCapped } from '../../extension/shared/fetch';

describe('isSafeFetchUrl', () => {
  const page = 'https://example.com/app';

  it('allows public http(s) hosts', () => {
    expect(isSafeFetchUrl('https://cdn.example.com/a.png', page)).toBe(true);
    expect(isSafeFetchUrl('http://8.8.8.8/x', page)).toBe(true);
    expect(isSafeFetchUrl('https://[2606:4700:4700::1111]/', page)).toBe(true);
  });

  it('blocks loopback, LAN, link-local and metadata addresses', () => {
    for (const u of [
      'http://localhost:2375/containers/json',
      'http://127.0.0.1/',
      'http://127.1/',
      'http://2130706433/', // decimal form of 127.0.0.1
      'http://0x7f.0.0.1/',
      'http://10.0.0.5/',
      'http://172.16.4.4/',
      'http://192.168.0.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://100.64.0.1/',
      'http://0.0.0.0/',
      'http://[::1]/',
      'http://[fe80::1]/',
      'http://[fd00::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://router/',
      'http://printer.local/',
      'http://wiki.internal/',
    ]) {
      expect(isSafeFetchUrl(u, page), u).toBe(false);
    }
  });

  it('blocks other schemes', () => {
    // eslint-disable-next-line no-script-url -- hostile input under test
    for (const u of ['file:///etc/passwd', 'ftp://example.com/x', 'chrome://settings', 'javascript:alert(1)', 'blob:https://example.com/1', 'not a url', '']) {
      expect(isSafeFetchUrl(u, page), u).toBe(false);
    }
  });

  it('allows private targets when the page itself is on a private host', () => {
    expect(isSafeFetchUrl('http://localhost:5173/src/main.css', 'http://localhost:3000/')).toBe(true);
    expect(isSafeFetchUrl('http://192.168.1.20:8080/a.png', 'http://192.168.1.10/')).toBe(true);
    // ...but a public page cannot reach its way in.
    expect(isSafeFetchUrl('http://localhost:5173/a.css', 'https://example.com/')).toBe(false);
  });

  it('allows file: only from file: pages', () => {
    expect(isSafeFetchUrl('file:///Users/me/site/a.png', 'file:///Users/me/site/index.html')).toBe(true);
    expect(isSafeFetchUrl('file:///Users/me/site/a.png', page)).toBe(false);
  });

  it('classifies hosts', () => {
    expect(isPrivateHost('example.com')).toBe(false);
    expect(isPrivateHost('LOCALHOST')).toBe(true);
    expect(isPrivateHost('172.32.0.1')).toBe(false);
    expect(isPrivateHost('172.31.255.255')).toBe(true);
  });
});

describe('redactUrl', () => {
  it('drops credentials, query and fragment', () => {
    expect(redactUrl('https://user:pw@example.com/a/b?token=abc#frag')).toBe('https://example.com/a/b');
    expect(redactUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(redactUrl('not a url')).toBe('not a url');
  });
});

describe('colour values', () => {
  it('accepts plain colours and rejects anything that could load a resource', () => {
    for (const v of ['#fff', '#aabbccdd', 'rgb(1 2 3 / 50%)', 'hsl(0 0% 0%)', 'oklch(0.7 0.1 200)', 'color(srgb 1 0 0)', 'red']) expect(isPlainColorValue(v), v).toBe(true);
    for (const v of [
      'hsl(0 0% 0%) url(http://10.0.0.5/pixel)',
      'url(http://10.0.0.5/pixel)',
      'rgb(0 0 0); background: url(x)',
      'image-set("http://10.0.0.5/x" 1x)',
      'hsl(0 0% 0%)/**/url(x)',
    ]) expect(isPlainColorValue(v), v).toBe(false);
  });

  it('does not classify a colour followed by a url() as a colour token', () => {
    expect(classifyToken('hsl(0 0% 0%) url(http://10.0.0.5/pixel)')).not.toBe('color');
    expect(classifyToken('hsl(200 50% 40%)')).toBe('color');
    expect(classifyToken('#fff')).toBe('color');
  });
});

describe('parseCssText', () => {
  it('still extracts media queries, tokens and focus rules', () => {
    const css = `/* c */ :root{--brand:#123456;--gap:8px;--font:"Inter", sans-serif}
      @media (min-width: 768px){ .a{color:red} a:focus{outline:none} }
      @media (max-width:600px){ .b{color:blue} }
      .btn:focus-visible{outline:0;box-shadow:0 0 0 2px red}`;
    const p = parseCssText(css);
    expect(p.mediaTexts).toEqual(['(min-width: 768px)', '(max-width:600px)']);
    expect(p.tokens.map((t) => [t.name, t.kind])).toEqual([['--brand', 'color'], ['--gap', 'size'], ['--font', 'font']]);
    expect(p.focusRules).toEqual(['a:focus']);
    expect(p.ruleCount).toBe(5);
  });

  it('runs in linear time on hostile input', () => {
    const size = 800_000;
    const inputs = [
      'a'.repeat(size), // no braces
      '@media '.repeat(size / 7), // many media starts, no brace
      '/*'.repeat(size / 2), // many unterminated comment starts
      ':root{' + '--'.repeat(size / 2) + '}', // custom-property lookalike
      '{'.repeat(size),
      ',  '.repeat(size / 3) + '{}',
    ];
    for (const css of inputs) {
      const t = performance.now();
      parseCssText(css);
      expect(performance.now() - t, css.slice(0, 12)).toBeLessThan(1500);
    }
  });
});

describe('file names', () => {
  it('neutralises reserved, hidden and runnable names', () => {
    expect(safeFileName('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(safeFileName('CON.png')).toBe('_CON.png');
    expect(safeFileName('nul')).toBe('_nul');
    expect(safeFileName('.htaccess')).toBe('htaccess');
    expect(safeFileName('name. ')).toBe('name');
    expect(safeFileName('setup.exe')).toBe('setup.exe.txt');
    expect(safeFileName('a\u0000b\u001f.png')).toBe('ab.png');
    expect(safeFileName('')).toBe('asset');
    expect(safeFileName('x'.repeat(300)).length).toBeLessThanOrEqual(100);
  });

  it('applies the same rules to URL-derived names and ZIP paths', () => {
    expect(assetFileName('https://x.com/CON', 'image')).toBe('_CON.png');
    const paths = planZipPaths([{ id: '1', type: 'image', name: '../../evil.png' }, { id: '2', type: 'other', name: 'run.bat' }]);
    // One folder plus one file name: no path segment can climb out of the archive.
    expect(paths.get('1')!.split('/')).toEqual([paths.get('1')!.split('/')[0], '_.._evil.png']);
    expect(paths.get('2')!.endsWith('/run.bat.txt')).toBe(true);
  });
});

describe('buildZip size limit', () => {
  it('skips files past the archive limit and reports them', async () => {
    const mk = (id: string): AssetSample => ({ id, url: `https://x.com/${id}.png`, type: 'image', sources: ['img'], name: `${id}.png`, thirdParty: false, host: 'x.com' });
    const result = await buildZip([mk('a'), mk('b')], async () => ({ bytes: new Uint8Array(600) }), { concurrency: 1, maxBytes: 1000 });
    expect(result.added).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toMatch(/limit/i);
  });
});

describe('readCapped', () => {
  const stream = (chunks: Uint8Array[]) =>
    new Response(
      new ReadableStream({
        start(c) {
          chunks.forEach((x) => c.enqueue(x));
          c.close();
        },
      }),
    );

  it('returns the body when it fits', async () => {
    const out = await readCapped(stream([new Uint8Array([1, 2]), new Uint8Array([3])]), 10);
    expect([...out]).toEqual([1, 2, 3]);
  });

  it('throws when the decoded body is over the limit', async () => {
    await expect(readCapped(stream([new Uint8Array(6), new Uint8Array(6)]), 10)).rejects.toBeInstanceOf(TooLargeError);
  });

  it('rejects early on a declared Content-Length over the limit', async () => {
    const res = new Response('x', { headers: { 'content-length': '999999' } });
    await expect(readCapped(res, 10)).rejects.toBeInstanceOf(TooLargeError);
  });

  it('truncates text instead of throwing', async () => {
    const text = await readTextCapped(stream([new TextEncoder().encode('hello world')]), 5);
    expect(text).toBe('hello');
  });
});

describe('toMarkdown with hostile page text', () => {
  it('keeps titles on one line, escapes HTML and removes the query string', () => {
    const md = toMarkdown({
      url: 'https://example.com/p?token=SECRET#x',
      title: 'Hi\n# Injected heading <img src=x onerror=alert(1)>',
      takenAt: Date.now(),
      viewport: { width: 1, height: 1 },
      findings: [],
    });
    const lines = md.split('\n');
    expect(lines.filter((l) => l.startsWith('#'))).toHaveLength(1);
    expect(md).not.toContain('<img');
    expect(md).not.toContain('SECRET');
  });
});
