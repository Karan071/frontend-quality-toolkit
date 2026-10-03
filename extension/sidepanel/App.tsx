import { useEffect, useRef } from 'react';
import type { ComponentType } from 'react';
import { CATEGORIES } from '@ftk/audit-core';
import type { Category } from '@ftk/audit-core';
import { cycleTheme, init, navigate } from './actions';
import { ScreenshotBar } from './components/ScreenshotBar';
import { Banner, Button, Icon, Spinner } from './components/ui';
import { Accessibility } from './routes/Accessibility';
import { Assets } from './routes/Assets';
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
  assets: Assets,
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

/** Same mark as the extension icon (extension/icons/icon-small.svg). */
function Logo() {
  return (
    <svg className="logo" viewBox="0 0 128 128" aria-hidden="true">
      <defs>
        <linearGradient id="ftk-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6d6bf6" />
          <stop offset="1" stopColor="#3730a3" />
        </linearGradient>
      </defs>
      <rect width="128" height="128" rx="28" fill="url(#ftk-logo)" />
      <rect x="14" y="22" width="78" height="68" rx="12" fill="none" stroke="#fff" strokeWidth="12" />
      <path d="M14 46h78" stroke="#fff" strokeWidth="11" />
      <circle cx="82" cy="80" r="24" fill="#3a33b0" stroke="#fff" strokeWidth="13" />
      <path d="M100 98l17 17" stroke="#fff" strokeWidth="16" strokeLinecap="round" />
    </svg>
  );
}

const inTabMode = new URLSearchParams(location.search).has('tab');

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
        {!inTabMode && app.tab.id != null && app.tab.status !== 'restricted' && (
          <Button
            variant="ghost"
            small
            icon="open"
            aria-label="Open the toolkit in a full browser tab"
            title="Open in a tab (roomier layout for large screens)"
            onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL(`sidepanel.html?tab=${app.tab.id}`) })}
          />
        )}
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
              <Icon name={r.icon} className="tab-icon" />
              <span className="tab-label">{r.label}</span>
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
