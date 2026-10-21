/** First run (R4): connect to the gym repository, or continue offline without sync. */
import { useServices } from '../../app/services';
import { Modal } from './Modal';
import { ConnectForm, TokenInstructions } from './ConnectForm';
import { ONBOARDING_KEY, useSyncUi } from './state';

export function Onboarding() {
  const { db } = useServices();
  const done = (how: 'connected' | 'offline') => {
    void db.set(ONBOARDING_KEY, how);
    useSyncUi.getState().setOnboarding(false);
  };
  return (
    <Modal title="Welcome to Slate" testId="onboarding">
      <p>
        Slate keeps everything on this device and syncs it to your <b>gym</b> repository on GitHub, which holds the master copy. To sync, create a GitHub token that can only reach that repository:
      </p>
      <TokenInstructions />
      <ConnectForm onConnected={() => done('connected')} autoFocus />
      <div className="actions sync-offline-choice">
        <button type="button" className="btn" onClick={() => done('offline')}>
          Continue offline without sync
        </button>
      </div>
      <p className="sync-hint">You can connect later in Settings. Until then, your work stays on this device only.</p>
    </Modal>
  );
}
