/**
 * The canvas plus one side pane with a draggable divider (P1). On narrow screens one pane
 * shows at a time with a quick switch (P2).
 */
import { useRef, type ReactNode } from 'react';
import { X, Maximize2, Minimize2, ArrowLeftRight, PanelRightClose } from 'lucide-react';
import { useApp } from './store';
import { paneKind } from '../panes/registry';
import { useNarrow } from '../common/toast';

export function Workspace({ canvas }: { canvas: ReactNode }) {
  const { paneOpen, tabs, active, divider, swapped, layout } = useApp();
  const narrow = useNarrow();
  const ref = useRef<HTMLDivElement>(null);

  const showPane = paneOpen && tabs.length > 0;
  const canvasOnly = !showPane || layout === 'canvas' || (narrow && layout !== 'pane');
  const paneOnly = showPane && layout === 'pane';

  const onDividerDown = (e: React.PointerEvent) => {
    const host = ref.current;
    if (!host) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = host.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const f = (ev.clientX - rect.left) / rect.width;
      useApp.getState().setDivider(swapped ? 1 - f : f);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onDividerKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const dir = swapped ? -1 : 1;
    if (e.key === 'ArrowLeft') useApp.getState().setDivider(divider - step * dir);
    else if (e.key === 'ArrowRight') useApp.getState().setDivider(divider + step * dir);
    else return;
    e.preventDefault();
  };

  return (
    <div ref={ref} className={`workspace${swapped ? ' swapped' : ''}`}>
      <div
        className="pane-canvas"
        style={{ flex: paneOnly ? '0 0 0' : canvasOnly ? '1 1 auto' : `0 0 calc(${divider * 100}% - 4px)`, display: paneOnly ? 'none' : undefined }}
      >
        {canvas}
      </div>
      {showPane && !canvasOnly && !paneOnly && (
        <div
          className="divider"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panes"
          aria-valuenow={Math.round(divider * 100)}
          tabIndex={0}
          onPointerDown={onDividerDown}
          onKeyDown={onDividerKey}
          onDoubleClick={() => useApp.getState().setDivider(0.6)}
        />
      )}
      {showPane && (
        <div className="pane-side" style={{ flex: '1 1 0', display: canvasOnly ? 'none' : undefined }} aria-label="Side pane">
          <SidePane tabs={tabs} active={active} paneOnly={paneOnly} narrow={narrow} />
        </div>
      )}
    </div>
  );
}

function SidePane({ tabs, active, paneOnly, narrow }: { tabs: ReturnType<typeof useApp.getState>['tabs']; active: number; paneOnly: boolean; narrow: boolean }) {
  const app = useApp();
  return (
    <>
      <div className="tabs" role="tablist" aria-label="Open items">
        {tabs.map((tab, i) => {
          const kind = paneKind(tab.kind);
          const title = kind?.title(tab) ?? tab.kind;
          return (
            <div key={i} className="tab" role="tab" aria-selected={i === active} tabIndex={0} onClick={() => app.activate(i)} onKeyDown={(e) => e.key === 'Enter' && app.activate(i)}>
              <span className="label" title={title}>
                {title}
              </span>
              <button
                className="close"
                aria-label={`Close ${title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  app.closeTab(i);
                }}
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
        <span style={{ flex: 1 }} />
        {!narrow && (
          <button className="icon-btn" aria-label="Swap sides" title="Swap sides" onClick={app.swap}>
            <ArrowLeftRight size={16} />
          </button>
        )}
        <button
          className="icon-btn"
          aria-label={paneOnly ? 'Exit full screen' : 'Full screen'}
          title={paneOnly ? 'Exit full screen' : 'Full screen'}
          onClick={() => app.setLayout(paneOnly ? (narrow ? 'canvas' : 'split') : 'pane')}
        >
          {paneOnly ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
        <button className="icon-btn" aria-label="Close side pane" title="Close side pane" onClick={() => app.togglePane(false)}>
          <PanelRightClose size={16} />
        </button>
      </div>
      <div className="pane-body">
        {tabs.map((tab, i) => {
          const kind = paneKind(tab.kind);
          const C = kind?.component;
          return (
            <div key={tabKey(tab)} className="pane-slot" hidden={i !== active} role="tabpanel">
              {C ? <C tab={tab} active={i === active} /> : <div className="empty">Nothing to show.</div>}
            </div>
          );
        })}
      </div>
    </>
  );
}

function tabKey(tab: ReturnType<typeof useApp.getState>['tabs'][number]): string {
  switch (tab.kind) {
    case 'book':
    case 'clipping':
      return `${tab.kind}:${tab.id}`;
    case 'gym':
      return `gym:${tab.path.split('#')[0]}`;
    case 'canvas':
      return `canvas:${tab.slug}`;
    default:
      return tab.kind;
  }
}
