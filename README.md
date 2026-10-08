<p align="center"><img src="docs/icon-512.png" alt="Frontend Quality Toolkit icon" width="96" height="96"></p>

<h1 align="center">Frontend Quality Toolkit</h1>

A Chrome (Manifest V3) side-panel extension that lets a frontend developer **inspect → measure → audit → fix → verify → capture → compare** without leaving the browser. No account, no backend, no LLM — everything is computed locally from the live page.

**Latest release:** [0.1.3](docs/releases/0.1.3.md)

|                   |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Inspect**       | Element picker with box-model overlay, computed styles, matched CSS rules, accessibility name/role/contrast, temporary CSS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Responsive**    | A 73-device reference in a two-column grid, with real pixel ratios — **Apple** (iPhone SE→17 Pro Max and iPhone Air, iPad mini→Pro 13″, MacBook Air/Pro, iMac, Studio Display, Pro Display XDR, Apple TV), Samsung (S25/S26, Z Flip/Fold 7), Pixel 9, OnePlus, Surface, laptops, 24–32″ monitors, **29″–49″ ultrawide** and **43–75″ TVs incl. 21:9 55″/60″** — each showing CSS size, physical resolution, aspect ratio and diagonal, with search, an Apple filter, a landscape toggle and copy-as-media-query; custom sizes up to 10 000 px; overflow detection with culprit elements, wide-screen readability check, breakpoint discovery, per-size screenshots, and a **full-screen device simulator** that shows the page inside a realistic hardware frame (see below), rotates it and zooms out to fit (or Ctrl+scroll to zoom) so a 49″ monitor or 60″ TV is visible whole |
| **Performance**   | LCP · CLS · INP · FCP · TTFB · TBT, long tasks, layout-shift culprits, "Reload & measure"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Images**        | Oversized / heavy / legacy-format / un-dimensioned / lazy-loading problems, CLS cross-referencing, file sizes even for cross-origin images                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Bundles**       | JS & CSS weight, third-party analysis, render-blocking resources, uncompressed text, duplicates                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Accessibility** | Contrast (AA), names & labels, alt text, headings, landmarks, ARIA, touch targets, focus styles, keyboard reachability                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **UI / UX**       | Palette & colour-scheme analysis, typography scale, spacing grid, button/radius consistency, design tokens, basic UX checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Assets**        | Finds every file the page uses — images (every `srcset`/`<picture>`/lazy-load variant and CSS background), inline SVG, icons, fonts, stylesheets, scripts, video/audio and linked documents — then downloads one file, a selection, a filtered set, or everything as a ZIP organised by type with an `assets.json` index                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Screenshots**   | Viewport, full-page and element capture; PNG/JPEG; copy/save/open; before/after compare (side-by-side, overlay, difference, slider)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Fix & verify**  | One-click temporary CSS fixes from findings, automatic re-audit, before/after finding counts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

Every finding has the **evidence**, **why it matters**, **how to fix it**, an element **highlight**, an optional **try-the-fix** button and a **screenshot** button. Export the audit as Markdown or JSON.

## Install (from source)

```bash
pnpm install
pnpm build             # outputs dist/
pnpm icons             # (optional) re-render the PNG icons from extension/icons/*.svg
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked** and select the `dist/` folder. Click the toolbar icon to open the side panel.

Requires Chrome 116+ (or any Chromium browser with the Side Panel API).

## Using it

1. Open a website and click the extension icon.
2. **Overview → Run full audit** (about a second on most pages).
3. Open a finding → **Highlight** to see it on the page, **Try fix** to preview the CSS change, then check the verification card.
4. Use the capture bar at the bottom (always visible) for **Full page / Viewport / Element** screenshots, or **Responsive** for exact device sizes.

The panel is responsive: a compact stacked layout from 280 px, a sidebar dashboard from 760 px, and larger type and a bounded reading column on big monitors (scales up through 1200 / 1800 / 2600 px). Use the **Open in a tab** button in the header for the roomy layout. It follows your system light/dark theme (or choose one with the toggle in the header).

### Device catalogue (Responsive tab)

| Group     | Presets (CSS px @ pixel ratio)                                                                                                                                                                                                                                                                                   |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phones    | iPhone SE 375×667 · 13 mini 375×812 · 14 390×844 · 15/16 393×852 · 16 Pro 402×874 · 14 Plus 428×926 · 15 Pro Max/16 Plus 430×932 · 16 Pro Max 440×956 · Galaxy S24 360×780 · Pixel 8 412×915 · Galaxy Fold folded 280×653 · Z Fold 5 344×882 · Surface Duo 540×720 · generic 320 / 390 / 430 / unfolded 884×1104 |
| Tablets   | iPad mini 744×1133 · iPad 10.2″ 810×1080 · iPad 10th/Air 11″ 820×1180 · iPad Pro 11″ 834×1194 · iPad Pro 12.9″ 1024×1366 · iPad Pro 13″ M4 1032×1376 · Surface Pro 7 912×1368 · generic 768×1024 / landscape                                                                                                     |
| Laptops   | MacBook Air 13″ 1440×900 / 1470×956 · Air 15″ 1710×1107 · Pro 14″ 1512×982 · Pro 16″ 1728×1117 · 1366×768 · 1280×800 · 1536×864                                                                                                                                                                                  |
| Desktops  | 1440×900 · Full HD 24″ · QHD 27″ · iMac 24″ 2240×1260 @2× · Studio Display 2560×1440 @2× · Pro Display XDR 3008×1692 @2× · 4K 32″                                                                                                                                                                                |
| Ultrawide | 29″ 2560×1080 · 34″ 3440×1440 · 38″ 3840×1600 · **49″ super-ultrawide 5120×1440 (32:9)**                                                                                                                                                                                                                         |
| TVs       | 43″ · 50″ 4K · **55″** Full HD / 4K / **21:9** · **60″** 4K / 4K native / **21:9** · 65″ · 75″ · Apple TV 4K                                                                                                                                                                                                     |

Apple sizes are Apple's published point dimensions. 4K TVs are listed the way their browsers report them (a 1920×1080 viewport at 2× density); the native 3840×2160 case is there too, and the 21:9 TVs are representative cinema-ratio sizes — individual models differ, so use **Custom size** for an exact match. Every row has a copy button that puts the size, pixel ratio, physical resolution and a matching `@media` query on the clipboard. "Core sizes" runs one representative per category; "Test all" runs every preset. On wide screens the lab also flags text that stretches edge to edge (100+ characters per line).

## Assets: extract and download

Open the **Assets** tab and choose **Scan assets**. It finds files referenced by `<img>` (current source, every `srcset` candidate and common lazy-load attributes), `<picture>`/`<source>`, `<video>`/`<audio>`/`<track>`, CSS `background`/`mask`/list/border images, `@font-face` rules, `<link>` icons / stylesheets / preloads / manifest, `<meta>` social images, `<script src>`, links to PDFs/archives/media, inline `<svg>` markup, plus everything the browser recorded on the network (script-injected images, fonts, media). Filter by type, search, select any subset, then download a single file or a ZIP:

```
site-assets.zip
├── images/  svg/  icons/  fonts/  css/  js/  media/  documents/
├── assets.json      source URL, type, path, size, where each file was referenced
└── _failed.txt      only if something could not be fetched
```

Names are sanitised and de-duplicated, missing extensions are restored from the response's content type, and inline SVG / data-URI images are exported as real files. Downloads run in your browser (no cookies are sent, so login-protected files are reported in `_failed.txt`), a few at a time, with progress and **Cancel**.

## How full-page screenshots work

The page is scrolled and captured tile by tile, then stitched on a canvas. To avoid the classic duplicated-header problem: `position: sticky` elements are put back in normal flow, and `position: fixed` elements are shown only in the first tile (top-anchored) or last tile (bottom-anchored). Lazy content is loaded by a pre-scroll pass, scrollbars are hidden during capture, and everything is restored afterwards. Output is capped at the browser's canvas limit (16 384 px per side) and the panel tells you when it had to scale down.

## Architecture

```
extension/
  manifest.json
  service-worker.ts      emulation (CDP), size probing, screenshot orchestration
  content/               page-side: inspector, overlay (shadow DOM), temp fixes, collectors, vitals
  sidepanel/             React UI (shadcn-style tokens, Inter + Geist)
  simulator/             full-window device simulator; DeviceFrame.tsx draws the per-device hardware
  shared/                typed messages, IndexedDB store, audit pipeline
packages/                one workspace package per concern
  audit-core  dom-analyzer  css-analyzer  layout-analyzer  responsive-analyzer
  performance-analyzer  image-analyzer  bundle-analyzer  accessibility-analyzer
  color-analyzer  typography-analyzer  ux-analyzer  screenshot-engine  recommendation-engine
  asset-extractor   (asset discovery, naming, ZIP builder)
tests/
  unit/   vitest — pure analyzers, planners, pipeline
  e2e/    puppeteer — real browser with the built extension (fixture + live production sites)
```

Collectors run in the page and return plain JSON; **analyzers are pure functions** (data in, findings out), so rules are unit-tested without a browser. The `recommendation-engine` maps every rule id to guidance, ranks findings, and is itself tested to cover every rule an analyzer can emit.

## Development

```bash
pnpm dev           # rebuild on change (reload the extension in chrome://extensions)
pnpm test          # unit tests
pnpm typecheck
pnpm e2e           # builds, then drives the extension in a real browser against fixture pages (shadow DOM, cross-origin CSS, inner scroller, 20 000 px page, Apple/49″/TV emulation, asset extraction with real ZIP verification, responsive UI)
pnpm e2e:prod      # same workflow against live production sites (needs network)
```

The e2e scripts look for Chrome, Chromium or Brave (`CHROME_PATH` overrides). They pass `--disable-features=DisableLoadExtensionCommandLineSwitch`, which Chrome 137+ needs to honour `--load-extension`.

### Device simulator and frames

**Open simulator** (Responsive tab) opens a full-window preview of the page at any preset's exact CSS size, drawn inside a hardware frame. The frame toggle in the toolbar switches back to the bare viewport (the choice is remembered).

| Device              | Frame                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phones              | Metal rim (steel-blue on Apple, graphite elsewhere), side buttons, and the right camera style per model: Dynamic Island (iPhone 14 Pro and later, Air), notch (iPhone X to 14, 17e), punch-hole (Android) or a home button (iPhone SE). A status bar (live clock, signal, Wi-Fi, battery) sits above the page and a browser address strip with the site's host and a home indicator sits below it |
| Tablets             | Thin bezel, front camera, side buttons, status bar and home indicator; the iPad 10.2″ keeps its home button                                                                                                                                                                                                                                                                                       |
| Laptops             | Lid with camera and a wider base with a trackpad lip                                                                                                                                                                                                                                                                                                                                              |
| Desktops, ultrawide | Slim bezel and a stand; the iMac also gets its chin                                                                                                                                                                                                                                                                                                                                               |
| TVs                 | Near-bezel-less panel on two feet                                                                                                                                                                                                                                                                                                                                                                 |

Rotating a phone or tablet moves the camera cutout to the side and the buttons to the other edges. The status bar and address strip are drawn _outside_ the page, so the page still sees exactly the preset's width and height. Each preset can set a `cutout` (`island`, `notch`, `punch`, `home-button`, `none`) in `packages/responsive-analyzer`; phones default to `punch`.

## How the harder cases are handled

- **Pages that scroll inside a container** (app-shell layouts with `overflow: auto` on a panel): the capture follows the largest inner scroller and tells you what was included.
- **Very tall pages**: browsers cap a canvas at 16 384 px per side. Instead of shrinking the image, the capture is saved as several full-resolution parts (`…-part1of2.png`); only a page too _wide_ for one canvas is scaled.
- **Shadow DOM**: open shadow roots are audited, and elements inside them get `host >>> inner` selectors that the highlighter, inspector and element screenshots all understand.
- **Cross-origin stylesheets**: pages cannot read these through the CSSOM, so the service worker fetches their text and the toolkit parses breakpoints, design tokens and focus-outline removals from it.
- **Stalls**: every page and browser call has a timeout, so a busy or navigating page produces an error message rather than a frozen panel.

## Known limits

- **Assets**: files used only inside iframes, `::before/::after` background images that never loaded, and CSS referenced from other CSS (`@import`) are not discovered; blob: URLs cannot be downloaded. Please only download assets you have the right to use.
- **Iframes** are not audited (they do appear in screenshots), and **closed** shadow roots cannot be entered. Fixed elements inside shadow roots are not de-duplicated in full-page captures.
- **Matched rules** in the Inspector still omit cross-origin stylesheets (their text is parsed for breakpoints, tokens and focus rules, but not matched per element); computed styles are always exact.
- Automated accessibility checks cover only part of WCAG; contrast over images/gradients is reported as "unverifiable", not guessed.
- The Device Simulator frames the page in an `<iframe>` and draws the hardware around it with CSS (no photographic assets), so frames are faithful in layout and camera style but not pixel-exact copies of each model, so cookies the site marks `SameSite` may not be sent (you can appear logged out), the framed page's own `navigator.userAgent` stays the desktop one (servers see the phone UA), and the pixel ratio shown is nominal. Use the panel's _Test_ / _Screenshot_ buttons, which emulate the real tab, when you need exact behaviour.
- Device emulation uses the DevTools protocol, so Chrome shows its "debugging" bar while it's on, and it can't attach if another extension already holds the tab's debugger. Emulated viewports larger than the real screen render correctly, but screenshots of 5120 px-wide pages are large files.
- Chrome allows ~2 `captureVisibleTab` calls per second, so very tall pages take a few seconds.
- Not yet implemented from the PRD's later phases: DevTools panel integration, CSS/JS coverage, screenshot annotation, shareable reports, and the optional AI layer.

## Privacy & permissions

Everything stays on your machine — see [PRIVACY.md](PRIVACY.md) for the full statement and a justification of each permission.

## Product spec

The original product requirements live in [docs/PRD.md](docs/PRD.md).

## License

[MIT](LICENSE)
