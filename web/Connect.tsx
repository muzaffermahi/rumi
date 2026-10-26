import type React from 'react';
import {useEffect, useState} from 'react';
import {api, type Model} from './api';

type Provider = {
  id: string;
  name: string;
  oauth: {name: string; label: string; subscription: boolean} | null;
  apiKey: string | null;
  connected: boolean;
  stored: boolean;
  models: number;
  note?: string | null; // why a connected sign-in can't be used here
};
type Local = {id: string; name: string; baseUrl: string; running: boolean; models: string[]; connected: boolean; added: boolean};
type Setup = {
  mode: 'pi' | 'rumi';
  piInstalled: boolean;
  subscriptions: Provider[];
  keys: Provider[];
  connected: Provider[];
  local: Local[];
  models: Model[];
  defaultModel: string;
  ready: boolean;
};
type AuthEvent =
  | {type: 'info' | 'progress'; message: string; links?: {url: string; label?: string}[]}
  | {type: 'auth_url'; url: string; instructions?: string}
  | {type: 'device_code'; userCode: string; verificationUri: string};
type Login = {
  id: string;
  provider: string;
  type: string;
  state: 'running' | 'done' | 'failed' | 'cancelled';
  events: AuthEvent[];
  error: string | null;
  prompt: {
    id: string;
    type: 'text' | 'secret' | 'select' | 'manual_code';
    message: string;
    placeholder?: string;
    options?: {id: string; label: string; description?: string}[];
  } | null;
};

// Connecting models without a terminal: sign in with a subscription, paste an API key, use a local server,
// or share the sign-ins Pi already has. Shown full-page on first run, and from Settings later.
export function Connect({firstRun, onClose, onError}: {firstRun: boolean; onClose: () => void; onError: (e: unknown) => void}) {
  const [st, setSt] = useState<Setup | null>(null);
  const [login, setLogin] = useState<Login | null>(null);
  const [keyFor, setKeyFor] = useState('');
  const [busy, setBusy] = useState('');

  const load = () => api('/setup').then(setSt).catch(onError);
  useEffect(() => {
    load();
  }, []);
  // Follow a running sign-in; when it completes, refresh what is connected.
  useEffect(() => {
    if (!login || login.state !== 'running') return;
    const timer = setInterval(
      () =>
        api(`/connections/login/${login.id}`)
          .then((l: Login) => {
            setLogin(l);
            if (l.state === 'done') load();
          })
          .catch(() => {}),
      700,
    );
    return () => clearInterval(timer);
  }, [login?.id, login?.state]);

  async function act(label: string, fn: () => Promise<any>) {
    setBusy(label);
    try {
      const r = await fn();
      if (r?.subscriptions) setSt(s => ({...s!, ...r}));
      else await load();
    } catch (e) {
      onError(e);
    } finally {
      setBusy('');
    }
  }
  const start = (provider: string, type: 'oauth' | 'api_key') => api('/connections/login', 'POST', {provider, type}).then(setLogin).catch(onError);

  if (!st)
    return (
      <Shell firstRun={firstRun} onClose={onClose}>
        <p className="quiet">Looking for your models…</p>
      </Shell>
    );
  const keyProvider = st.keys.find(p => p.id === (keyFor || st.keys[0]?.id));
  const nameOf = (id: string) => [...st.subscriptions, ...st.keys, ...st.connected].find(p => p.id === id)?.name || id;

  return (
    <Shell firstRun={firstRun} onClose={onClose}>
      {login && (
        <LoginFlow
          login={login}
          name={nameOf(login.provider)}
          onLogin={setLogin}
          onClose={() => {
            setLogin(null);
            load();
          }}
          onError={onError}
        />
      )}

      {!!st.connected.length && (
        <section className="cx-section">
          <h3>Connected</h3>
          <div className="cx-list">
            {st.connected.map(p => (
              <div key={p.id} className="cx-row">
                <span className={'dot ' + (p.note ? 'cancelled' : 'finished')} />
                <b>{p.name}</b>
                <span className="quiet" title={p.note || undefined}>
                  {p.note ? 'subscription not usable here: add an API key' : `${p.models} model${p.models === 1 ? '' : 's'}`}
                </span>
                {p.stored && (
                  <button
                    className="ghost"
                    disabled={!!busy}
                    title={st.mode === 'pi' ? 'Also signs out of Pi' : undefined}
                    onClick={() => act('out', () => api('/connections/logout', 'POST', {provider: p.id}))}
                  >
                    Sign out
                  </button>
                )}
                {st.local.some(l => l.id === p.id && l.added) && (
                  <button className="ghost" disabled={!!busy} onClick={() => act('forget', () => api(`/connections/local/${p.id}`, 'DELETE'))}>
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
          {!!st.models.length && (
            <label className="cx-default">
              Default model for new tasks
              <select
                value={st.models.some(m => m.ref === st.defaultModel) ? st.defaultModel : ''}
                onChange={e => act('default', () => api('/settings', 'PUT', {defaultModel: e.target.value}))}
              >
                {!st.models.some(m => m.ref === st.defaultModel) && <option value="">Choose a model</option>}
                {st.models.map(m => (
                  <option key={m.ref} value={m.ref}>
                    {m.ref}
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>
      )}

      <section className="cx-section">
        <h3>Use an API key</h3>
        <p className="quiet">Anthropic (Claude), OpenAI, OpenRouter, Google and more. You pay the provider for what you use; the key stays on this computer.</p>
        <div className="cx-key">
          <select aria-label="Provider" value={keyProvider?.id || ''} onChange={e => setKeyFor(e.target.value)}>
            {st.keys.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.connected ? ' (connected)' : ''}
              </option>
            ))}
          </select>
          <button className="primary" disabled={!keyProvider} onClick={() => keyProvider && start(keyProvider.id, 'api_key')}>
            Add key
          </button>
        </div>
      </section>

      <section className="cx-section">
        <h3>Sign in with ChatGPT, Copilot and more</h3>
        <p className="quiet">Use a subscription you already pay for. A browser tab opens for you to sign in; nothing is copied by hand.</p>
        <div className="cx-grid">
          {st.subscriptions.map(p => (
            <button key={p.id} className={'cx-card' + (p.connected ? ' done' : '')} onClick={() => start(p.id, 'oauth')}>
              <b>{p.oauth!.label}</b>
              <small>
                {p.oauth!.name}
                {p.connected ? ' · connected' : ''}
              </small>
            </button>
          ))}
        </div>
        <p className="quiet">Claude subscriptions only work in Anthropic's own apps. For Claude in Rumi, add an Anthropic API key above.</p>
      </section>

      <section className="cx-section">
        <h3>On this computer</h3>
        <div className="cx-list">
          {st.local.map(l => (
            <div key={l.id} className="cx-row">
              <span className={'dot ' + (l.running ? 'finished' : 'cancelled')} />
              <b>{l.name}</b>
              <span className="quiet">{l.running ? `${l.models.length} model${l.models.length === 1 ? '' : 's'} available` : 'not running'}</span>
              {l.running && !l.connected && (
                <button
                  className="ghost"
                  disabled={!!busy || !l.models.length}
                  onClick={() => act('local', () => api('/connections/local', 'POST', {id: l.id}))}
                >
                  Use it
                </button>
              )}
              {l.connected && <span className="quiet">connected</span>}
            </div>
          ))}
        </div>
        <p className="quiet">
          Free and private. Start {st.local.map(l => l.name).join(' or ')} with its server on, then{' '}
          <button className="link-btn" onClick={load}>
            check again
          </button>
          .
        </p>
        <CustomServer onAdd={custom => act('local', () => api('/connections/local', 'POST', {custom}))} />
      </section>

      {st.piInstalled && (
        <section className="cx-section">
          <h3>Your Pi sign-ins</h3>
          <p className="quiet">
            Pi is set up on this computer. Rumi can share its sign-ins, so what you connected in Pi works here too (except Claude subscriptions), and the other
            way round. Rumi never changes your other Pi settings.
          </p>
          <div className="seg" role="radiogroup">
            <button
              role="radio"
              aria-checked={st.mode === 'pi'}
              className={st.mode === 'pi' ? 'on' : ''}
              disabled={!!busy}
              onClick={() => act('mode', () => api('/connections/mode', 'POST', {mode: 'pi'}))}
            >
              Share with Pi
            </button>
            <button
              role="radio"
              aria-checked={st.mode === 'rumi'}
              className={st.mode === 'rumi' ? 'on' : ''}
              disabled={!!busy}
              onClick={() => act('mode', () => api('/connections/mode', 'POST', {mode: 'rumi'}))}
            >
              Keep Rumi's own
            </button>
          </div>
        </section>
      )}

      {firstRun && (
        <div className="cx-foot">
          <button className="primary" disabled={!st.ready} onClick={onClose}>
            {st.ready ? 'Start writing' : 'Connect a model to start'}
          </button>
        </div>
      )}
    </Shell>
  );
}

function Shell({firstRun, onClose, children}: {firstRun: boolean; onClose: () => void; children: React.ReactNode}) {
  return (
    <div className={'connect' + (firstRun ? ' first' : '')} role="dialog" aria-label="Connect a model">
      <div className="connect-box">
        <div className="connect-head">
          <div>
            {firstRun && <div className="brand">rumi</div>}
            <h2>{firstRun ? 'Connect a model' : 'Models'}</h2>
            <p className="quiet">Rumi's workers run on an AI you already have: an API key, a subscription, or a model on this computer.</p>
          </div>
          {!firstRun && (
            <button className="ghost close" onClick={onClose} aria-label="Close">
              ×
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

// One sign-in in progress: the provider's link or code, and anything it asks for.
function LoginFlow({
  login,
  name,
  onLogin,
  onClose,
  onError,
}: {
  login: Login;
  name: string;
  onLogin: (l: Login) => void;
  onClose: () => void;
  onError: (e: unknown) => void;
}) {
  const [value, setValue] = useState('');
  const answer = (v: string) =>
    api(`/connections/login/${login.id}/answer`, 'POST', {promptId: login.prompt!.id, value: v})
      .then(l => {
        setValue('');
        onLogin(l);
      })
      .catch(onError);
  const cancel = () =>
    api(`/connections/login/${login.id}/cancel`, 'POST')
      .catch(() => {})
      .finally(onClose);
  useEffect(() => {
    if (login.state === 'done') {
      const t = setTimeout(onClose, 1200);
      return () => clearTimeout(t);
    }
  }, [login.state]);
  const p = login.prompt;
  return (
    <div className="login-flow" role="dialog" aria-label={`Connecting ${name}`}>
      <div className="login-box">
        <h3>{login.type === 'api_key' ? `${name} API key` : `Sign in to ${name}`}</h3>
        {login.events.map((e, i) => (
          <div key={i} className="login-event">
            {e.type === 'auth_url' && (
              <>
                <a className="primary as-link" href={e.url} target="_blank" rel="noreferrer">
                  Open the sign-in page
                </a>
                {e.instructions && <p className="quiet">{e.instructions}</p>}
              </>
            )}
            {e.type === 'device_code' && (
              <>
                <p>
                  Enter this code at{' '}
                  <a href={e.verificationUri} target="_blank" rel="noreferrer">
                    {e.verificationUri}
                  </a>
                </p>
                <div className="device-code">{e.userCode}</div>
              </>
            )}
            {(e.type === 'info' || e.type === 'progress') && (
              <p className="quiet">
                {e.message}
                {e.type === 'info' &&
                  e.links?.map(l => (
                    <span key={l.url}>
                      {' '}
                      <a href={l.url} target="_blank" rel="noreferrer">
                        {l.label || l.url}
                      </a>
                    </span>
                  ))}
              </p>
            )}
          </div>
        ))}
        {p &&
          (p.type === 'select' ? (
            <div className="ask-options">
              {p.options?.map(o => (
                <button key={o.id} className="choice" title={o.description} onClick={() => answer(o.id)}>
                  {o.label}
                </button>
              ))}
            </div>
          ) : (
            <form
              className="ask-input stacked"
              onSubmit={e => {
                e.preventDefault();
                if (value.trim()) answer(value.trim());
              }}
            >
              <label className="quiet">{p.message}</label>
              <div className="ask-row">
                <input
                  autoFocus
                  type={p.type === 'secret' ? 'password' : 'text'}
                  placeholder={p.placeholder || ''}
                  value={value}
                  onChange={e => setValue(e.target.value)}
                />
                <button className="primary" disabled={!value.trim()}>
                  Continue
                </button>
              </div>
            </form>
          ))}
        {login.state === 'running' && !p && !login.events.length && <p className="quiet">Starting…</p>}
        {login.state === 'done' && <p className="login-ok">Connected.</p>}
        {login.state === 'failed' && <p className="msg-error">{login.error}</p>}
        <div className="login-actions">
          {login.state === 'running' ? (
            <button className="ghost" onClick={cancel}>
              Cancel
            </button>
          ) : (
            <button className="ghost" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Any OpenAI-compatible server on this computer or your network (llama.cpp, vLLM, Jan, LocalAI…).
function CustomServer({onAdd}: {onAdd: (s: {id: string; name: string; baseUrl: string; apiKey: string}) => void}) {
  const [id, setId] = useState('');
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:8080/v1');
  const [apiKey, setApiKey] = useState('');
  return (
    <details className="cx-custom">
      <summary>Another OpenAI-compatible server…</summary>
      <div className="form-row">
        <input
          value={id}
          onChange={e => setId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
          placeholder="Short id, e.g. llamacpp"
          aria-label="Server id"
        />
        <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="http://127.0.0.1:8080/v1" aria-label="Server address" />
      </div>
      <div className="form-row">
        <input value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="API key, if it needs one" aria-label="API key" type="password" />
        <button className="secondary" disabled={!id || !baseUrl} onClick={() => onAdd({id, name: id, baseUrl, apiKey})}>
          Connect
        </button>
      </div>
    </details>
  );
}
