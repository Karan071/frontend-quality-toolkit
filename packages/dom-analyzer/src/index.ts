export interface Sides {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface StyleEntry {
  prop: string;
  value: string;
}

export interface MatchedRule {
  selector: string;
  source: string;
  declarations: StyleEntry[];
  media: string | null;
}

export interface ElementInfo {
  selector: string;
  tag: string;
  id: string | null;
  classes: string[];
  text: string;
  /** Viewport-relative box. */
  rect: { x: number; y: number; width: number; height: number };
  box: { margin: Sides; border: Sides; padding: Sides; content: { width: number; height: number } };
  styles: { group: string; entries: StyleEntry[] }[];
  attributes: StyleEntry[];
  a11y: { role: string | null; name: string };
  path: { selector: string; label: string }[];
  childCount: number;
  hasParent: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  /** Present when the element directly contains text. */
  contrast: { ratio: number; fg: string; bg: string | null; uncertain: boolean; fontSize: number } | null;
  inFixedContext: boolean;
}

export const STYLE_GROUPS: { group: string; props: string[] }[] = [
  {
    group: 'Layout',
    props: [
      'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'float', 'overflow-x', 'overflow-y',
      'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-self', 'flex', 'gap',
      'grid-template-columns', 'grid-template-rows', 'grid-area', 'aspect-ratio',
    ],
  },
  {
    group: 'Box',
    props: [
      'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'box-sizing',
      'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
      'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
      'border-top-width', 'border-style', 'border-color',
    ],
  },
  {
    group: 'Typography',
    props: [
      'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
      'text-align', 'text-transform', 'text-decoration-line', 'white-space', 'word-break',
    ],
  },
  {
    group: 'Visual',
    props: [
      'background-color', 'background-image', 'opacity', 'border-radius', 'box-shadow', 'transform',
      'filter', 'cursor', 'visibility', 'pointer-events', 'outline',
    ],
  },
];

export function elementLabel(tag: string, id: string | null, classes: string[]): string {
  return tag + (id ? `#${id}` : '') + classes.slice(0, 2).map((c) => `.${c}`).join('');
}
