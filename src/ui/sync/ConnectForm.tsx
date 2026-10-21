/**
 * Connecting to the gym repository (R4): token, repository (owner/name) and branch, verified
 * through the repository's permissions before the first sync. Also the step-by-step
 * instructions for creating a fine-grained token on github.com with the exact settings.
 */
import { useState } from 'react';
import { CircleCheck, CircleX } from 'lucide-react';
import { useServices } from '../../app/services';
import type { VerifyResult } from '../../core/sync/engine';

export const NEW_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

export function TokenInstructions({ repo }: { repo?: string }) {
  const name = repo?.split('/')[1] || 'gym';
  return (
    <ol className="sync-steps">
      <li>
        On github.com open <b>Settings → Developer settings → Personal access tokens → Fine-grained tokens</b> and choose <b>Generate new token</b> (
        <a href={NEW_TOKEN_URL} target="_blank" rel="noreferrer">
          open the page
        </a>
        ).
      </li>
      <li>
        <b>Token name</b>: for example “Slate on iPad”. <b>Expiration</b>: a date you choose, such as 90 days; Slate warns 14 days before it expires.
      </li>
      <li>
        <b>Resource owner</b>: the account that owns your gym repository.
      </li>
      <li>
        <b>Repository access</b>: <b>Only select repositories</b>, then select only <b>{name}</b>.
      </li>
      <li>
        <b>Permissions → Repository permissions</b>: set <b>Contents</b> to <b>Read and write</b>. <b>Metadata</b> becomes <b>Read-only</b> automatically. Leave everything else at <b>No access</b>, and add no account
        permissions.
      </li>
      <li>
        Choose <b>Generate token</b>, copy it (it starts with <code>github_pat_</code>; GitHub shows it once) and paste it below.
      </li>
    </ol>
  );
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className={ok ? 'ok' : 'bad'}>
      {ok ? <CircleCheck size={16} aria-hidden /> : <CircleX size={16} aria-hidden />}
      <span>{children}</span>
    </li>
  );
}

export function VerifyChecks({ result }: { result: VerifyResult }) {
  return (
    <ul className="sync-checks" aria-label="Connection checks">
      {result.repo ? <Check ok>Repository {result.repo.fullName} found</Check> : <Check ok={false}>Repository not reachable with this token</Check>}
      {result.repo && <Check ok={result.repo.canPush}>{result.repo.canPush ? 'The token can write to it' : 'The token cannot write to it'}</Check>}
      {result.branchExists !== undefined && <Check ok={result.branchExists}>{result.branchExists ? 'Branch found' : 'Branch not found'}</Check>}
      {result.ok && (
        <li className="note">{result.tokenExpiry ? `The token expires on ${new Date(result.tokenExpiry).toLocaleDateString(undefined, { dateStyle: 'medium' })}.` : 'GitHub did not report an expiry date; you can enter it in Settings.'}</li>
      )}
    </ul>
  );
}

export function ConnectForm({ onConnected, submitLabel = 'Verify and connect', autoFocus }: { onConnected?: () => void; submitLabel?: string; autoFocus?: boolean }) {
  const { sync, settings } = useServices();
  const secrets = settings.getSecrets();
  const [repo, setRepo] = useState(secrets.repo ?? '');
  const [branch, setBranch] = useState(secrets.branch ?? 'main');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const r = await sync.connect({ token: token.trim(), repo: repo.trim(), branch: branch.trim() || 'main' });
      setResult(r);
      if (r.ok) {
        setToken('');
        onConnected?.();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="sync-form" onSubmit={submit} aria-busy={busy}>
      <label className="field">
        <span>Repository (owner/name)</span>
        <input type="text" name="repo" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/gym" autoComplete="off" autoCapitalize="none" spellCheck={false} required data-autofocus={autoFocus || undefined} />
      </label>
      <label className="field">
        <span>Branch</span>
        <input type="text" name="branch" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" autoComplete="off" autoCapitalize="none" spellCheck={false} />
      </label>
      <label className="field">
        <span>Fine-grained personal access token</span>
        <input type="password" name="token" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" autoComplete="off" autoCapitalize="none" spellCheck={false} required />
      </label>
      <p className="sync-hint">The token is stored only on this device and never written to the repository.</p>
      {result && <VerifyChecks result={result} />}
      {result && !result.ok && result.error && (
        <p className="sync-error" role="alert">
          {result.error}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={busy || !token.trim() || !repo.trim()}>
          {busy ? 'Checking…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
