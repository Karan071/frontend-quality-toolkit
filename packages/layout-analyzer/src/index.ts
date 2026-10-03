export interface PositionedElement {
  selector: string;
  kind: 'fixed' | 'sticky';
  /** Which half of the viewport the element is anchored to. */
  anchor: 'top' | 'bottom';
  rect: { x: number; y: number; width: number; height: number };
}

/**
 * Which edge a fixed/sticky element belongs to. Touching an edge wins (a
 * full-height sidebar is "top"); otherwise the half containing its centre.
 */
export function anchorOf(rect: { y: number; height: number }, viewportHeight: number): 'top' | 'bottom' {
  if (rect.y <= 2) return 'top';
  if (rect.y + rect.height >= viewportHeight - 2) return 'bottom';
  return rect.y + rect.height / 2 < viewportHeight / 2 ? 'top' : 'bottom';
}
