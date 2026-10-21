import { useEffect } from 'react';
import { PanelRight, Layers, Maximize2, Minimize2 } from 'lucide-react';
import { useApp } from './store';
import { Workspace } from './Workspace';
import { CanvasPane } from '../canvas/CanvasPane';
import { CanvasSwitcher } from '../canvas/CanvasSwitcher';
import { CarryTray } from '../canvas/CarryTray';
import { CanvasMount } from '../canvas/register';
import { ToastHost, useNarrow } from '../common/toast';
import { GymTopbarButtons } from '../gym/register';
import { SettingsButton, SyncStatusButton } from '../sync/SyncStatusButton';
import { SyncMount } from '../sync/SyncMount';
import { LibraryButtons, LibraryMount } from '../library/register';

export function App() {
  const canvas = useApp((s) => s.canvas);
  const paneOpen = useApp((s) => s.paneOpen);
  const layout = useApp((s) => s.layout);
  const hasTabs = useApp((s) => s.tabs.length > 0);
  const narrow = useNarrow();

  useEffect(() => {
    document.title = 'Slate';
  }, []);

  return (
    <div className="app">
      <header className="topbar" role="toolbar" aria-label="App">
        <span className="title">Slate</span>
        <CanvasSwitcher />
        <LibraryButtons />
        <span className="spacer" />
        <GymTopbarButtons />
        <SyncStatusButton />
        {narrow && hasTabs && (
          <button
            className="icon-btn"
            aria-label={layout === 'pane' ? 'Show canvas' : 'Show side pane'}
            title={layout === 'pane' ? 'Show canvas' : 'Show side pane'}
            onClick={() => useApp.getState().setLayout(layout === 'pane' ? 'canvas' : 'pane')}
          >
            <Layers size={18} />
          </button>
        )}
        {!narrow && hasTabs && paneOpen && (
          // P1: either pane can go full screen; the side pane has its own control in its tab bar
          <button
            className="icon-btn"
            aria-label={layout === 'canvas' ? 'Exit full screen canvas' : 'Full screen canvas'}
            title={layout === 'canvas' ? 'Exit full screen canvas' : 'Full screen canvas'}
            aria-pressed={layout === 'canvas'}
            onClick={() => useApp.getState().setLayout(layout === 'canvas' ? 'split' : 'canvas')}
          >
            {layout === 'canvas' ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
        )}
        {!narrow && (
          <button className="icon-btn" aria-label="Toggle side pane" aria-pressed={paneOpen && hasTabs && layout !== 'canvas'} title="Toggle side pane" onClick={() => {
              const app = useApp.getState();
              // an empty side pane has nothing to show: open the library in it
              if (!hasTabs) app.openTab({ kind: 'library' });
              else app.togglePane(!(paneOpen && layout !== 'canvas'));
            }}>
            <PanelRight size={18} />
          </button>
        )}
        <SettingsButton />
      </header>
      <Workspace canvas={<CanvasPane slug={canvas} />} />
      <SyncMount />
      <CanvasMount />
      <CarryTray />
      <LibraryMount />
      <ToastHost />
    </div>
  );
}
