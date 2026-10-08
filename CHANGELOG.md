# Changelog

## Unreleased

### Security

- The extension no longer requests local-network addresses on a page's behalf. Size probes, stylesheet fetches, asset downloads and thumbnails skip loopback, private, link-local and intranet hosts, and `file:`/`ftp:` targets, unless the inspected page is itself local.
- Design-token values are validated before being used as inline styles, so a stylesheet can no longer make the panel request a URL through `hsl(...) url(...)`.
- CSS parsing is linear-time. A crafted 800 KB stylesheet could previously freeze the panel for minutes.
- Downloads and stylesheet reads are streamed and capped (50 MB per file, 500 MB per ZIP, 800 KB per stylesheet), including decompressed size.
- The service worker only accepts messages from the extension's own pages, and validates tab ids and emulation sizes. Broadcasts can no longer name another tab.
- ZIP and download file names are re-sanitized at the archive boundary (Windows device names, trailing dots, runnable extensions).
- Full-page capture is capped at 20 000 px wide as well as 40 000 px tall.
- Query strings and fragments are removed from saved screenshot metadata and from exported audit and `assets.json` page URLs. Markdown exports escape page-derived text.
- The simulator frame no longer delegates clipboard access to the previewed site.

### Changed

- Dev tooling: `vitest` 5 and `puppeteer-core` 25 (clears the open `pnpm audit` advisories), `@types/node` added explicitly. The stale `package-lock.json` is removed; the project uses pnpm. CI actions are pinned to commit SHAs and Dependabot is enabled. ESLint now forbids `eval`-style APIs.

## 0.1.3

- Chrome Web Store description shortened to fit the 132-character limit.
- Release governance and per-release notes documented.

## 0.1.1

### Added

- Device simulator now draws every device inside a realistic hardware frame: phones (metal rim, side buttons, Dynamic Island / notch / punch-hole / home button, status bar with live clock, browser address strip, home indicator), tablets, laptops (lid and base), desktops and ultrawides (bezel and stand, iMac chin) and TVs (panel on feet).
- Landscape rotation moves the camera cutout and buttons to the matching edges.
- Optional `cutout` field on device presets and a `cutoutFor()` helper in `@ftk/responsive-analyzer`, with unit tests.

### Changed

- The Frame toggle now switches between the full hardware frame and the bare viewport; the page viewport is still exactly the preset's width x height.

## 0.1.0

- Initial release: Chrome MV3 side-panel Frontend Quality Toolkit, asset extractor, 73-device reference and responsive UI.
