import { parseColor, toHex } from '@ftk/audit-core';
import type { ColorUse, Visitor } from '@ftk/audit-core';
import { normalizeColor } from '@ftk/dom-analyzer/collect';

const MAX_UNIQUE = 600;

/** Counts colours used for text, backgrounds and borders across visible elements. */
export function colorsVisitor(): Visitor<ColorUse[]> {
  const counts = new Map<string, ColorUse>();

  const add = (raw: string, role: ColorUse['role']) => {
    const rgba = parseColor(normalizeColor(raw));
    if (!rgba || rgba.a < 0.05) return;
    const value = toHex(rgba);
    const key = `${role}:${value}`;
    const hit = counts.get(key);
    if (hit) hit.count++;
    else if (counts.size < MAX_UNIQUE) counts.set(key, { value, role, count: 1 });
  };

  return {
    visit(ctx) {
      if (!ctx.visible()) return;
      const s = ctx.style;
      add(s.backgroundColor, 'background');
      if (Array.from(ctx.el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim())) {
        add(s.color, 'text');
      }
      if (s.borderTopStyle !== 'none' && parseFloat(s.borderTopWidth) > 0) add(s.borderTopColor, 'border');
    },
    result: () => [...counts.values()],
  };
}
