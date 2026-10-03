/**
 * The contract shared by every analyzer.
 *
 * Collectors run inside the page and produce plain, JSON-serialisable data.
 * Analyzers are pure functions: data in, Finding[] out. That split keeps the
 * rules unit-testable without a browser.
 */

export type Severity = 'error' | 'warning' | 'info';

export type Category =
  | 'performance'
  | 'responsive'
  | 'accessibility'
  | 'images'
  | 'bundles'
  | 'uxui';

export const CATEGORIES: Category[] = [
  'performance',
  'responsive',
  'accessibility',
  'images',
  'bundles',
  'uxui',
];

export const CATEGORY_LABEL: Record<Category, string> = {
  performance: 'Performance',
  responsive: 'Responsive',
  accessibility: 'Accessibility',
  images: 'Images',
  bundles: 'Bundles',
  uxui: 'UI / UX',
};

export type EvidenceValue = string | number | boolean | null;

export interface TempFix {
  label: string;
  css: string;
}

export interface Finding {
  /** Stable across runs for the same problem on the same element/resource. */
  id: string;
  ruleId: string;
  category: Category;
  severity: Severity;
  title: string;
  /** Specific, evidence-bearing sentence. */
  message: string;
  /** Elements to highlight. May be a truncated sample of `count`. */
  selectors?: string[];
  /** Total number of affected elements/resources. */
  count?: number;
  url?: string;
  evidence?: Record<string, EvidenceValue>;
  /** A CSS-only change that can be previewed on the live page. */
  fix?: TempFix;
}

export interface Recommendation {
  why: string;
  how: string[];
  /** Higher sorts first. */
  priority: number;
}

export interface EnrichedFinding extends Finding {
  recommendation: Recommendation;
}

// ───────────────────────────── Raw snapshot data ─────────────────────────────

export interface ViewportInfo {
  width: number;
  height: number;
  dpr: number;
  clientWidth: number;
  scrollWidth: number;
  scrollHeight: number;
  scrollX: number;
  scrollY: number;
}

export interface PageMeta {
  url: string;
  title: string;
  lang: string | null;
  viewportMeta: string | null;
  description: string | null;
  hasFavicon: boolean;
  hasDoctype: boolean;
  charset: string | null;
  elementCount: number;
  maxDepth: number;
}

export interface ImageSample {
  selector: string;
  kind: 'img' | 'bg';
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  renderedWidth: number;
  renderedHeight: number;
  hasAltAttr: boolean;
  alt: string | null;
  loading: string | null;
  fetchPriority: string | null;
  srcset: string | null;
  sizes: string | null;
  inPicture: boolean;
  hasWidthAttr: boolean;
  hasHeightAttr: boolean;
  hasAspectRatio: boolean;
  /** Document-space y of the top edge. */
  top: number;
  aboveFold: boolean;
  complete: boolean;
  /** Presentational: alt="" or role=presentation. */
  decorative: boolean;
  /** Filled in from resource timing / probing. */
  bytes?: number;
  contentType?: string;
}

export type ResourceType = 'script' | 'css' | 'image' | 'font' | 'media' | 'fetch' | 'other';

export interface ResourceSample {
  url: string;
  type: ResourceType;
  host: string;
  thirdParty: boolean;
  transferSize: number;
  encodedSize: number;
  decodedSize: number;
  duration: number;
  startTime: number;
  protocol: string;
  renderBlocking: boolean;
  /** Size fields from Resource Timing are zero for opaque cross-origin responses. */
  sizeKnown: boolean;
  /** Filled by the size probe when sizeKnown is false. */
  probe?: ProbeInfo;
}

export interface ProbeInfo {
  size?: number;
  contentType?: string;
  contentEncoding?: string;
  cacheControl?: string;
}

export interface ScriptSample {
  src: string | null;
  inlineBytes: number;
  async: boolean;
  defer: boolean;
  module: boolean;
  inHead: boolean;
  selector: string;
}

export interface StylesheetSample {
  href: string | null;
  inlineBytes: number;
  media: string | null;
  inHead: boolean;
  accessible: boolean;
  ruleCount: number | null;
}

export interface OverflowCulprit {
  selector: string;
  tag: string;
  right: number;
  width: number;
  /** Computed width is an absolute px value larger than the viewport. */
  fixedWidth: boolean;
}

export interface OverflowData {
  hasHorizontalScroll: boolean;
  scrollWidth: number;
  clientWidth: number;
  culprits: OverflowCulprit[];
  culpritCount: number;
}

export interface TextSample {
  selector: string;
  text: string;
  fg: string;
  /** null when the background could not be resolved (image / gradient). */
  bg: string | null;
  bgUncertain: boolean;
  fontSize: number;
  fontWeight: number;
  count: number;
  extraSelectors: string[];
}

export type ControlKind = 'input' | 'select' | 'textarea' | 'button' | 'link' | 'role-button';

export interface ControlSample {
  selector: string;
  tag: string;
  kind: ControlKind;
  inputType: string | null;
  name: string;
  placeholderOnly: boolean;
  autocomplete: string | null;
}

export interface TargetSample {
  selector: string;
  width: number;
  height: number;
  kind: string;
  display: string;
}

export interface AriaIssue {
  kind:
    | 'hidden-focusable'
    | 'positive-tabindex'
    | 'duplicate-id'
    | 'broken-reference'
    | 'invalid-role';
  selector: string;
  detail: string;
}

export interface HeadingSample {
  level: number;
  text: string;
  selector: string;
}

export interface A11yData {
  controls: ControlSample[];
  headings: HeadingSample[];
  landmarks: { main: number; nav: number; header: number; footer: number };
  targets: TargetSample[];
  ariaIssues: AriaIssue[];
  focusRules: { selector: string; source: string }[];
  clickableNotFocusable: { selector: string; tag: string }[];
  zoomDisabled: boolean;
  text: TextSample[];
}

export interface ColorUse {
  value: string;
  role: 'text' | 'background' | 'border';
  count: number;
}

export interface TypographyData {
  families: { family: string; count: number }[];
  sizes: { px: number; count: number }[];
  weights: { weight: number; count: number }[];
  /** Paragraph-like blocks used for line-height / measure checks. */
  blocks: {
    selector: string;
    fontSize: number;
    lineHeightRatio: number;
    charsPerLine: number;
    width: number;
  }[];
  /** Text rendered smaller than 12 CSS px. */
  smallText: { selector: string; fontSize: number }[];
}

export interface SpacingData {
  values: { px: number; count: number }[];
  radii: { px: number; count: number }[];
}

export interface ButtonSample {
  selector: string;
  bg: string;
  color: string;
  radius: number;
  padX: number;
  padY: number;
  fontSize: number;
  fontWeight: number;
  hasBorder: boolean;
}

export interface LinkSample {
  selector: string;
  text: string;
  href: string;
}

export interface UxData {
  buttons: ButtonSample[];
  links: LinkSample[];
  hashLinkCount: number;
  forms: { selector: string; hasSubmit: boolean; inputCount: number }[];
}

export interface DesignToken {
  name: string;
  value: string;
  kind: 'color' | 'size' | 'font' | 'other';
}

export interface CssData {
  stylesheets: StylesheetSample[];
  breakpoints: Breakpoint[];
  tokens: DesignToken[];
  inaccessibleSheets: number;
}

export interface Breakpoint {
  px: number;
  kind: 'min' | 'max';
  /** Number of media rules that reference it. */
  uses: number;
}

export interface LcpInfo {
  value: number;
  selector: string | null;
  url: string | null;
  size: number;
  tag: string | null;
}

export interface LayoutShift {
  value: number;
  time: number;
  selectors: string[];
}

export interface VitalsSnapshot {
  lcp: LcpInfo | null;
  cls: number;
  shifts: LayoutShift[];
  inp: { value: number; selector: string | null; type: string } | null;
  fcp: number | null;
  ttfb: number | null;
  domContentLoaded: number | null;
  load: number | null;
  longTasks: { start: number; duration: number }[];
  tbt: number;
  navigationType: string | null;
  /** The collector started after navigation, so early entries may be missing. */
  partial: boolean;
}

export interface PageSnapshot {
  takenAt: number;
  meta: PageMeta;
  viewport: ViewportInfo;
  images: ImageSample[];
  resources: ResourceSample[];
  scripts: ScriptSample[];
  css: CssData;
  overflow: OverflowData;
  a11y: A11yData;
  typography: TypographyData;
  colors: ColorUse[];
  spacing: SpacingData;
  ux: UxData;
  vitals: VitalsSnapshot;
}

export type CollectKind =
  | 'meta'
  | 'images'
  | 'resources'
  | 'css'
  | 'overflow'
  | 'a11y'
  | 'styles'
  | 'vitals';

export const ALL_KINDS: CollectKind[] = [
  'meta',
  'images',
  'resources',
  'css',
  'overflow',
  'a11y',
  'styles',
  'vitals',
];

// ───────────────────────────── Walk visitors ─────────────────────────────

/** Context handed to each visitor during the single DOM walk. */
export interface WalkContext {
  el: Element;
  style: CSSStyleDeclaration;
  rect(): DOMRect;
  selector(): string;
  /** True when the element is rendered and has a non-empty box. */
  visible(): boolean;
}

export interface Visitor<T> {
  visit(ctx: WalkContext): void;
  result(): T;
}
