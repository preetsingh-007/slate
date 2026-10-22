/** Shown while Slate runs in another tab or window of this browser (R1, see app/tabLock.ts). */
export function OtherTab({ onUse }: { onUse: () => void }) {
  return (
    <main className="empty other-tab" aria-labelledby="other-tab-title">
      <div>
        <h1 id="other-tab-title">Slate is open in another tab or window</h1>
        <p>Slate runs in one tab at a time, so that two tabs never overwrite each other’s work. Everything is saved.</p>
        <p>
          <button className="btn primary" autoFocus onClick={onUse}>
            Use here
          </button>
        </p>
        <p>The other tab then stops until you use Slate there again.</p>
      </div>
    </main>
  );
}
