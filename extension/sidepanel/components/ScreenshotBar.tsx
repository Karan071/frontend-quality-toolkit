import type { ScreenshotRecord } from '@ftk/screenshot-engine';
import { clearHighlight, takeScreenshot, toast } from '../actions';
import { copyImage, downloadBlob, openViewer } from '../api';
import { setState, useApp } from '../state';
import { Toasts } from './Toasts';
import { Button, Icon } from './ui';

export function ShotActions({ shot, small = true }: { shot: ScreenshotRecord; small?: boolean }) {
  return (
    <div className="row wrap">
      <Button
        small={small}
        icon="copy"
        onClick={async () => {
          await copyImage(shot.blob);
          toast('Copied to clipboard', 'success');
        }}
      >
        Copy
      </Button>
      <Button small={small} icon="download" onClick={() => downloadBlob(shot.blob, shot.name)}>
        Save
      </Button>
      <Button small={small} icon="open" onClick={() => openViewer(shot.id)}>
        Open
      </Button>
    </div>
  );
}

const AUTHOR = { name: 'Karan Chourasia', handle: 'Karan071', url: 'https://github.com/Karan071' };

/** Quiet attribution: who built this, where to find the source, which version is running. */
function Credit() {
  const version = chrome.runtime.getManifest().version;
  return (
    <div className="credit">
      <span>
        Built by <strong>{AUTHOR.name}</strong>
      </span>
      <span aria-hidden="true">·</span>
      <a href={AUTHOR.url} target="_blank" rel="noopener noreferrer" aria-label={`${AUTHOR.name} on GitHub (opens in a new tab)`}>
        <Icon name="github" />
        {AUTHOR.handle}
      </a>
      <span aria-hidden="true">·</span>
      <span>v{version}</span>
    </div>
  );
}

/** Global capture controls — available from every screen (§29 of the PRD). */
export function ScreenshotBar() {
  const app = useApp();
  const { tab, selection, shotBusy, lastShotId, screenshots, emulation } = app;
  const disabled = tab.status !== 'ready' || !!shotBusy;
  const last = screenshots.find((s) => s.id === lastShotId);
  const label = shotBusy
    ? shotBusy.type === 'fullpage'
      ? shotBusy.total
        ? `Capturing full page… ${shotBusy.done}/${shotBusy.total}`
        : 'Preparing full page…'
      : 'Capturing…'
    : null;

  return (
    <div className="footer" role="region" aria-label="Screenshot">
      <Toasts />
      {emulation.active && (
        <div className="small muted">
          Capturing at emulated {emulation.width} × {emulation.height}
        </div>
      )}
      <div className="dock">
        <Button icon="camera" disabled={disabled} onClick={() => takeScreenshot({ type: 'fullpage' })}>
          Full page
        </Button>
        <Button icon="camera" disabled={disabled} onClick={() => takeScreenshot({ type: 'viewport' })}>
          Viewport
        </Button>
        <Button
          icon="camera"
          disabled={disabled || !selection}
          title={selection ? `Capture ${selection.selector}` : 'Pick an element in Inspect first'}
          onClick={async () => {
            await clearHighlight();
            await takeScreenshot({ type: 'element' });
          }}
        >
          Element
        </Button>
      </div>
      {selection && (
        <div className="small muted ellipsis" title={selection.selector}>
          Selected: <code>{selection.selector}</code> · {Math.round(selection.info.rect.width)} × {Math.round(selection.info.rect.height)}
        </div>
      )}
      {label && (
        <div className="progress" role="progressbar" aria-label={label} aria-valuetext={label}>
          <span style={shotBusy?.total ? { width: `${(shotBusy.done / shotBusy.total) * 100}%` } : { width: '100%' }} />
        </div>
      )}
      {label && <div className="small muted">{label}</div>}
      {last && !shotBusy && (
        <div className="row wrap between" role="status">
          <span className="small">
            <Icon name="check" /> Screenshot captured · {last.width} × {last.height}
          </span>
          <span className="row">
            <ShotActions shot={last} />
            <Button small variant="ghost" aria-label="Dismiss" onClick={() => setState({ lastShotId: null })}>
              ✕
            </Button>
          </span>
        </div>
      )}
      <Credit />
    </div>
  );
}
