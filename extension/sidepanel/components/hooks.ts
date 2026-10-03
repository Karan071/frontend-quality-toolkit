import type { Category, EnrichedFinding } from '@ftk/audit-core';
import type { RouteId } from '../state';
import { currentAudit, useApp } from '../state';

export const CATEGORY_ROUTE: Record<Category, RouteId> = {
  performance: 'performance',
  responsive: 'responsive',
  accessibility: 'accessibility',
  images: 'images',
  bundles: 'bundles',
  uxui: 'uxui',
};

/** Current app state plus the audit for the active tab and a per-category selector. */
export function useAuditView() {
  const app = useApp();
  const audit = currentAudit(app);
  const by = (category: Category): EnrichedFinding[] => audit?.findings.filter((f) => f.category === category) ?? [];
  return { app, audit, by };
}
