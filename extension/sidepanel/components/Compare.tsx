import { useEffect, useRef, useState } from 'react';
import type { ScreenshotRecord } from '@ftk/screenshot-engine';
import { Segmented } from './ui';

type Mode = 'side' | 'overlay' | 'diff' | 'slider';

/** Object URL tied to a blob's lifetime. */
function useObjectUrl(blob: Blob): string {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

export function Thumb({ shot, className }: { shot: ScreenshotRecord; className?: string }) {
  const url = useObjectUrl(shot.blob);
  return url ? <img className={className} src={url} alt={`${shot.type} screenshot of ${shot.meta.title || shot.meta.url}`} /> : <div className={className} />;
}

interface DiffResult {
  changedPercent: number;
  sizeMismatch: boolean;
}

/** Per-pixel difference: changed pixels are painted magenta over a faded copy of "before". */
async function renderDiff(canvas: HTMLCanvasElement, before: Blob, after: Blob): Promise<DiffResult> {
  const [a, b] = await Promise.all([createImageBitmap(before), createImageBitmap(after)]);
  const w = Math.max(a.width, b.width);
  const h = Math.max(a.height, b.height);
  // Keep the diff canvas modest: compare at most ~4M pixels.
  const k = Math.min(1, Math.sqrt(4_000_000 / (w * h)));
  const cw = Math.max(1, Math.round(w * k));
  const ch = Math.max(1, Math.round(h * k));
  canvas.width = cw;
  canvas.height = ch;

  const read = (bmp: ImageBitmap) => {
    const c = new OffscreenCanvas(cw, ch);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(bmp, 0, 0, bmp.width * k, bmp.height * k);
    return ctx.getImageData(0, 0, cw, ch);
  };
  const da = read(a);
  const db = read(b);
  const out = new ImageData(cw, ch);
  let changed = 0;
  for (let i = 0; i < da.data.length; i += 4) {
    const delta = Math.max(
      Math.abs(da.data[i] - db.data[i]),
      Math.abs(da.data[i + 1] - db.data[i + 1]),
      Math.abs(da.data[i + 2] - db.data[i + 2]),
    );
    if (delta > 24) {
      changed++;
      out.data[i] = 255;
      out.data[i + 1] = 0;
      out.data[i + 2] = 140;
      out.data[i + 3] = 255;
    } else {
      // Faded grayscale of the original so changes keep their context.
      const g = 255 - (255 - (da.data[i] * 0.3 + da.data[i + 1] * 0.59 + da.data[i + 2] * 0.11)) * 0.35;
      out.data[i] = out.data[i + 1] = out.data[i + 2] = g;
      out.data[i + 3] = 255;
    }
  }
  canvas.getContext('2d')!.putImageData(out, 0, 0);
  return { changedPercent: (changed / (cw * ch)) * 100, sizeMismatch: a.width !== b.width || a.height !== b.height };
}

function Diff({ before, after }: { before: ScreenshotRecord; after: ScreenshotRecord }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [result, setResult] = useState<DiffResult | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (ref.current) {
      renderDiff(ref.current, before.blob, after.blob).then((r) => !cancelled && setResult(r));
    }
    return () => {
      cancelled = true;
    };
  }, [before, after]);
  return (
    <div className="stack">
      <div className="compare">
        <canvas ref={ref} role="img" aria-label="Pixel difference between the two screenshots" />
      </div>
      {result && (
        <p className="small">
          <strong>{result.changedPercent.toFixed(2)}%</strong> of pixels changed.
          {result.sizeMismatch && <span className="muted"> The images differ in size, so edges are compared against white.</span>}
        </p>
      )}
    </div>
  );
}

export function Compare({ before, after }: { before: ScreenshotRecord; after: ScreenshotRecord }) {
  const [mode, setMode] = useState<Mode>('side');
  const [opacity, setOpacity] = useState(50);
  const [split, setSplit] = useState(50);
  const urlA = useObjectUrl(before.blob);
  const urlB = useObjectUrl(after.blob);

  return (
    <div className="stack">
      <Segmented
        label="Comparison mode"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'side', label: 'Side by side' },
          { value: 'overlay', label: 'Overlay' },
          { value: 'diff', label: 'Difference' },
          { value: 'slider', label: 'Slider' },
        ]}
      />

      {mode === 'side' && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
          <figure style={{ margin: 0 }}>
            <figcaption className="small muted">Before</figcaption>
            <div className="compare">{urlA && <img src={urlA} alt="Before" />}</div>
          </figure>
          <figure style={{ margin: 0 }}>
            <figcaption className="small muted">After</figcaption>
            <div className="compare">{urlB && <img src={urlB} alt="After" />}</div>
          </figure>
        </div>
      )}

      {mode === 'overlay' && (
        <>
          <div className="compare">
            {urlA && <img src={urlA} alt="Before" />}
            {urlB && (
              <div className="layer" style={{ opacity: opacity / 100 }}>
                <img src={urlB} alt="After, overlaid" />
              </div>
            )}
          </div>
          <div className="field">
            <label htmlFor="ov">After opacity: {opacity}%</label>
            <input id="ov" type="range" min={0} max={100} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
          </div>
        </>
      )}

      {mode === 'slider' && (
        <>
          <div className="compare">
            {urlA && <img src={urlA} alt="Before" />}
            {urlB && (
              <div className="layer" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>
                <img src={urlB} alt="After" />
              </div>
            )}
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${split}%`, width: 2, background: 'var(--accent)' }} aria-hidden="true" />
          </div>
          <div className="field">
            <label htmlFor="sl">Divider: before ← {split}% → after</label>
            <input id="sl" type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} />
          </div>
        </>
      )}

      {mode === 'diff' && <Diff before={before} after={after} />}
    </div>
  );
}
