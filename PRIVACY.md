# Privacy

Frontend Quality Toolkit runs entirely in your browser.

- **No servers.** The extension has no backend, no analytics, no telemetry and no remote code. Nothing about the pages you inspect, and none of your screenshots, is sent anywhere.
- **Screenshots stay local.** They are stored in your browser's IndexedDB (extension origin), capped at the 40 most recent, and can be deleted from the Screenshots tab.
- **Settings** (theme, screenshot format and quality) are stored with `chrome.storage.local`.
- **Network requests the extension makes:** only `HEAD`/`Range: bytes=0-0` requests (no cookies, `credentials: omit`) to resources the inspected page already loaded, to read their `Content-Length` when the browser hides it for cross-origin files. These are sent from your machine to those same hosts; they carry no page content.
- **Fonts are bundled** (Inter, Geist, Geist Mono); no font CDN is contacted.
- **Cleanup.** Temporary CSS, overlays and device emulation are removed when you close the side panel or reload the tab.

## Why each permission is requested

| Permission | Used for |
| --- | --- |
| `sidePanel` | Showing the toolkit in Chrome's side panel. |
| `scripting` | Injecting the content script into tabs that were open before the extension was installed or reloaded. |
| `storage` | Saving your theme and screenshot preferences. |
| `debugger` | Responsive Lab device emulation (`Emulation.setDeviceMetricsOverride`) and capturing background tabs. Chrome shows its "is debugging this browser" bar while this is active; it is detached when you reset or close the panel. |
| `<all_urls>` (host) | Running on whatever site you open the panel on, and probing sizes of that page's cross-origin resources. The content script is passive until the panel talks to it. |
