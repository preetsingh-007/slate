import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/app/App';
import { ServicesContext, createServices, requestPersistentStorage } from './app/services';
import { useApp } from './ui/app/store';
import { restoreLocalLayout, startLayoutSync } from './ui/app/layoutSync';
import * as registries from './ui/common/registries';
import { useLibraryUi } from './ui/library/state';
import 'katex/dist/katex.min.css';
import './ui/styles/global.css';

async function start() {
  const root = createRoot(document.getElementById('root')!);
  try {
    const services = await createServices();
    void requestPersistentStorage();
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
