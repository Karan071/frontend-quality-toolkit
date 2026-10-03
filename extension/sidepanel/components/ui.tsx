import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { Rating, Severity } from '@ftk/audit-core';
import { guarded } from '../actions';

// ───────────────────────────── icons ─────────────────────────────

/** Lucide-style stroke icons (24×24 grid). Markup is static and trusted. */
const CIRCLE = '<circle cx="12" cy="12" r="10"/>';
const ICONS: Record<string, string> = {
  error: `${CIRCLE}<path d="m15 9-6 6M9 9l6 6"/>`,
  warning: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  info: `${CIRCLE}<path d="M12 16v-4M12 8h.01"/>`,
  check: `${CIRCLE}<path d="m9 12 2 2 4-4"/>`,
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
  pick: '<path d="m4 4 7.07 17 2.51-7.39L21 11.07z"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  open: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  rotate: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  wand: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>',
  globe: `${CIRCLE}<path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>`,
  play: '<path d="m6 3 14 9-14 9z"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  phone: '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
  person: '<circle cx="12" cy="5" r="2"/><path d="M5 9h14M12 9v6m0 0-3 6m3-6 3 6"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
  package: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
};

export type IconName = keyof typeof ICONS;

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return (
    <svg
      className={`icon ${className}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}

export function SeverityIcon({ severity }: { severity: Severity }) {
  return (
    <span className={`sev-icon ${severity}`} aria-label={severity}>
      <Icon name={severity} />
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label ?? 'Loading'} />;
}

// ───────────────────────────── controls ─────────────────────────────

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  small?: boolean;
  block?: boolean;
  busy?: boolean;
  icon?: IconName;
  /** Async handler; rejections surface as toasts. */
  onClick?: () => void | Promise<unknown>;
}

export function Button({ variant = 'default', small, block, busy, icon, onClick, children, className = '', disabled, ...rest }: ButtonProps) {
  const iconOnly = !!icon && children == null;
  return (
    <button
      type="button"
      {...rest}
      className={`btn ${variant === 'default' ? '' : variant} ${small ? 'small' : ''} ${block ? 'block' : ''} ${iconOnly ? 'iconbtn' : ''} ${className}`}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={onClick ? () => void guarded(async () => onClick()) : undefined}
    >
      {busy ? <Spinner /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

export function Badge({ tone, children, title }: { tone?: 'error' | 'warning' | 'info' | 'ok' | 'accent'; children: ReactNode; title?: string }) {
  return (
    <span className={`badge ${tone ?? ''}`} title={title}>
      {children}
    </span>
  );
}

export function RatingBadge({ rating }: { rating: Rating | null }) {
  if (!rating) return <Badge>—</Badge>;
  const tone = rating === 'good' ? 'ok' : rating === 'poor' ? 'error' : 'warning';
  const label = rating === 'good' ? 'Good' : rating === 'poor' ? 'Poor' : 'Needs work';
  return <Badge tone={tone}>{label}</Badge>;
}

export function Card({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && (
        <div className="card-title">
          <span>{title}</span>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ title, children, icon = 'info' }: { title: string; children?: ReactNode; icon?: IconName }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} />
      </span>
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function Banner({ tone, children, action }: { tone?: 'warn' | 'error' | 'ok'; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`banner ${tone ?? ''}`} role={tone === 'error' ? 'alert' : undefined}>
      <div>{children}</div>
      {action}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Bar({ value, max, tone }: { value: number; max: number; tone?: 'warn' | 'error' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={`bar ${tone ?? ''}`} role="presentation">
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Swatch({ color }: { color: string }) {
  return <span className="swatch" style={{ background: color }} title={color} aria-hidden="true" />;
}
