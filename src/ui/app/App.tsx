import { useEffect } from 'react';
import { PanelRight, Layers } from 'lucide-react';
import { useApp } from './store';
import { Workspace } from './Workspace';
import { CanvasPane } from '../canvas/CanvasPane';
import { ToastHost, useNarrow } from '../common/toast';

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
        <span className="spacer" />
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
        {!narrow && (
          <button className="icon-btn" aria-label="Toggle side pane" aria-pressed={paneOpen} title="Toggle side pane" onClick={() => useApp.getState().togglePane()}>
            <PanelRight size={18} />
          </button>
        )}
      </header>
      <Workspace canvas={<CanvasPane slug={canvas} />} />
      <ToastHost />
    </div>
  );
}
