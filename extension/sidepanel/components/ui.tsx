import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { Rating, Severity } from '@ftk/audit-core';
import { guarded } from '../actions';
import { Icon } from './icons';
import type { IconName } from './icons';

// ───────────────────────────── icons ─────────────────────────────

export { Icon } from './icons';
export type { IconName } from './icons';

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
