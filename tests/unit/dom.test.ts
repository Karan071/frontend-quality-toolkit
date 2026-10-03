// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { accessibleName, elementsIn, implicitRole, parentOf, queryAllSafe, uniqueSelector } from '@ftk/dom-analyzer/collect';

beforeEach(() => {
  document.body.innerHTML = `
    <header id="top"><nav><a href="/a" class="link">A</a><a href="/b" class="link">B</a></nav></header>
    <main>
      <ul class="list"><li>one</li><li>two</li><li>three</li></ul>
      <section class="hero css-1a2b3c"><div class="hero-card wide">card</div></section>
      <form>
        <label for="e">Email</label><input id="e" type="email">
        <label>Name <input id="n"></label>
        <input id="p" placeholder="Phone">
        <input id="sub" type="submit" value="Send">
        <button id="icon" aria-label="Close"><svg></svg></button>
        <button id="empty"><svg></svg></button>
        <a id="imglink" href="/x"><img alt="Home" src="x.png"></a>
      </form>
    </main>`;
});

describe('uniqueSelector', () => {
  it('uses ids when unique and always resolves to exactly the element', () => {
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const sel = uniqueSelector(el);
      const hits = document.querySelectorAll(sel);
      expect(hits.length, sel).toBe(1);
      expect(hits[0]).toBe(el);
    }
    expect(uniqueSelector(document.getElementById('top')!)).toBe('#top');
  });

  it('disambiguates siblings and skips generated class names', () => {
    expect(uniqueSelector(document.querySelectorAll('li')[1])).toContain('nth-of-type(2)');
    const sel = uniqueSelector(document.querySelector('.hero-card')!);
    expect(sel).toContain('hero-card');
    expect(sel).not.toContain('css-1a2b3c');
  });
});

describe('accessibleName / role', () => {
  it('resolves labels, wrapping labels, aria-label, img alt and empties', () => {
    expect(accessibleName(document.getElementById('e')!)).toBe('Email');
    expect(accessibleName(document.getElementById('n')!)).toContain('Name');
    expect(accessibleName(document.getElementById('p')!)).toBe(''); // placeholder is not a name
    expect(accessibleName(document.getElementById('sub')!)).toBe('Send');
    expect(accessibleName(document.getElementById('icon')!)).toBe('Close');
    expect(accessibleName(document.getElementById('empty')!)).toBe('');
    expect(accessibleName(document.getElementById('imglink')!)).toBe('Home');
  });

  it('maps implicit roles', () => {
    expect(implicitRole(document.querySelector('nav')!)).toBe('navigation');
    expect(implicitRole(document.getElementById('sub')!)).toBe('button');
    expect(implicitRole(document.getElementById('e')!)).toBe('textbox');
    expect(implicitRole(document.createElement('a'))).toBeNull();
  });
});

describe('accessibleName fallbacks', () => {
  it('uses a descendant title when there is no text (Hacker News vote arrows)', () => {
    document.body.innerHTML = '<a id="v" href="#"><div class="arrow" title="upvote"></div></a><a id="x" href="#"><div></div></a>';
    expect(accessibleName(document.getElementById('v')!)).toBe('upvote');
    expect(accessibleName(document.getElementById('x')!)).toBe('');
  });
});

describe('shadow DOM', () => {
  function setup() {
    document.body.innerHTML = '<div id="app"><x-card class="card"></x-card><x-card class="card" id="second"></x-card></div>';
    for (const host of document.querySelectorAll('x-card')) {
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = '<div class="body"><p class="t">hello</p><button id="go">Go</button></div>';
    }
  }

  it('produces host >>> inner selectors that resolve to exactly the element', () => {
    setup();
    for (const host of document.querySelectorAll('x-card')) {
      for (const inner of Array.from(host.shadowRoot!.querySelectorAll('*'))) {
        const sel = uniqueSelector(inner);
        expect(sel).toContain(' >>> ');
        const hits = queryAllSafe(sel);
        expect(hits, sel).toEqual([inner]);
      }
    }
  });

  it('walks into shadow roots, host before its shadow content', () => {
    setup();
    const all = [...elementsIn(document.body)];
    const hostIdx = all.findIndex((e) => e.id === 'second');
    const innerIdx = all.findIndex((e) => e.parentElement === null && e.localName === 'div' && e.getRootNode() === document.getElementById('second')!.shadowRoot);
    expect(hostIdx).toBeGreaterThan(-1);
    expect(innerIdx).toBeGreaterThan(hostIdx);
    expect(all.filter((e) => e.localName === 'button')).toHaveLength(2);
  });

  it('crosses the boundary when climbing to the parent', () => {
    setup();
    const top = document.getElementById('second')!.shadowRoot!.querySelector('.body')!;
    expect(parentOf(top)?.id).toBe('second');
    expect(accessibleName(document.getElementById('second')!.shadowRoot!.getElementById('go')!)).toBe('Go');
  });

  it('keeps light-DOM selectors unchanged and tolerates garbage', () => {
    setup();
    expect(uniqueSelector(document.getElementById('app')!)).toBe('#app');
    expect(queryAllSafe('::nope >>> ???')).toEqual([]);
  });
});
