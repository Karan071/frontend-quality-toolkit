# Frontend Quality Toolkit

## 1. Product Overview

Frontend Quality Toolkit is a browser extension for frontend developers that combines:

* DOM and CSS inspection
* Responsive testing
* Core Web Vitals
* Image optimization auditing
* CSS and JavaScript bundle auditing
* Accessibility auditing
* Color theory analysis
* Typography analysis
* UI consistency analysis
* Basic UX auditing
* Performance best-practice recommendations
* Screenshot capture
* Temporary fixes and before/after verification

The product is designed to operate primarily inside the browser through a compact Chrome Side Panel.

The first version must work without an LLM.

AI is an optional future layer.

---

# 2. Product Goals

The product should allow a frontend developer to:

1. Inspect a website.
2. Understand its layout and CSS.
3. Test responsive behavior.
4. Measure Web Vitals.
5. Find bloated images.
6. Find oversized CSS and JavaScript resources.
7. Identify accessibility problems.
8. Analyze basic UI/UX patterns.
9. Receive practical recommendations.
10. Preview temporary fixes.
11. Capture viewport and full-page screenshots.
12. Compare before and after states.
13. Export useful findings.
14. Perform the workflow without leaving the browser.

---

# 3. Product Architecture

```text
                         Browser
                            |
                            v
                  Chrome Extension MV3
                            |
          +-----------------+-----------------+
          |                                   |
          v                                   v
     Chrome Side Panel                   Content Script
          |                                   |
          |                                   v
          |                             Page Analyzer
          |                                   |
          |             +---------------------+--------------------+
          |             |          |          |         |          |
          |             v          v          v         v          v
          |            DOM        CSS       Layout    Images      A11y
          |             |          |          |         |          |
          |             +----------+----------+---------+----------+
          |                                   |
          |                                   v
          |                            Audit Engine
          |                                   |
          |                    +--------------+--------------+
          |                    |              |              |
          |                    v              v              v
          |               Performance    Responsive       UI/UX
          |                    |              |              |
          |                    +--------------+--------------+
          |                                   |
          |                                   v
          |                         Recommendation Engine
          |                                   |
          +----------------------+------------+
                                 |
                                 v
                           Screenshot Engine
                                 |
                                 v
                          Export / Comparison
```

---

# 4. Main Navigation

The Side Panel should expose:

```text
Overview
Inspect
Responsive
Performance
Images
Bundles
Accessibility
UI / UX
Screenshots
```

The UI must work at approximately:

```text
Minimum:     280px
Preferred:   320-420px
```

No core workflow should require a wide desktop dashboard.

---

# 5. Screenshot Module

## 5.1 Purpose

Allow developers to capture the current webpage directly from the extension without opening another screenshot application.

The screenshot system should support:

```text
Viewport
Full Page
Element
```

---

# 6. Viewport Screenshot

## Definition

Capture exactly the currently visible browser viewport.

Example:

```text
┌─────────────────────────────┐
│                             │
│       CURRENT VIEW          │
│                             │
│       390 × 844             │
│                             │
└─────────────────────────────┘
```

The screenshot should represent the rendered page at the current viewport.

## UI

```text
Screenshots

[ Viewport Screenshot ]

Format:
[ PNG ▼ ]

[ Capture ]
```

After capture:

```text
Screenshot captured

390 × 844

[ Copy ]
[ Save ]
[ Open ]
```

---

# 7. Full Page Screenshot

## Definition

Capture the entire scrollable webpage rather than only the visible viewport.

Example:

```text
Visible viewport

┌───────────────────┐
│                   │
│      HEADER       │
│                   │
├───────────────────┤
│      HERO         │
│                   │
└───────────────────┘
        ↓
        ↓
        ↓
        ↓
┌───────────────────┐
│      FOOTER       │
└───────────────────┘
```

Output:

```text
Full page:
1440 × 6840
```

This is especially useful for:

* design review
* bug reports
* documentation
* portfolio review
* responsive comparisons
* before/after analysis

---

# 8. Full Page Capture Requirements

The screenshot engine should account for:

* page height
* fixed headers
* sticky navigation
* fixed bottom bars
* lazy-loaded images
* dynamically loaded content
* animations
* videos
* iframes
* horizontal overflow

The implementation should avoid simply stitching arbitrary screenshots without handling fixed/sticky elements, because those elements can appear repeatedly in the final image.

---

# 9. Screenshot Capture Strategy

The extension should use browser-supported capture mechanisms where possible.

Conceptually:

```text
Current Page
     |
     v
Determine viewport
     |
     v
Determine document dimensions
     |
     v
Capture viewport(s)
     |
     v
Handle scroll position
     |
     v
Prevent duplicate fixed elements
     |
     v
Stitch / compose
     |
     v
Final screenshot
```

For large pages, the implementation should avoid creating unnecessarily large intermediate images.

---

# 10. Element Screenshot

Because the product already has an inspector, allow:

```text
Hover element
      ↓
Select element
      ↓
[ Screenshot Element ]
```

Example:

```text
Selected:

.hero-card

Dimensions:
640 × 420

[ Capture Element ]
```

Output:

```text
640 × 420 PNG
```

This is useful for:

* sharing a component
* reporting UI bugs
* documenting a component
* design review
* comparing component states

---

# 11. Screenshot Formats

Initial support:

```text
PNG
JPEG
```

Future:

```text
WebP
```

Allow configurable JPEG quality.

Example:

```text
Format:
JPEG

Quality:
80%
```

---

# 12. Screenshot Naming

Automatically generate useful names.

Example:

```text
example-com-viewport-390x844.png

example-com-fullpage-1440x6840.png

example-com-element-hero-card.png
```

---

# 13. Screenshot Context

Each screenshot should optionally store metadata:

```json
{
  "url": "https://example.com",
  "viewport": {
    "width": 390,
    "height": 844
  },
  "deviceMode": "mobile",
  "timestamp": "...",
  "type": "viewport"
}
```

This allows screenshots to remain useful for audit comparisons.

---

# 14. Screenshot + Responsive Lab

The screenshot module should integrate directly with Responsive Lab.

Example:

```text
Responsive Lab

Mobile
390 × 844

[ Test ]
[ Screenshot ]
```

Then:

```text
Tablet
768 × 1024

[ Test ]
[ Screenshot ]
```

Then:

```text
Desktop
1440 × 900

[ Test ]
[ Screenshot ]
```

The developer can capture each state.

---

# 15. Screenshot Comparison

Add a future comparison mode:

```text
Before                After

┌────────────┐       ┌────────────┐
│            │       │            │
│   OLD      │  →    │   NEW      │
│            │       │            │
└────────────┘       └────────────┘
```

Modes:

```text
Side by side
Overlay
Difference
Slider
```

This is especially useful after applying temporary CSS fixes.

---

# 16. Screenshot + Audit Workflow

A developer should be able to:

```text
Run Audit
    ↓
Find responsive problem
    ↓
Highlight element
    ↓
Apply temporary fix
    ↓
Capture screenshot
    ↓
Remove fix
    ↓
Compare
```

This turns screenshots into part of the debugging workflow rather than an isolated feature.

---

# 17. Screenshot + UI/UX Audit

Allow screenshots to be attached to findings.

Example:

```text
Accessibility Issue

Low contrast CTA

[ Highlight ]
[ Screenshot ]
```

The screenshot can capture the exact visual state associated with the issue.

---

# 18. Screenshot + Performance

A performance report can include:

```text
Performance Test

LCP: 3.4s
INP: 224ms
CLS: 0.16

[ Capture Viewport ]
```

This makes it possible to document what the user actually saw when the test was run.

---

# 19. Screenshot Export

Initial options:

```text
[ Copy to Clipboard ]
[ Save PNG ]
[ Save JPEG ]
```

Future:

```text
[ Export Audit Report ]
[ Export PDF ]
[ Export Markdown ]
```

---

# 20. Screenshot Privacy

Screenshots should remain local by default.

The extension must not upload screenshots to a server unless the user explicitly enables a feature that requires it.

The default workflow is:

```text
Page
 ↓
Browser
 ↓
Extension
 ↓
Local screenshot
 ↓
User saves/copies
```

---

# 21. Updated Overview Dashboard

The main dashboard should now expose:

```text
┌────────────────────────────┐
│ Frontend Toolkit           │
│ example.com                │
├────────────────────────────┤
│                            │
│ Performance                │
│ 3 warnings                 │
│                            │
│ Responsive                 │
│ 4 issues                   │
│                            │
│ Accessibility              │
│ 2 issues                   │
│                            │
│ Images                     │
│ 8 issues                   │
│                            │
│ Bundles                    │
│ 3 warnings                 │
│                            │
├────────────────────────────┤
│                            │
│ [ Run Full Audit ]         │
│                            │
│ [ Screenshot ]             │
└────────────────────────────┘
```

---

# 22. Updated Core Workflow

```text
Open Website
      |
      v
Open Frontend Toolkit
      |
      v
Run Audit
      |
      v
17 Findings
      |
      +---- Performance
      +---- Responsive
      +---- Accessibility
      +---- Images
      +---- CSS
      +---- JavaScript
      +---- UI/UX
      |
      v
Select Finding
      |
      v
Highlight Element
      |
      v
Understand Evidence
      |
      v
Apply Temporary Fix
      |
      v
Rerun Test
      |
      v
Capture Screenshot
      |
      v
Compare Before / After
```

---

# 23. Updated V1 Scope

V1 should contain:

```text
✓ Chrome MV3
✓ Side Panel
✓ DOM Inspector
✓ Box Model
✓ Computed Styles
✓ Responsive Testing
✓ Overflow Detection
✓ Core Web Vitals
✓ Image Audit
✓ CSS Resource Audit
✓ JavaScript Resource Audit
✓ Basic Accessibility
✓ Color Audit
✓ Typography Audit
✓ Spacing Audit
✓ Issue Highlighting
✓ Recommendation Engine
✓ Viewport Screenshot
✓ Full Page Screenshot
✓ Element Screenshot
```

---

# 24. V1.5

```text
✓ Breakpoint Discovery
✓ Design Token Discovery
✓ UI Consistency
✓ Bundle Categorization
✓ Third-party Analysis
✓ Performance Timeline
✓ Screenshot Comparison
✓ Temporary CSS Fixes
✓ Before/After Measurements
✓ Audit Export
```

---

# 25. V2

```text
✓ Advanced DevTools Integration
✓ CSS Coverage
✓ JavaScript Coverage
✓ Advanced Bundle Analysis
✓ Image Optimization Pipeline
✓ Advanced Responsive Diagnostics
✓ Screenshot Annotation
✓ Shareable Audit Reports
```

---

# 26. V3: AI Layer

AI remains optional.

Potential capabilities:

```text
Explain this performance issue

Explain why this breaks on mobile

Suggest a responsive implementation

Suggest a CSS fix

Explain this UI inconsistency

Generate accessible markup

Convert recommendation into code
```

The AI should consume structured audit results rather than receiving the entire webpage by default.

---

# 27. Development Architecture

```text
frontend-toolkit/
│
├── extension/
│   ├── manifest.json
│   ├── service-worker.ts
│   │
│   ├── content/
│   │   ├── content.ts
│   │   ├── inspector.ts
│   │   ├── overlay.ts
│   │   ├── screenshot.ts
│   │   └── page-bridge.ts
│   │
│   ├── sidepanel/
│   │   ├── App.tsx
│   │   ├── routes/
│   │   └── components/
│   │
│   └── devtools/
│       ├── devtools.ts
│       └── network.ts
│
├── packages/
│   ├── audit-core/
│   ├── dom-analyzer/
│   ├── css-analyzer/
│   ├── layout-analyzer/
│   ├── responsive-analyzer/
│   ├── performance-analyzer/
│   ├── image-analyzer/
│   ├── bundle-analyzer/
│   ├── accessibility-analyzer/
│   ├── color-analyzer/
│   ├── typography-analyzer/
│   ├── ux-analyzer/
│   ├── screenshot-engine/
│   └── recommendation-engine/
│
└── tests/
    ├── unit/
    ├── fixtures/
    └── e2e/
```

---

# 28. Recommended Build Order

## Sprint 1: Extension Foundation

```text
Manifest V3
Side Panel
Service Worker
Content Script
Messaging
Tab lifecycle
```

## Sprint 2: Inspector

```text
DOM
Computed styles
Box model
Overlay
Element selection
```

## Sprint 3: Responsive Lab

```text
Viewport modes
Overflow detection
Responsive image detection
Breakpoint testing
```

## Sprint 4: Performance Lab

```text
PerformanceObserver
LCP
CLS
INP
FCP
TTFB
Long Tasks
```

## Sprint 5: Image Audit

```text
Image discovery
Dimensions
File sizes
Formats
srcset
sizes
lazy loading
CLS relationships
```

## Sprint 6: Bundle Audit

```text
CSS resources
JS resources
Resource sizes
Timing
Third-party resources
Large bundle detection
```

## Sprint 7: Accessibility

```text
Contrast
Labels
Alt text
ARIA
Headings
Focus
Keyboard
Touch targets
```

## Sprint 8: UI/UX

```text
Colors
Typography
Spacing
Component consistency
Basic UX observations
Design tokens
```

## Sprint 9: Screenshot Engine

```text
Viewport capture
Full-page capture
Element capture
PNG/JPEG
Save/copy
```

## Sprint 10: Fix + Verify

```text
Temporary CSS injection
Before/after metrics
Screenshot comparison
Issue resolution state
```

## Sprint 11: Polish

```text
Small-panel UX
Performance
Caching
Error handling
Testing
Accessibility of extension itself
```

---

# 29. Screenshot UX

The screenshot control should be available globally:

```text
┌──────────────────────────┐
│ Frontend Toolkit         │
├──────────────────────────┤
│                          │
│ [ Full Page Screenshot ] │
│ [ Viewport Screenshot ]  │
│ [ Element Screenshot ]   │
│                          │
└──────────────────────────┘
```

When an element is selected:

```text
Selected:
.hero-card

[ Screenshot Element ]
```

When Responsive Lab is active:

```text
390 × 844

[ Screenshot ]
```

The user should never need to navigate to a separate screenshot application.

---

# 30. Definition of Done

The screenshot functionality is complete when a developer can:

1. Capture the current viewport.
2. Capture the entire webpage.
3. Capture a selected element.
4. Save PNG.
5. Save JPEG.
6. Copy the screenshot.
7. Capture at mobile viewport sizes.
8. Capture at desktop viewport sizes.
9. Capture after a temporary CSS fix.
10. Compare screenshots later.
11. Use screenshot functionality entirely from the Side Panel.
12. Capture screenshots without uploading page content to a server.

---

# 31. Product Principle

The complete product loop is:

```text
INSPECT
   ↓
MEASURE
   ↓
AUDIT
   ↓
DETECT
   ↓
EXPLAIN
   ↓
RECOMMEND
   ↓
FIX
   ↓
VERIFY
   ↓
CAPTURE
   ↓
COMPARE
```

The screenshot system is therefore part of the development workflow, not simply a separate utility.
