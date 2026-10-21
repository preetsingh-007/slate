import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/app/App';
import { ServicesContext, createServices, requestPersistentStorage } from './app/services';
import 'katex/dist/katex.min.css';
import './ui/styles/global.css';

async function start() {
  const root = createRoot(document.getElementById('root')!);
  try {
    const services = await createServices();
    void requestPersistentStorage();
    // test builds expose the services to Playwright (seeding data, inspecting state)
    if (import.meta.env.VITE_SLATE_E2E) (window as unknown as { __slate: unknown }).__slate = services;
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
