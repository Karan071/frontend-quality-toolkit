import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { cutoutFor } from '@ftk/responsive-analyzer';
import type { DeviceCategory, DeviceCutout, DevicePreset } from '@ftk/responsive-analyzer';

type Tone = 'steel' | 'graphite' | 'silver';
type Edge = { t: number; r: number; b: number; l: number };

/** Everything needed to size and draw the hardware around a viewport, in CSS px before zooming. */
export interface FrameLayout {
  framed: boolean;
  category: DeviceCategory;
  cutout: DeviceCutout;
  landscape: boolean;
  /** Metal finish of the rim, buttons, laptop base and monitor stand. */
  tone: Tone;
  rimW: number;
  /** Black glass between the rim and the lit screen. */
  bezel: Edge;
  shellR: number;
  bezelR: number;
  screenR: number;
  /** Status bar above the viewport. */
  top: number;
  /** Browser address strip below the viewport. */
  addr: number;
  /** Home-indicator zone below the address strip. */
  indicator: number;
  /** Laptop base, monitor stand or TV feet below the body. */
  stand: number;
  padX: number;
  /** Height of a coloured chin along the bottom of the bezel (iMac). */
  chin: number;
  screenH: number;
  bodyW: number;
  bodyH: number;
  totalW: number;
  totalH: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const zero: Edge = { t: 0, r: 0, b: 0, l: 0 };
const even = (n: number): Edge => ({ t: n, r: n, b: n, l: n });

export function frameLayout(p: DevicePreset, framed: boolean): FrameLayout {
  const category = p.category;
  const cutout = cutoutFor(p);
  const landscape = p.mobile && p.width > p.height;
  const apple = p.brand === 'Apple';
  const longest = Math.max(p.width, p.height);
  const homeBtn = cutout === 'home-button';

  let tone: Tone = 'graphite';
  let rimW = 0;
  let bezel = zero;
  let shellR = 0;
  let screenR = 0;
  let top = 0;
  let addr = 0;
  let indicator = 0;
  let stand = 0;
  let padX = 0;
  let chin = 0;

  if (framed) {
    if (category === 'phone') {
      const side = 11;
      const big = 54;
      tone = apple ? 'steel' : 'graphite';
      rimW = apple ? 4 : 3;
      screenR = homeBtn ? 4 : cutout === 'island' ? 50 : cutout === 'notch' ? 46 : 36;
      bezel = homeBtn ? (landscape ? { t: side, b: side, l: big, r: big + 6 } : { t: big, b: big + 6, l: side, r: side }) : even(side);
      shellR = homeBtn ? 48 : screenR + side + rimW;
      top = landscape ? 24 : homeBtn ? 22 : cutout === 'island' ? 54 : cutout === 'notch' ? 48 : 36;
      addr = landscape ? 34 : 46;
      indicator = homeBtn ? 0 : landscape ? 16 : 30;
    } else if (category === 'tablet') {
      const side = 18;
      const big = 44;
      tone = apple ? 'silver' : 'graphite';
      rimW = 3;
      screenR = homeBtn ? 4 : 20;
      bezel = homeBtn ? (landscape ? { t: side, b: side, l: big, r: big } : { t: big, b: big, l: side, r: side }) : even(side);
      shellR = homeBtn ? 36 : screenR + side + rimW;
      top = 26;
    } else if (category === 'laptop') {
      const k = clamp(longest / 1500, 0.8, 1.8);
      tone = apple ? 'silver' : 'graphite';
      rimW = Math.max(2, Math.round(2 * k));
      bezel = { t: Math.round(14 * k), l: Math.round(9 * k), r: Math.round(9 * k), b: Math.round(12 * k) };
      shellR = Math.round(16 * k);
      screenR = 3;
      stand = clamp(Math.round(18 * k), 16, 40);
      padX = Math.round(p.width * 0.04);
    } else if (category === 'tv') {
      const b = clamp(Math.round(longest * 0.004), 4, 14);
      rimW = 1;
      bezel = { t: b, l: b, r: b, b: b + Math.ceil(b / 2) };
      shellR = 6;
      screenR = 1;
      stand = clamp(Math.round(p.height * 0.07), 22, 100);
    } else {
      const b = clamp(Math.round(longest * 0.005), 8, 26);
      const imac = /imac/i.test(p.label);
      tone = apple ? 'silver' : 'graphite';
      rimW = 1;
      chin = imac ? clamp(Math.round(longest * 0.02), 22, 70) : clamp(Math.round(longest * 0.006), 8, 30);
      bezel = { t: b, l: b, r: b, b: b + chin };
      shellR = 10;
      screenR = 2;
      stand = clamp(Math.round(p.height * 0.1), 40, 220);
      if (!imac) chin = 0;
    }
  }

  const screenH = top + p.height + addr + indicator;
  const bodyW = p.width + bezel.l + bezel.r + rimW * 2;
  const bodyH = screenH + bezel.t + bezel.b + rimW * 2;
  return {
    framed, category, cutout, landscape, tone, rimW, bezel, shellR, bezelR: Math.max(0, shellR - rimW), screenR,
    top, addr, indicator, stand, padX, chin, screenH, bodyW, bodyH, totalW: bodyW + padX * 2, totalH: bodyH + stand,
  };
}

// ───────────────────────────── status bar & address strip ─────────────────────────────

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function Signal() {
  return (
    <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true" fill="currentColor">
      <rect x="0" y="8" width="3" height="4" rx="1" />
      <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
      <rect x="10" y="3" width="3" height="9" rx="1" />
      <rect x="15" y="0" width="3" height="12" rx="1" />
    </svg>
  );
}

function Wifi() {
  return (
    <svg width="17" height="12" viewBox="0 0 17 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M1.5 4.2a10 10 0 0 1 14 0" />
      <path d="M4.2 7a6 6 0 0 1 8.6 0" />
      <circle cx="8.5" cy="10.2" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function Battery() {
  return (
    <svg width="27" height="13" viewBox="0 0 27 13" aria-hidden="true">
      <rect x="0.5" y="0.5" width="22" height="12" rx="3.6" fill="none" stroke="currentColor" opacity="0.4" />
      <rect x="2" y="2" width="19" height="9" rx="2.4" fill="currentColor" />
      <path d="M24 4.4v4.2c.9-.3 1.6-1.2 1.6-2.1s-.7-1.8-1.6-2.1z" fill="currentColor" opacity="0.45" />
    </svg>
  );
}

function Lock() {
  return (
    <svg width="11" height="13" viewBox="0 0 11 13" aria-hidden="true" fill="currentColor">
      <path d="M2.5 5.2V3.8a3 3 0 0 1 6 0v1.4h.5c.8 0 1.5.7 1.5 1.5v4.8c0 .8-.7 1.5-1.5 1.5H2c-.8 0-1.5-.7-1.5-1.5V6.7c0-.8.7-1.5 1.5-1.5zm1.5 0h3V3.8a1.5 1.5 0 0 0-3 0z" />
    </svg>
  );
}

function StatusBar({ L, width }: { L: FrameLayout; width: number }) {
  const time = useClock();
  const home = L.cutout === 'home-button';
  const gap = L.landscape || L.category === 'tablet' ? 0 : L.cutout === 'island' ? 142 : L.cutout === 'notch' ? 176 : L.cutout === 'punch' ? 28 : 0;
  const pad = L.category === 'tablet' ? 22 : L.landscape ? 24 : 0;
  const style: CSSProperties = {
    height: L.top,
    width,
    paddingTop: L.top >= 54 ? 6 : 0,
    paddingLeft: L.landscape && L.cutout !== 'none' && L.cutout !== 'home-button' ? 56 : pad,
    paddingRight: pad,
    gridTemplateColumns: gap || home ? '1fr auto 1fr' : '1fr auto',
    fontSize: L.landscape || L.category === 'tablet' ? 13 : home ? 12 : 16,
  };
  const icons = (
    <span className="df-icons">
      <Signal />
      <Wifi />
      <Battery />
    </span>
  );
  if (home) {
    return (
      <div className="df-status" style={style} aria-hidden="true">
        <span className="df-sb-start">
          <Signal />
          <Wifi />
        </span>
        <b>{time}</b>
        <span className="df-sb-end">
          <Battery />
        </span>
      </div>
    );
  }
  return (
    <div className="df-status" style={style} aria-hidden="true">
      <b className={gap && centersTime(L) ? 'df-sb-start center' : 'df-sb-start'}>{time}</b>
      {gap > 0 && <span style={{ width: gap }} />}
      <span className="df-sb-end">{icons}</span>
    </div>
  );
}

/** Time sits centred in its half on iPhones with a notch or island; Android and iPad align it to the edge. */
function centersTime(L: FrameLayout) {
  return L.category === 'phone' && (L.cutout === 'island' || L.cutout === 'notch');
}

function BottomBar({ L, host }: { L: FrameLayout; host: string }) {
  return (
    <div className="df-bottom" style={{ height: L.addr + L.indicator }} aria-hidden="true">
      <div className="df-addr" style={{ height: L.addr }}>
        <Lock />
        <span>{host || 'about:blank'}</span>
      </div>
      {L.indicator > 0 && <i className="df-pill" style={{ bottom: L.landscape ? 5 : 8, width: L.landscape ? 110 : 134 }} />}
    </div>
  );
}

// ───────────────────────────── bezel parts & buttons ─────────────────────────────

function BezelParts({ L }: { L: FrameLayout }) {
  const { bezel, landscape, cutout, category } = L;
  if (cutout === 'home-button') {
    const slit: CSSProperties = landscape
      ? { left: bezel.l / 2 - 3, top: '50%', width: 6, height: 56, marginTop: -28 }
      : { top: bezel.t / 2 - 3, left: '50%', width: 56, height: 6, marginLeft: -28 };
    const cam: CSSProperties = landscape
      ? { left: bezel.l / 2 - 4, top: '50%', marginTop: -50 }
      : { top: bezel.t / 2 - 4, left: '50%', marginLeft: -50 };
    const btn: CSSProperties = landscape
      ? { right: (bezel.r - 6) / 2 - 20, top: '50%', marginTop: -20 }
      : { bottom: (bezel.b - 6) / 2 - 20, left: '50%', marginLeft: -20 };
    return (
      <>
        <i className="df-slit" style={slit} />
        <i className="df-cam" style={cam} />
        <i className="df-homebtn" style={btn} />
      </>
    );
  }
  if (category === 'tablet' || category === 'laptop') {
    const cam: CSSProperties = landscape
      ? { left: bezel.l / 2 - 3.5, top: '50%', marginTop: -3.5 }
      : { top: bezel.t / 2 - 3.5, left: '50%', marginLeft: -3.5 };
    return <i className="df-cam" style={cam} />;
  }
  return null;
}

type Edge4 = 'left' | 'right' | 'top' | 'bottom';
interface Btn {
  edge: Edge4;
  at: number;
  len: number;
}

const PHONE_BTNS: Btn[] = [
  { edge: 'left', at: 10, len: 3.4 },
  { edge: 'left', at: 16, len: 6.5 },
  { edge: 'left', at: 24.5, len: 6.5 },
  { edge: 'right', at: 21, len: 10.5 },
];
const TABLET_BTNS: Btn[] = [
  { edge: 'top', at: 84, len: 5 },
  { edge: 'right', at: 12, len: 7 },
  { edge: 'right', at: 21, len: 7 },
];
// Rotating the device counter-clockwise moves each edge one step round.
const ROTATED: Record<Edge4, Edge4> = { left: 'bottom', bottom: 'right', right: 'top', top: 'left' };

function Buttons({ L }: { L: FrameLayout }) {
  if (L.category !== 'phone' && L.category !== 'tablet') return null;
  const list = L.category === 'phone' ? PHONE_BTNS : TABLET_BTNS;
  return (
    <>
      {list.map((b, i) => {
        const edge = L.landscape ? ROTATED[b.edge] : b.edge;
        const at = L.landscape && b.edge === 'top' ? 100 - b.at - b.len : b.at;
        const t = 3;
        const style: CSSProperties =
          edge === 'left' ? { left: -t, top: `${at}%`, width: t, height: `${b.len}%`, borderRadius: `${t}px 0 0 ${t}px` }
          : edge === 'right' ? { right: -t, top: `${at}%`, width: t, height: `${b.len}%`, borderRadius: `0 ${t}px ${t}px 0` }
          : edge === 'top' ? { top: -t, left: `${at}%`, height: t, width: `${b.len}%`, borderRadius: `${t}px ${t}px 0 0` }
          : { bottom: -t, left: `${at}%`, height: t, width: `${b.len}%`, borderRadius: `0 0 ${t}px ${t}px` };
        return <i key={i} className="df-btn" style={style} />;
      })}
    </>
  );
}

// ───────────────────────────── frame ─────────────────────────────

export function DeviceFrame({ device, layout: L, scale, host, children }: { device: DevicePreset; layout: FrameLayout; scale: number; host: string; children: ReactNode }) {
  const view = (
    <div className="df-view" style={{ width: device.width, height: device.height }}>
      {children}
    </div>
  );
  const rootStyle: CSSProperties = { width: L.totalW, height: L.totalH, transform: `scale(${scale})` };

  if (!L.framed) {
    return (
      <div className={`sim-device ${device.category}`} style={rootStyle}>
        <div className="df-body bare" style={{ width: device.width, height: device.height }}>
          {view}
        </div>
      </div>
    );
  }

  const hasIndicator = L.category === 'tablet' && L.cutout !== 'home-button';
  const screenOverlay = L.category === 'phone' && (L.cutout === 'island' || L.cutout === 'notch' || L.cutout === 'punch');

  return (
    <div className={`sim-device ${device.category} df-tone-${L.tone}${L.landscape ? ' land' : ''}`} style={rootStyle}>
      <div className="df-body" style={{ left: L.padX, width: L.bodyW, height: L.bodyH, borderRadius: L.shellR, padding: L.rimW }}>
        <div
          className="df-bezel"
          style={{ borderRadius: L.bezelR, padding: `${L.bezel.t}px ${L.bezel.r}px ${L.bezel.b}px ${L.bezel.l}px` }}
        >
          <div className="df-screen" style={{ width: device.width, height: L.screenH, borderRadius: L.screenR }}>
            {L.top > 0 && <StatusBar L={L} width={device.width} />}
            {view}
            {(L.addr > 0 || L.indicator > 0) && <BottomBar L={L} host={host} />}
            {hasIndicator && <i className="df-pill tab" aria-hidden="true" />}
            {screenOverlay && <i className={`df-cut df-${L.cutout}`} aria-hidden="true" />}
          </div>
          <BezelParts L={L} />
          {L.chin > 0 && <div className="df-chin" style={{ height: L.chin, borderRadius: `0 0 ${L.bezelR}px ${L.bezelR}px` }} />}
        </div>
        <Buttons L={L} />
      </div>

      {L.category === 'laptop' && L.stand > 0 && (
        <div className="df-base" style={{ top: L.bodyH - 1, left: 0, width: L.totalW, height: L.stand, borderRadius: `3px 3px ${L.stand}px ${L.stand}px / 3px 3px ${Math.round(L.stand * 0.7)}px ${Math.round(L.stand * 0.7)}px` }}>
          <i className="df-lip" />
        </div>
      )}
      {(L.category === 'desktop' || L.category === 'ultrawide') && L.stand > 0 && (
        <div className="df-stand" style={{ top: L.bodyH - 1, left: L.padX, width: L.bodyW, height: L.stand }}>
          <span className="df-neck" />
          <span className="df-foot" style={{ height: Math.max(6, Math.round(L.stand * 0.1)) }} />
        </div>
      )}
      {L.category === 'tv' && L.stand > 0 && (
        <div className="df-legs" style={{ top: L.bodyH - 1, left: L.padX, width: L.bodyW, height: L.stand }}>
          <span className="df-leg" />
          <span className="df-leg" />
        </div>
      )}
    </div>
  );
}
