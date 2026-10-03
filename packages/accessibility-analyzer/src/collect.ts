import { toHex, composite, parseColor } from '@ftk/audit-core';
import type { A11yData, AriaIssue, ControlSample, HeadingSample, TargetSample, TextSample, Visitor } from '@ftk/audit-core';
import { accessibleName, makeBackgroundResolver, normalizeColor } from '@ftk/dom-analyzer/collect';
import { collectFocusOutlineRemovals } from '@ftk/css-analyzer/collect';
import { isValidRole } from './index';

const FOCUSABLE = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';
const INTERACTIVE_ANCESTOR = 'a,button,[role=button],[role=link],label,summary,select,[tabindex],[onclick]';
const MAX_TEXT = 3000;
const MAX_TARGETS = 300;
const MAX_ISSUES = 40;

function inlineTextBlock(el: Element, display: string): boolean {
  if (display !== 'inline') return false;
  // WCAG exception: links inside a sentence are inline targets.
  const parent = el.parentElement;
  return !!parent && (parent.textContent ?? '').trim().length > (el.textContent ?? '').trim().length + 10;
}

export function a11yVisitor(): Visitor<A11yData> {
  const resolveBg = makeBackgroundResolver();
  const textMap = new Map<string, TextSample>();
  let textNodes = 0;
  const controls: ControlSample[] = [];
  const headings: HeadingSample[] = [];
  const targets: TargetSample[] = [];
  const ariaIssues: AriaIssue[] = [];
  const clickable: { selector: string; tag: string }[] = [];
  const ids = new Map<string, Element[]>();
  const landmarks = { main: 0, nav: 0, header: 0, footer: 0 };

  const addIssue = (issue: AriaIssue) => {
    if (ariaIssues.filter((i) => i.kind === issue.kind).length < MAX_ISSUES) ariaIssues.push(issue);
  };

  return {
    visit(ctx) {
      const { el } = ctx;
      const tag = el.localName;
      const role = el.getAttribute('role');

      if (el.id) {
        const list = ids.get(el.id);
        if (list) list.push(el);
        else ids.set(el.id, [el]);
      }

      // ── ARIA ──
      const tabindex = el.getAttribute('tabindex');
      if (tabindex && parseInt(tabindex, 10) > 0) {
        addIssue({ kind: 'positive-tabindex', selector: ctx.selector(), detail: `tabindex="${tabindex}"` });
      }
      if (role) {
        for (const r of role.split(/\s+/)) {
          if (r && !isValidRole(r)) addIssue({ kind: 'invalid-role', selector: ctx.selector(), detail: `role="${r}"` });
        }
      }
      if (el.getAttribute('aria-hidden') === 'true' && (el.matches(FOCUSABLE) || el.querySelector(FOCUSABLE))) {
        addIssue({ kind: 'hidden-focusable', selector: ctx.selector(), detail: `<${tag} aria-hidden="true">` });
      }
      for (const attr of ['aria-labelledby', 'aria-describedby', 'aria-controls']) {
        const value = el.getAttribute(attr);
        if (!value) continue;
        const missing = value.split(/\s+/).filter((id) => id && !document.getElementById(id));
        if (missing.length) addIssue({ kind: 'broken-reference', selector: ctx.selector(), detail: `${attr}="${missing[0]}"` });
      }

      if (!ctx.visible()) return;

      // ── Landmarks & headings ──
      if (tag === 'main' || role === 'main') landmarks.main++;
      if (tag === 'nav' || role === 'navigation') landmarks.nav++;
      if (tag === 'header' || role === 'banner') landmarks.header++;
      if (tag === 'footer' || role === 'contentinfo') landmarks.footer++;
      const hMatch = /^h([1-6])$/.exec(tag);
      if (hMatch || role === 'heading') {
        const level = hMatch ? parseInt(hMatch[1], 10) : parseInt(el.getAttribute('aria-level') ?? '2', 10);
        headings.push({ level, text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60), selector: ctx.selector() });
      }

      // ── Controls ──
      const style = ctx.style;
      let kind: ControlSample['kind'] | null = null;
      if (tag === 'input') {
        const type = (el as HTMLInputElement).type;
        if (type !== 'hidden') kind = ['button', 'submit', 'reset', 'image'].includes(type) ? 'button' : 'input';
      } else if (tag === 'select') kind = 'select';
      else if (tag === 'textarea') kind = 'textarea';
      else if (tag === 'button') kind = 'button';
      else if (tag === 'a' && el.hasAttribute('href')) kind = 'link';
      else if (role === 'button') kind = 'role-button';
      else if (role === 'link') kind = 'link';

      if (kind) {
        const name = accessibleName(el);
        const placeholder = el.getAttribute('placeholder');
        controls.push({
          selector: ctx.selector(),
          tag,
          kind,
          inputType: tag === 'input' ? (el as HTMLInputElement).type : null,
          name,
          placeholderOnly: !name && !!placeholder,
          autocomplete: el.getAttribute('autocomplete'),
        });

        // Target size. Checkboxes/radios with labels are operated through the label.
        const isNativeToggle = tag === 'input' && ['checkbox', 'radio'].includes((el as HTMLInputElement).type);
        const labelled = isNativeToggle && (el as HTMLInputElement).labels?.length;
        if (!labelled && !inlineTextBlock(el, style.display) && targets.length < MAX_TARGETS) {
          const r = ctx.rect();
          if (Math.min(r.width, r.height) < 44) {
            targets.push({ selector: ctx.selector(), width: Math.round(r.width), height: Math.round(r.height), kind, display: style.display });
          }
        }
      } else if (
        style.cursor === 'pointer' &&
        !role &&
        !el.hasAttribute('tabindex') &&
        el.parentElement &&
        getComputedStyle(el.parentElement).cursor !== 'pointer' &&
        !el.closest(INTERACTIVE_ANCESTOR) &&
        clickable.length < MAX_ISSUES
      ) {
        clickable.push({ selector: ctx.selector(), tag });
      }

      // ── Text contrast ──
      if (textNodes < MAX_TEXT) {
        let direct = '';
        for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE) direct += n.textContent ?? '';
        direct = direct.replace(/\s+/g, ' ').trim();
        if (direct) {
          textNodes++;
          const bg = resolveBg(el);
          const fgRaw = parseColor(normalizeColor(style.color));
          if (fgRaw) {
            const fg = composite({ ...fgRaw, a: fgRaw.a * bg.opacity }, bg.rgba);
            const fgHex = toHex({ ...fg, a: 1 });
            const bgHex = toHex({ ...bg.rgba, a: 1 });
            const fontSize = parseFloat(style.fontSize) || 16;
            const weight = parseInt(style.fontWeight, 10) || 400;
            const key = `${fgHex}|${bgHex}|${Math.round(fontSize)}|${weight}|${bg.uncertain}`;
            const hit = textMap.get(key);
            if (hit) {
              hit.count++;
              if (hit.extraSelectors.length < 4) hit.extraSelectors.push(ctx.selector());
            } else {
              textMap.set(key, {
                selector: ctx.selector(),
                text: direct.slice(0, 40),
                fg: fgHex,
                bg: bgHex,
                bgUncertain: bg.uncertain,
                fontSize,
                fontWeight: weight,
                count: 1,
                extraSelectors: [],
              });
            }
          }
        }
      }
    },

    result() {
      for (const [id, list] of ids) {
        if (list.length > 1 && ariaIssues.filter((i) => i.kind === 'duplicate-id').length < MAX_ISSUES) {
          ariaIssues.push({ kind: 'duplicate-id', selector: `[id="${id.replace(/"/g, '\\"')}"]`, detail: `id="${id}" ×${list.length}` });
        }
      }
      const viewport = document.querySelector('meta[name="viewport"]')?.getAttribute('content')?.toLowerCase().replace(/\s+/g, '') ?? '';
      const maxScale = /maximum-scale=([\d.]+)/.exec(viewport);
      return {
        controls,
        headings,
        landmarks,
        targets,
        ariaIssues,
        focusRules: collectFocusOutlineRemovals(),
        clickableNotFocusable: clickable,
        zoomDisabled: /user-scalable=(no|0)/.test(viewport) || (!!maxScale && parseFloat(maxScale[1]) < 2),
        text: [...textMap.values()],
      };
    },
  };
}
