/**
 * R10: the sync status, always visible in the top bar: synced, syncing, offline, or error with
 * its reason, and a warning when changes have been unsynced for more than a day or the token
 * expires soon. Opens Settings.
 */
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

export function SyncStatusButton() {
  const { sync } = useServices();
  const s = useSyncStatus(sync);
  const warn = s.stale || !!s.expiryWarning || s.needsToken;
  const Icon = s.phase === 'syncing' ? RefreshCw : s.phase === 'offline' ? CloudOff : s.phase === 'error' ? CloudAlert : s.phase === 'off' ? Cloud : CloudCheck;
  const text = describeStatus(s);
  const label = s.stale && s.phase !== 'syncing' ? 'Unsynced' : phaseLabel(s);
  return (
    <>
      <button
        className={`sync-status phase-${s.phase}${warn ? ' warn' : ''}`}
        onClick={() => useSyncUi.getState().openSettings('github')}
        aria-label={`Sync status: ${text} Open sync settings.`}
        title={text}
        data-testid="sync-status"
        data-phase={s.phase}
      >
        <Icon size={18} className={s.phase === 'syncing' ? 'spin' : undefined} aria-hidden />
        <span className="sync-label hide-narrow">{label}</span>
        {warn && <TriangleAlert size={14} className="sync-badge" aria-hidden />}
      </button>
      <span className="visually-hidden" role="status" aria-live="polite">
        {s.phase === 'syncing' ? '' : text}
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
