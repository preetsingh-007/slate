/**
 * R10: the sync status, always visible in the top bar: synced, syncing, offline, or error with
 * its reason, and a warning when changes have been unsynced for more than a day or the token
 * expires soon. Opens Settings.
 */
import { useEffect, useRef, useState } from 'react';
import { Cloud, CloudAlert, CloudCheck, CloudOff, RefreshCw, Settings, TriangleAlert } from 'lucide-react';
import { useServices } from '../../app/services';
import type { SyncStatus } from '../../core/sync/engine';
import { useSyncStatus, useSyncUi } from './state';

const DAY = 86_400_000;

export function phaseLabel(s: SyncStatus): string {
  switch (s.phase) {
    case 'off':
      return 'Not syncing';
    case 'syncing':
      return 'Syncing…';
    case 'offline':
      return 'Offline';
    case 'error':
      return s.needsToken ? 'Sync paused' : 'Sync error';
    default:
      return 'Synced';
  }
}

/** Full sentence for screen readers, tooltips and Settings. */
export function describeStatus(s: SyncStatus, now = Date.now()): string {
  const parts = [phaseLabel(s) + (s.reason && s.phase !== 'synced' && s.phase !== 'syncing' ? `: ${s.reason}` : '.')];
  if (s.stale && s.unsyncedSince) {
    const days = Math.max(1, Math.floor((now - s.unsyncedSince) / DAY));
    parts.push(`Changes have not been synced for ${days} day${days === 1 ? '' : 's'}.`);
  }
  if (s.expiryWarning) parts.push(s.expiryWarning);
  return parts.join(' ');
}

/**
 * The phase to draw: a routine background pull takes a moment every 45 s, so "syncing" shows
 * only when a run lasts longer than that, instead of flickering.
 */
function useShownPhase(phase: SyncStatus['phase']): SyncStatus['phase'] {
  const [shown, setShown] = useState(phase);
  useEffect(() => {
    if (phase !== 'syncing') {
      setShown(phase);
      return;
    }
    const t = setTimeout(() => setShown('syncing'), 700);
    return () => clearTimeout(t);
  }, [phase]);
  return shown;
}

/** What screen readers hear: failures, going offline, and recovering from them; not routine runs. */
function useAnnouncement(s: SyncStatus): string {
  const prev = useRef(s.phase);
  const [text, setText] = useState('');
  useEffect(() => {
    const was = prev.current;
    if (s.phase === 'syncing') return;
    prev.current = s.phase;
    if (s.phase === was) return;
    if (s.phase === 'error' || s.phase === 'offline' || (s.phase === 'synced' && (was === 'error' || was === 'offline'))) setText(describeStatus(s));
  }, [s]);
  return text;
}

export function SyncStatusButton() {
  const { sync } = useServices();
  const s = useSyncStatus(sync);
  const phase = useShownPhase(s.phase);
  const announcement = useAnnouncement(s);
  const warn = s.stale || !!s.expiryWarning || s.needsToken;
  const Icon = phase === 'syncing' ? RefreshCw : phase === 'offline' ? CloudOff : phase === 'error' ? CloudAlert : phase === 'off' ? Cloud : CloudCheck;
  const text = describeStatus(s);
  const label = s.stale && phase !== 'syncing' ? 'Unsynced' : phaseLabel({ ...s, phase });
  return (
    <>
      <button
        className={`sync-status phase-${phase}${warn ? ' warn' : ''}`}
        onClick={() => useSyncUi.getState().openSettings('github')}
        aria-label={`Sync status: ${text} Open sync settings.`}
        title={text}
        data-testid="sync-status"
        data-phase={s.phase}
      >
        <Icon size={18} className={phase === 'syncing' ? 'spin' : undefined} aria-hidden />
        <span className="sync-label hide-narrow">{label}</span>
        {warn && <TriangleAlert size={14} className="sync-badge" aria-hidden />}
      </button>
      <span className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}

export function SettingsButton() {
  return (
    <button className="icon-btn" aria-label="Settings" title="Settings" onClick={() => useSyncUi.getState().openSettings('github')} data-testid="settings-button">
      <Settings size={18} />
    </button>
  );
}
