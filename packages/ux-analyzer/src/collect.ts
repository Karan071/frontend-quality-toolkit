import { parseColor, toHex } from '@ftk/audit-core';
import type { ButtonSample, SpacingData, UxData, Visitor } from '@ftk/audit-core';
import { normalizeColor } from '@ftk/dom-analyzer/collect';

const MAX_BUTTONS = 120;
const MAX_LINKS = 500;
const px = (v: string) => parseFloat(v) || 0;
const hex = (raw: string) => {
  const c = parseColor(normalizeColor(raw));
  return c ? toHex(c) : raw;
};

/** Spacing + corner radii, sampled during the shared walk. */
export function spacingVisitor(): Visitor<SpacingData> {
  const values = new Map<number, number>();
  const radii = new Map<number, number>();
  const bump = (m: Map<number, number>, n: number) => m.set(n, (m.get(n) ?? 0) + 1);

  return {
    visit(ctx) {
      if (!ctx.visible()) return;
      const s = ctx.style;
      // Margins are skipped on the horizontal axis: `auto` resolves to large used px values.
      for (const prop of [
        s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft,
        s.rowGap, s.columnGap, s.marginTop, s.marginBottom,
      ]) {
        const v = Math.round(px(prop) * 2) / 2;
        if (v > 0 && v <= 200) bump(values, v);
      }
      const r = px(s.borderTopLeftRadius);
      if (r > 0 && (s.backgroundColor !== 'rgba(0, 0, 0, 0)' || s.borderTopStyle !== 'none')) {
        bump(radii, r >= 999 ? 9999 : Math.round(r));
      }
    },
    result: () => ({
      values: [...values].map(([px, count]) => ({ px, count })),
      radii: [...radii].map(([px, count]) => ({ px, count })),
    }),
  };
}

/** Buttons, links and forms for consistency and basic UX checks. */
export function uxVisitor(): Visitor<UxData> {
  const buttons: ButtonSample[] = [];
  const links: UxData['links'] = [];
  const forms: UxData['forms'] = [];
  let hashLinkCount = 0;

  return {
    visit(ctx) {
      const { el } = ctx;
      const tag = el.localName;
      const role = el.getAttribute('role');
      const isButton =
        tag === 'button' ||
        (tag === 'input' && ['button', 'submit', 'reset'].includes((el as HTMLInputElement).type)) ||
        role === 'button' ||
        (tag === 'a' && /(^|[\s_-])(btn|button)([\s_-]|$)/i.test(el.className?.toString() ?? ''));

      if (isButton && buttons.length < MAX_BUTTONS && ctx.visible()) {
        const s = ctx.style;
        buttons.push({
          selector: ctx.selector(),
          bg: hex(s.backgroundColor),
          color: hex(s.color),
          radius: px(s.borderTopLeftRadius),
          padX: px(s.paddingLeft),
          padY: px(s.paddingTop),
          fontSize: px(s.fontSize),
          fontWeight: parseInt(s.fontWeight, 10) || 400,
          hasBorder: s.borderTopStyle !== 'none' && px(s.borderTopWidth) > 0,
        });
      }

      if (tag === 'a' && el.hasAttribute('href') && ctx.visible()) {
        const href = el.getAttribute('href') ?? '';
        if (href === '#' || /^javascript:/i.test(href)) hashLinkCount++;
        if (links.length < MAX_LINKS) {
          links.push({ selector: ctx.selector(), text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60), href: href.slice(0, 120) });
        }
      }

      if (tag === 'form') {
        const inputs = el.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea').length;
        const hasSubmit = !!el.querySelector('input[type=submit], button:not([type=button]):not([type=reset])');
        forms.push({ selector: ctx.selector(), hasSubmit, inputCount: inputs });
      }
    },
    result: () => ({ buttons, links, hashLinkCount, forms }),
  };
}
