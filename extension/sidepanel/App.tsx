import { useEffect, useRef } from 'react';
import type { ComponentType } from 'react';
import { CATEGORIES } from '@ftk/audit-core';
import type { Category } from '@ftk/audit-core';
import { cycleTheme, init, navigate } from './actions';
import { ScreenshotBar } from './components/ScreenshotBar';
import { Banner, Button, Spinner } from './components/ui';
import { Accessibility } from './routes/Accessibility';
import { Bundles } from './routes/Bundles';
import { Images } from './routes/Images';
import { Inspect } from './routes/Inspect';
import { Overview } from './routes/Overview';
import { Performance } from './routes/Performance';
import { Responsive } from './routes/Responsive';
import { Screenshots } from './routes/Screenshots';
import { UiUx } from './routes/UiUx';
import { ROUTES, currentAudit, useApp } from './state';
import type { RouteId } from './state';

const VIEWS: Record<RouteId, ComponentType> = {
  overview: Overview,
  inspect: Inspect,
  responsive: Responsive,
  performance: Performance,
  images: Images,
  bundles: Bundles,
  accessibility: Accessibility,
  uxui: UiUx,
  screenshots: Screenshots,
};

const TAB_CATEGORY: Partial<Record<RouteId, Category>> = {
  performance: 'performance',
  responsive: 'responsive',
  images: 'images',
  bundles: 'bundles',
  accessibility: 'accessibility',
  uxui: 'uxui',
};

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="7" fill="var(--primary)" />
      <path d="M6.5 9V6.5H9M15 6.5h2.5V9M17.5 15v2.5H15M9 17.5H6.5V15" stroke="var(--primary-foreground)" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="1.9" fill="var(--primary-foreground)" />
    </svg>
  );
}

const THEME_ICON = { system: 'monitor', light: 'sun', dark: 'moon' } as const;

export function App() {
  const app = useApp();
  const tablist = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void init();
  }, []);

  const audit = currentAudit(app);
  const View = VIEWS[app.route];
  const mainRef = useRef<HTMLElement>(null);

  // Return to the top when switching sections.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [app.route]);

  const onTabKey = (e: React.KeyboardEvent) => {
    const i = ROUTES.findIndex((r) => r.id === app.route);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % ROUTES.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + ROUTES.length) % ROUTES.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = ROUTES.length - 1;
    if (next < 0) return;
    e.preventDefault();
    navigate(ROUTES[next].id);
    requestAnimationFrame(() => tablist.current?.querySelectorAll<HTMLElement>('[role=tab]')[next]?.focus());
  };

  const countFor = (id: RouteId) => {
    const cat = TAB_CATEGORY[id];
    if (!cat || !audit || !CATEGORIES.includes(cat)) return null;
    const list = audit.findings.filter((f) => f.category === cat);
    if (!list.length) return null;
    return { n: list.length, tone: list.some((f) => f.severity === 'error') ? 'error' : list.some((f) => f.severity === 'warning') ? 'warning' : '' };
  };

  return (
    <div className="app">
      <header className="header">
        <Logo />
        <div className="header-text">
          <div className="header-title">Frontend Toolkit</div>
          <div className="header-sub" title={app.tab.url}>
            <i className={`dot ${app.tab.status === 'ready' ? 'live' : app.tab.status === 'loading' ? 'busy' : ''}`} />
            <span>{app.tab.status === 'none' ? 'No tab' : app.tab.url ? hostOf(app.tab.url) : '…'}</span>
          </div>
        </div>
        {(app.tab.status === 'loading' || !app.ready) && <Spinner label="Loading" />}
        <Button
          variant="ghost"
          small
          icon={THEME_ICON[app.settings.theme]}
          aria-label={`Theme: ${app.settings.theme}. Click to change.`}
          title={`Theme: ${app.settings.theme}`}
          onClick={cycleTheme}
        />
      </header>

      <div className="tabs">
      <div className="tabs-list" role="tablist" aria-label="Sections" ref={tablist} onKeyDown={onTabKey}>
        {ROUTES.map((r) => {
          const count = countFor(r.id);
          const selected = app.route === r.id;
          return (
            <button
              key={r.id}
              role="tab"
              id={`tab-${r.id}`}
              aria-selected={selected}
              aria-controls="panel"
              tabIndex={selected ? 0 : -1}
              className="tab"
              onClick={() => navigate(r.id)}
            >
              {r.label}
              {count && <span className={`tab-count ${count.tone}`} aria-label={`${count.n} findings`}>{count.n}</span>}
            </button>
          );
        })}
      </div>
      </div>

      <main className="main" id="panel" role="tabpanel" aria-labelledby={`tab-${app.route}`} ref={mainRef} tabIndex={-1}>
        {app.emulation.active && app.route !== 'responsive' && (
          <Banner tone="ok">
            Emulating {app.emulation.width} × {app.emulation.height}. Open Responsive to reset.
          </Banner>
        )}
        <View />
      </main>

      <ScreenshotBar />
    </div>
  );
}
