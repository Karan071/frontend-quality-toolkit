# Frontend Quality Toolkit

A Chrome (Manifest V3) side-panel extension that lets a frontend developer **inspect → measure → audit → fix → verify → capture → compare** without leaving the browser. No account, no backend, no LLM — everything is computed locally from the live page.

| | |
| --- | --- |
| **Inspect** | Element picker with box-model overlay, computed styles, matched CSS rules, accessibility name/role/contrast, temporary CSS |
| **Responsive** | Exact-size device emulation (via the DevTools protocol), overflow detection with culprit elements, breakpoint discovery, per-size screenshots |
| **Performance** | LCP · CLS · INP · FCP · TTFB · TBT, long tasks, layout-shift culprits, "Reload & measure" |
| **Images** | Oversized / heavy / legacy-format / un-dimensioned / lazy-loading problems, CLS cross-referencing, file sizes even for cross-origin images |
| **Bundles** | JS & CSS weight, third-party analysis, render-blocking resources, uncompressed text, duplicates |
| **Accessibility** | Contrast (AA), names & labels, alt text, headings, landmarks, ARIA, touch targets, focus styles, keyboard reachability |
| **UI / UX** | Palette & colour-scheme analysis, typography scale, spacing grid, button/radius consistency, design tokens, basic UX checks |
| **Screenshots** | Viewport, full-page and element capture; PNG/JPEG; copy/save/open; before/after compare (side-by-side, overlay, difference, slider) |
| **Fix & verify** | One-click temporary CSS fixes from findings, automatic re-audit, before/after finding counts |

Every finding has the **evidence**, **why it matters**, **how to fix it**, an element **highlight**, an optional **try-the-fix** button and a **screenshot** button. Export the audit as Markdown or JSON.

## Install (from source)

```bash
npm install
npm run build          # outputs dist/
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked** and select the `dist/` folder. Click the toolbar icon to open the side panel.

Requires Chrome 116+ (or any Chromium browser with the Side Panel API).

## Using it

1. Open a website and click the extension icon.
2. **Overview → Run full audit** (about a second on most pages).
3. Open a finding → **Highlight** to see it on the page, **Try fix** to preview the CSS change, then check the verification card.
4. Use the capture bar at the bottom (always visible) for **Full page / Viewport / Element** screenshots, or **Responsive** for exact device sizes.

The panel works from 280 px wide and follows your system light/dark theme (or choose one with the toggle in the header).

## How full-page screenshots work

The page is scrolled and captured tile by tile, then stitched on a canvas. To avoid the classic duplicated-header problem: `position: sticky` elements are put back in normal flow, and `position: fixed` elements are shown only in the first tile (top-anchored) or last tile (bottom-anchored). Lazy content is loaded by a pre-scroll pass, scrollbars are hidden during capture, and everything is restored afterwards. Output is capped at the browser's canvas limit (16 384 px per side) and the panel tells you when it had to scale down.

## Architecture

```
extension/
  manifest.json
  service-worker.ts      emulation (CDP), size probing, screenshot orchestration
  content/               page-side: inspector, overlay (shadow DOM), temp fixes, collectors, vitals
  sidepanel/             React UI (shadcn-style tokens, Inter + Geist)
  shared/                typed messages, IndexedDB store, audit pipeline
packages/                one workspace package per concern
  audit-core  dom-analyzer  css-analyzer  layout-analyzer  responsive-analyzer
  performance-analyzer  image-analyzer  bundle-analyzer  accessibility-analyzer
  color-analyzer  typography-analyzer  ux-analyzer  screenshot-engine  recommendation-engine
tests/
  unit/   vitest — pure analyzers, planners, pipeline
  e2e/    puppeteer — real browser with the built extension (fixture + live production sites)
```

Collectors run in the page and return plain JSON; **analyzers are pure functions** (data in, findings out), so rules are unit-tested without a browser. The `recommendation-engine` maps every rule id to guidance, ranks findings, and is itself tested to cover every rule an analyzer can emit.

## Development

```bash
npm run dev        # rebuild on change (reload the extension in chrome://extensions)
npm test           # unit tests
npm run typecheck
npm run e2e        # builds, then drives the extension in a real browser against a fixture page
npm run e2e:prod   # same workflow against live production sites (needs network)
```

The e2e scripts look for Chrome, Chromium or Brave (`CHROME_PATH` overrides). They pass `--disable-features=DisableLoadExtensionCommandLineSwitch`, which Chrome 137+ needs to honour `--load-extension`.

## Known limits

- **Shadow DOM** contents are not traversed by the audit or selectors (the light DOM is). **Iframes** are not audited (they appear in screenshots).
- **Cross-origin stylesheets** can't be read by pages, so their rules are missing from *Matched rules*, breakpoint discovery and focus-outline checks (computed styles are always exact).
- Pages that scroll **inside a container** rather than the document can't be stitched; the panel warns and captures the viewport.
- Automated accessibility checks cover only part of WCAG; contrast over images/gradients is reported as "unverifiable", not guessed.
- Device emulation uses the DevTools protocol, so Chrome shows its "debugging" bar while it's on, and it can't attach if another extension already holds the tab's debugger.
- Chrome allows ~2 `captureVisibleTab` calls per second, so very tall pages take a few seconds.
- Not yet implemented from the PRD's later phases: DevTools panel integration, CSS/JS coverage, screenshot annotation, shareable reports, and the optional AI layer.

## Privacy & permissions

Everything stays on your machine — see [PRIVACY.md](PRIVACY.md) for the full statement and a justification of each permission.

## Product spec

The original product requirements live in [docs/PRD.md](docs/PRD.md).

## License

[MIT](LICENSE)
