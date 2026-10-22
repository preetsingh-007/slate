import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/app/App';
import { OtherTab } from './ui/app/OtherTab';
import { ServicesContext, createServices, requestPersistentStorage } from './app/services';
import { acquireTabLock, type TabLock } from './app/tabLock';
import { useApp } from './ui/app/store';
import { restoreLocalLayout, startLayoutSync } from './ui/app/layoutSync';
import * as registries from './ui/common/registries';
import { useLibraryUi } from './ui/library/state';
import { recoverDrafts } from './ui/common/recoverDrafts';
import 'katex/dist/katex.min.css';
import './ui/styles/global.css';

type Root = ReturnType<typeof createRoot>;

async function start() {
  const root = createRoot(document.getElementById('root')!);
  // R1: one tab at a time (app/tabLock.ts)
  const lock = await acquireTabLock();
  if (lock.state === 'busy') {
    root.render(<OtherTab onUse={() => void acquireTabLock(undefined, { steal: true }).then((l) => boot(root, l))} />);
    return;
  }
  await boot(root, lock);
}

async function boot(root: Root, lock: TabLock) {
  try {
    const services = await createServices();
    if (lock.state === 'held') {
      // another tab took over: stop, keep what is saved, and reload into the "open elsewhere"
      // screen (a reload discards this tab's copies of the data without writing them back;
      // unmounting the app here would let its views save their state once more)
      void lock.lost.then(async () => {
        services.sync.stop();
        await services.docs.flush().catch(() => undefined);
        location.reload();
      });
    }
    void requestPersistentStorage();
    // Durability NFR: work a closed or crashed tab left as drafts goes into the store before the
    // views open. Only the tab holding the app's lock gets here (another tab shows OtherTab), so
    // a draft is recovered once (without Web Locks, recovery is idempotent by id but for a to-do
    // two tabs started at the same moment could both add); a slow recovery finishes in the
    // background.
    await Promise.race([recoverDrafts(services).catch(() => 0), new Promise((r) => setTimeout(r, 2000))]);
    // P3: reopen as it was (local first), then keep the layout saved and synced
    const canvasExists = (slug: string) => !!services.canvases.meta(slug);
    restoreLocalLayout({ canvasExists });
    startLayoutSync({
      device: services.device,
      canvasExists,
      getPanes: () => services.settings.get().panes,
      setPanes: (panes) => services.settings.update({ panes }, { touch: false }),
      onSettingsChange: (fn) => services.settings.onChange.on(fn),
    });
    // test builds expose the services to Playwright (seeding data, inspecting state)
    if (import.meta.env.VITE_SLATE_E2E) {
      (window as unknown as { __slate: unknown }).__slate = services;
      // UI state and registries for tests (carry tray, captures, a fake canvas API)
      (window as unknown as { __slateUi: unknown }).__slateUi = { useApp, registries, useLibraryUi };
    }
    root.render(
      <StrictMode>
        <ServicesContext.Provider value={services}>
          <App />
        </ServicesContext.Provider>
      </StrictMode>,
    );
  } catch (err) {
    root.render(
      <div className="empty">
        <p>
          Slate could not open its local storage: {String((err as Error)?.message ?? err)}. Private browsing may block it.
        </p>
      </div>,
    );
  }
}

void start();
