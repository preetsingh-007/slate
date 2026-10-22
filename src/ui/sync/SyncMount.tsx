/**
 * Mount point of the sync area in the app shell: starts background sync (R4), shows first-run
 * onboarding (R4), the settings dialog, and keeps the theme preference applied.
 */
import { useEffect } from 'react';
import { useServices } from '../../app/services';
import { toast } from '../common/toast';
import { Onboarding } from './Onboarding';
import { SettingsDialog } from './SettingsDialog';
import { ONBOARDING_KEY, useSyncUi } from './state';
import { applyTheme } from './theme';
import './sync.css';

export function SyncMount() {
  const services = useServices();
  const { sync, settings, db } = services;
  const settingsOpen = useSyncUi((s) => s.settingsOpen);
  const onboardingOpen = useSyncUi((s) => s.onboardingOpen);

  // background sync for the app's lifetime
  useEffect(() => {
    sync.start();
    return () => sync.stop();
  }, [sync]);

  // first run: ask for the token, or continue offline (R4)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await sync.whenReady();
      const seen = await db.get<string>(ONBOARDING_KEY);
      // test builds open it only when asked, so other areas' tests start on the canvas
      const e2e = !!import.meta.env.VITE_SLATE_E2E;
      const asked = new URLSearchParams(location.search).has('onboarding');
      if (!cancelled && !sync.configured() && !seen && (!e2e || asked)) useSyncUi.getState().setOnboarding(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [sync, db]);

  // R4: ask for a new token when GitHub rejects the current one
  useEffect(() => {
    let wasPaused = false;
    const off = sync.onStatus.on((s) => {
      if (s.needsToken && !wasPaused) toast('Sync is paused: GitHub needs a new token. Your changes are kept.', { ms: 8000, action: { label: 'Fix', run: () => useSyncUi.getState().openSettings('github') } });
      wasPaused = s.needsToken;
    });
    return () => void off();
  }, [sync]);

  // device theme (and follow the system while it is "system")
  useEffect(() => {
    let theme = settings.getPrefs().theme;
    applyTheme(theme);
    const mq = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)') : null;
    const onSystem = () => theme === 'system' && applyTheme('system');
    mq?.addEventListener('change', onSystem);
    const off = settings.onChange.on(() => {
      const next = settings.getPrefs().theme;
      if (next !== theme) applyTheme((theme = next));
    });
    return () => {
      mq?.removeEventListener('change', onSystem);
      off();
    };
  }, [settings]);

  return (
    <>
      {onboardingOpen && <Onboarding />}
      {settingsOpen && !onboardingOpen && <SettingsDialog />}
    </>
  );
}
