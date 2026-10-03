# Changelog

## 0.1.1

### Added
- Device simulator now draws every device inside a realistic hardware frame: phones (metal rim, side buttons, Dynamic Island / notch / punch-hole / home button, status bar with live clock, browser address strip, home indicator), tablets, laptops (lid and base), desktops and ultrawides (bezel and stand, iMac chin) and TVs (panel on feet).
- Landscape rotation moves the camera cutout and buttons to the matching edges.
- Optional `cutout` field on device presets and a `cutoutFor()` helper in `@ftk/responsive-analyzer`, with unit tests.

### Changed
- The Frame toggle now switches between the full hardware frame and the bare viewport; the page viewport is still exactly the preset's width x height.

## 0.1.0

- Initial release: Chrome MV3 side-panel Frontend Quality Toolkit, asset extractor, 73-device reference and responsive UI.
