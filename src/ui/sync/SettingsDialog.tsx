/**
 * Settings (top-bar button): the GitHub connection (R4), the fetch helper, Git LFS mode (R7),
 * this device's preferences, storage persistence (R10), Sync now, and rebuilding the local cache
 * from the repository.
 */
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { requestPersistentStorage, useServices } from '../../app/services';
import { DEFAULT_PREFS, type DevicePrefs } from '../../core/stores/settings';
import { LFS_LIMITATION } from '../../core/sync/lfs';
import { toast } from '../common/toast';
import { Modal } from './Modal';
import { ConnectForm, TokenInstructions } from './ConnectForm';
import { useSyncStatus, useSyncUi } from './state';
import { applyTheme } from './theme';
import { describeStatus } from './SyncStatusButton';

const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { dateStyle: 'medium' });
const fmtTime = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Re-renders when settings change (secrets, preferences or synced settings). */
function useSettingsVersion(): number {
  const { settings } = useServices();
  const [v, setV] = useState(0);
  useEffect(() => {
    const off = settings.onChange.on(() => setV((x) => x + 1));
    return () => void off();
  }, [settings]);
  return v;
}

function GitHubSection() {
  const { sync, settings } = useServices();
  const status = useSyncStatus(sync);
  useSettingsVersion();
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState(false);
  const secrets = settings.getSecrets();
  const connected = sync.configured();

  const syncNow = async () => {
    setBusy(true);
    try {
      await sync.sync();
    } finally {
      setBusy(false);
    }
  };

  if (!connected || status.needsToken || replacing) {
    return (
      <section aria-labelledby="set-github">
        <h3 id="set-github">GitHub sync</h3>
        {status.needsToken && (
          <p className="sync-error" role="alert">
            {status.reason} Sync is paused; your changes are kept on this device.
          </p>
        )}
        {!connected && <p>Not connected. Your work is saved on this device only.</p>}
        <details className="sync-details" open={!connected}>
          <summary>How to create the token</summary>
          <TokenInstructions repo={secrets.repo} />
        </details>
        <ConnectForm onConnected={() => setReplacing(false)} submitLabel={connected ? 'Verify and save' : 'Verify and connect'} />
        {replacing && (
          <div className="actions">
            <button className="btn" onClick={() => setReplacing(false)}>
              Cancel
            </button>
          </div>
        )}
      </section>
    );
  }

  return (
    <section aria-labelledby="set-github">
      <h3 id="set-github">GitHub sync</h3>
      <dl className="sync-facts">
        <dt>Repository</dt>
        <dd>
          {secrets.repo} <span className="muted">· branch {secrets.branch || 'main'}</span>
        </dd>
        <dt>Status</dt>
        <dd data-testid="settings-sync-status">{describeStatus(status)}</dd>
        {status.lastSyncedAt && (
          <>
            <dt>Last synced</dt>
            <dd>{fmtTime(status.lastSyncedAt)}</dd>
          </>
        )}
        <dt>Token expires</dt>
        <dd>
          {status.tokenExpiry ? fmtDate(status.tokenExpiry) : 'not reported by GitHub'}
          {status.expiryWarning && <div className="sync-warn">{status.expiryWarning}</div>}
        </dd>
      </dl>
      <label className="field">
        <span>Token expiry date, if GitHub does not report it (Slate warns 14 days ahead)</span>
        <input
          type="date"
          value={status.tokenExpiry ? new Date(status.tokenExpiry).toISOString().slice(0, 10) : ''}
          onChange={(e) => void settings.setSecrets({ tokenExpiry: e.target.value ? Date.parse(`${e.target.value}T00:00:00Z`) : undefined })}
        />
      </label>
      {status.warnings.length > 0 && (
        <ul className="sync-warnings" aria-label="Sync warnings">
          {status.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <div className="actions">
        <button className="btn primary" onClick={() => void syncNow()} disabled={busy}>
          <RefreshCw size={16} className={busy ? 'spin' : undefined} aria-hidden /> Sync now
        </button>
        <button className="btn" onClick={() => setReplacing(true)}>
          Replace token
        </button>
        <button
          className="btn danger"
          onClick={() => {
            if (confirm('Disconnect from GitHub? Your work stays on this device; it stops syncing until you connect again.')) void sync.disconnect();
          }}
        >
          Disconnect
        </button>
      </div>
    </section>
  );
}

function HelperSection() {
  const { settings } = useServices();
  const secrets = settings.getSecrets();
  const [url, setUrl] = useState(secrets.helperUrl ?? '');
  const [key, setKey] = useState(secrets.helperKey ?? '');
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    await settings.setSecrets({ helperUrl: url.trim() || undefined, helperKey: key.trim() || undefined });
    toast('Fetch helper saved');
  };
  return (
    <section aria-labelledby="set-helper">
      <h3 id="set-helper">Fetch helper</h3>
      <p className="sync-hint">Used by New from link to download web pages. Stored on this device only.</p>
      <form className="sync-form" onSubmit={(e) => void save(e)}>
        <label className="field">
          <span>Helper URL</span>
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://slate-fetch.example.workers.dev" autoComplete="off" spellCheck={false} />
        </label>
        <label className="field">
          <span>Helper key</span>
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        <div className="actions">
          <button type="submit" className="btn">
            Save helper
          </button>
        </div>
      </form>
    </section>
  );
}

function LfsSection() {
  const { settings } = useServices();
  const version = useSettingsVersion();
  // optimistic: the store notifies only after the write is on disk
  const [on, setOn] = useState(!!settings.get().lfs);
  useEffect(() => setOn(!!settings.get().lfs), [settings, version]);
  return (
    <section aria-labelledby="set-lfs">
      <h3 id="set-lfs">Book files</h3>
      <p className="sync-hint">By default, book files stay on each device and are matched by their content; files over 50 MB are refused.</p>
      <label className="sync-check">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            setOn(e.target.checked);
            void settings.update({ lfs: e.target.checked });
          }}
        />
        <span>Git LFS mode: commit book files to the repository (allows files over 50 MB)</span>
      </label>
      {on && (
        <p className="sync-warn" role="note">
          {LFS_LIMITATION}
        </p>
      )}
    </section>
  );
}

function DeviceSection() {
  const { settings } = useServices();
  const version = useSettingsVersion();
  // optimistic: the store notifies only after the write is on disk
  const [prefs, setLocal] = useState(settings.getPrefs());
  useEffect(() => setLocal(settings.getPrefs()), [settings, version]);
  const set = (patch: Partial<DevicePrefs>) => {
    setLocal((p) => ({ ...p, ...patch }));
    void settings.setPrefs(patch);
  };
  return (
    <section aria-labelledby="set-device">
      <h3 id="set-device">This device</h3>
      <label className="field">
        <span>Theme</span>
        <select
          value={prefs.theme}
          onChange={(e) => {
            const theme = e.target.value as DevicePrefs['theme'];
            applyTheme(theme);
            set({ theme });
          }}
        >
          <option value="system">Match the system</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <label className="sync-check">
        <input type="checkbox" checked={prefs.fingerDrawing} onChange={(e) => set({ fingerDrawing: e.target.checked })} />
        <span>Draw with a finger even when a Pencil is used</span>
      </label>
      <label className="field">
        <span>Two-finger hold before space insertion: {prefs.spaceHoldMs} ms</span>
        <input type="range" min={200} max={1000} step={50} value={prefs.spaceHoldMs} onChange={(e) => set({ spaceHoldMs: Number(e.target.value) || DEFAULT_PREFS.spaceHoldMs })} />
      </label>
      <label className="sync-check">
        <input type="checkbox" checked={prefs.minimap} onChange={(e) => set({ minimap: e.target.checked })} />
        <span>Show the minimap</span>
      </label>
      <label className="field">
        <span>Pencil double-tap</span>
        <select value={prefs.pencilDoubleTap} onChange={(e) => set({ pencilDoubleTap: e.target.value as DevicePrefs['pencilDoubleTap'] })}>
          <option value="eraser">Switch to the eraser</option>
          <option value="previous">Switch to the previous tool</option>
          <option value="none">Do nothing</option>
        </select>
      </label>
    </section>
  );
}

function StorageSection() {
  const { sync } = useServices();
  const status = useSyncStatus(sync);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<{ usage?: number; quota?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted, () => setPersisted(false));
    void navigator.storage?.estimate?.().then(setUsage, () => undefined);
  }, []);
  const mb = (n?: number) => (n === undefined ? '?' : `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`);

  const rebuild = async () => {
    if (!confirm('Rebuild the local cache from GitHub? Slate syncs first, clears its local copy and reloads, then downloads everything again. Settings on this device are kept.')) return;
    setBusy(true);
    try {
      await sync.rebuild();
      location.reload();
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      if (/not on GitHub/.test(msg) && confirm(`${msg}\n\nRebuild anyway and lose those changes?`)) {
        await sync.rebuild({ force: true });
        location.reload();
        return;
      }
      toast(msg, { ms: 8000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="set-storage">
      <h3 id="set-storage">Storage</h3>
      <p data-testid="storage-persistence">
        {persisted === null
          ? 'Checking persistent storage…'
          : persisted
            ? 'Persistent storage is on: the browser will not clear Slate’s data to free space.'
            : 'Persistent storage is off: the browser may clear Slate’s data when space runs low. Installing Slate to the Home Screen usually turns it on.'}
      </p>
      {usage && (
        <p className="sync-hint">
          Using {mb(usage.usage)} of {mb(usage.quota)} available.
        </p>
      )}
      <div className="actions">
        {persisted === false && (
          <button className="btn" onClick={() => void requestPersistentStorage().then(setPersisted)}>
            Request persistent storage
          </button>
        )}
        <button className="btn" onClick={() => void rebuild()} disabled={busy || !sync.configured() || status.phase === 'offline'}>
          Rebuild local cache from GitHub
        </button>
      </div>
    </section>
  );
}

export function SettingsDialog() {
  const section = useSyncUi((s) => s.section);
  useEffect(() => {
    if (section !== 'github') document.getElementById(`set-${section}`)?.scrollIntoView({ block: 'start' });
  }, [section]);
  return (
    <Modal title="Settings" onClose={() => useSyncUi.getState().closeSettings()} className="sync-settings" testId="settings">
      <GitHubSection />
      <HelperSection />
      <LfsSection />
      <DeviceSection />
      <StorageSection />
    </Modal>
  );
}
