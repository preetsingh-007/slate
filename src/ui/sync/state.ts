/** UI state of the sync area: which dialog is open, and the engine's status as a React hook. */
import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import type { SyncEngine, SyncStatus } from '../../core/sync/engine';

export type SettingsSection = 'github' | 'device' | 'storage';

interface SyncUiState {
  settingsOpen: boolean;
  section: SettingsSection;
  onboardingOpen: boolean;
  openSettings(section?: SettingsSection): void;
  closeSettings(): void;
  setOnboarding(open: boolean): void;
}

export const useSyncUi = create<SyncUiState>((set) => ({
  settingsOpen: false,
  section: 'github',
  onboardingOpen: false,
  openSettings: (section = 'github') => set({ settingsOpen: true, section }),
  closeSettings: () => set({ settingsOpen: false }),
  setOnboarding: (open) => set({ onboardingOpen: open }),
}));

/** R10: the sync status, re-rendering on every change. */
export function useSyncStatus(sync: SyncEngine): SyncStatus {
  return useSyncExternalStore(
    (fn) => {
      const off = sync.onStatus.on(fn);
      return () => void off();
    },
    () => sync.getStatus(),
  );
}

/** kv key remembering that first-run onboarding was completed or skipped. */
export const ONBOARDING_KEY = 'sync:onboarding';
