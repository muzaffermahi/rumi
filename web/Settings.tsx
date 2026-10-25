import type React from 'react';
import {useEffect, useState} from 'react';
import {api, type Model, type Package, type Settings as S, type Update} from './api';
import {ModelPicker} from './ModelPicker';
import {useToasts} from './Toasts';
import {record, show} from './keys';
import {askPermission} from './notify';

const SECTIONS = [
  ['models', 'Models'],
  ['workers', 'Workers'],
  ['search', 'Search'],
  ['extensions', 'Packages and MCP'],
  ['appearance', 'Appearance'],
  ['shortcuts', 'Shortcuts'],
  ['privacy', 'Privacy and safety'],
  ['about', 'About'],
] as const;
export type Section = (typeof SECTIONS)[number][0];

type Props = {
  settings: S;
  models: Model[];
  version: string;
  update: Update | null;
  section: Section;
  onSection: (s: Section) => void;
  onClose: () => void;
  onConnect: () => void;
};

// Settings, as a page. Every change is saved to config.json right away.
export function Settings({settings, models, version, update, section, onSection, onClose, onConnect}: Props) {
  const toast = useToasts();
  const save = (body: object) => api('/settings', 'PUT', body).catch(toast.error);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !(e.target as HTMLElement).closest('input,textarea,select,.model-list') && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="settings-page" role="dialog" aria-label="Settings">
      <nav className="settings-nav" aria-label="Settings sections">
        <div className="brand">
          Settings
          <button className="ghost close" onClick={onClose} aria-label="Close settings">
            ×
          </button>
        </div>
        {SECTIONS.map(([id, label]) => (
          <button key={id} aria-current={section === id ? 'page' : undefined} onClick={() => onSection(id)}>
            {label}
          </button>
        ))}
        <span className="spacer" />
        <button onClick={onClose}>← Back to writing</button>
      </nav>
      <main className="settings-main">
        {section === 'models' && <Models settings={settings} models={models} save={save} onConnect={onConnect} />}
        {section === 'workers' && <Workers settings={settings} save={save} />}
        {section === 'search' && <Search settings={settings} save={save} />}
        {section === 'extensions' && <Extensions settings={settings} />}
        {section === 'appearance' && <Appearance settings={settings} save={save} />}
        {section === 'shortcuts' && <ShortcutsSection settings={settings} save={save} />}
        {section === 'privacy' && <Privacy settings={settings} save={save} />}
        {section === 'about' && <About version={version} update={update} />}
      </main>
    </div>
  );
}

type Save = (body: object) => Promise<unknown>;
const Toggle = ({on, onChange, label}: {on: boolean; onChange: (v: boolean) => void; label: string}) => (
  <button className="switch-toggle" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />
);
const Row = ({title, hint, children}: {title: string; hint?: React.ReactNode; children: React.ReactNode}) => (
  <div className="setting">
    <div>
      <b>{title}</b>
      {hint && <span>{hint}</span>}
    </div>
    {children}
  </div>
);

function Models({settings, models, save, onConnect}: {settings: S; models: Model[]; save: Save; onConnect: () => void}) {
  return (
    <section>
      <h2>Models</h2>
      <p>Workers run on a model you already have: a subscription, an API key, or a model on this computer. Rumi never swaps your model for another.</p>
      <Row title="Default model" hint="Used for new tasks. You can pick another for a single task in the Delegate box.">
        <div style={{minWidth: 260}}>
          <ModelPicker models={models} value={settings.defaultModel} onChange={ref => ref && save({defaultModel: ref})} label="Default model" />
        </div>
      </Row>
      <Row
        title="Models and sign-ins"
        hint={`${models.length} model${models.length === 1 ? '' : 's'} connected. Sign in, add API keys, use LM Studio, Ollama or any OpenAI-compatible server.`}
      >
        <button className="secondary" onClick={onConnect}>
          Manage…
        </button>
      </Row>
      <Row title="Reasoning" hint="Automatic thinks more for Think tasks and less for Write. Turn it off for small local models.">
        <select value={settings.reasoning} onChange={e => save({reasoning: e.target.value})}>
          <option value="auto">Automatic</option>
          <option value="off">Off</option>
        </select>
      </Row>
    </section>
  );
}

function Workers({settings, save}: {settings: S; save: Save}) {
  return (
    <section>
      <h2>Workers</h2>
      <p>How many tasks run, and what Build tasks may do in your project folders.</p>
      <Row title="Tasks running at once" hint="Use 1 for a local model that can only serve one request at a time.">
        <select value={settings.maxWorkers} onChange={e => save({maxWorkers: Number(e.target.value)})}>
          {[1, 2, 3, 4, 5].map(n => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </Row>
      <Row title="Two tasks in the same project" hint="Side by side is fine for research and writing; one at a time is safer when tasks edit files.">
        <select value={settings.sameFolder ? 'yes' : 'no'} onChange={e => save({sameFolder: e.target.value === 'yes'})}>
          <option value="no">One at a time</option>
          <option value="yes">Side by side</option>
        </select>
      </Row>
      <h3>Build tasks</h3>
      <Row title="Ask before running commands" hint="A web page a worker read could try to steer it. After reading the web is the default.">
        <select value={settings.approvals} onChange={e => save({approvals: e.target.value})}>
          <option value="after-web">After reading the web</option>
          <option value="always">Always</option>
          <option value="off">Never</option>
        </select>
      </Row>
      <Row
        title="Checkpoints"
        hint="Snapshot the folder before each Build task, so you can review its changes and revert them in one click. Needs git; never touches your own repository."
      >
        <Toggle on={settings.checkpoints} onChange={v => save({checkpoints: v})} label="Checkpoints" />
      </Row>
      <Row
        title="Separate worktree for each Build task"
        hint="The task works on its own branch; you merge or discard it when it is done. Git repositories only."
      >
        <Toggle on={settings.worktrees} onChange={v => save({worktrees: v})} label="Worktrees" />
      </Row>
      <h3>Skills</h3>
      <Row title="Offer my own skills" hint="Also give workers the skills in ~/.agents/skills. Rumi's own skills are always available.">
        <Toggle on={settings.userSkills} onChange={v => save({userSkills: v})} label="Offer my own skills" />
      </Row>
    </section>
  );
}

const ENGINES: [string, string, string][] = [
  ['exa', 'Exa', 'Free tier, no key'],
  ['duckduckgo', 'DuckDuckGo', 'No key'],
  ['brave', 'Brave Search', 'API key'],
  ['tavily', 'Tavily', 'API key'],
  ['searxng', 'SearXNG', 'Your own instance'],
];
function Search({settings, save}: {settings: S; save: Save}) {
  const toast = useToasts();
  const [brave, setBrave] = useState('');
  const [tavily, setTavily] = useState('');
  const [searx, setSearx] = useState(settings.search.searxngUrl);
  const [check, setCheck] = useState<{name: string; ok: boolean; results: number; ms: number; error: string | null}[] | null>(null);
  const [checking, setChecking] = useState(false);
  const providers = settings.search.providers;
  const toggle = (p: string) => save({search: {providers: providers.includes(p) ? providers.filter(x => x !== p) : [...providers, p]}});
  async function run() {
    setChecking(true);
    try {
      setCheck((await api('/search/check')).engines);
    } catch (e) {
      toast.error(e);
    } finally {
      setChecking(false);
    }
  }
  return (
    <section>
      <h2>Search</h2>
      <p>
        Research tasks search with every engine you turn on, merged. Bing is used only when all of them return nothing. Keys are stored in config.json, readable
        only by you.
      </p>
      {ENGINES.map(([id, name, hint]) => (
        <Row key={id} title={name} hint={hint}>
          <Toggle on={providers.includes(id)} onChange={() => toggle(id)} label={name} />
        </Row>
      ))}
      <h3>Keys and addresses</h3>
      <div className="form-grid">
        <span>Brave API key</span>
        <div className="form-row" style={{marginTop: 0}}>
          <input
            type="password"
            value={brave}
            onChange={e => setBrave(e.target.value)}
            placeholder={settings.search.braveApiKey ? 'Saved — type to replace' : 'Not set'}
            autoComplete="off"
          />
          <button className="ghost" disabled={!brave} onClick={() => save({search: {braveApiKey: brave}}).then(() => setBrave(''))}>
            Save
          </button>
          {settings.search.braveApiKey && (
            <button className="ghost danger" onClick={() => save({search: {braveApiKey: null}})}>
              Remove
            </button>
          )}
        </div>
        <span>Tavily API key</span>
        <div className="form-row" style={{marginTop: 0}}>
          <input
            type="password"
            value={tavily}
            onChange={e => setTavily(e.target.value)}
            placeholder={settings.search.tavilyApiKey ? 'Saved — type to replace' : 'Not set'}
            autoComplete="off"
          />
          <button className="ghost" disabled={!tavily} onClick={() => save({search: {tavilyApiKey: tavily}}).then(() => setTavily(''))}>
            Save
          </button>
          {settings.search.tavilyApiKey && (
            <button className="ghost danger" onClick={() => save({search: {tavilyApiKey: null}})}>
              Remove
            </button>
          )}
        </div>
        <span>SearXNG address</span>
        <div className="form-row" style={{marginTop: 0}}>
          <input type="url" value={searx} onChange={e => setSearx(e.target.value)} placeholder="http://localhost:8888" />
          <button className="ghost" disabled={searx === settings.search.searxngUrl} onClick={() => save({search: {searxngUrl: searx.trim()}})}>
            Save
          </button>
        </div>
      </div>
      <h3>Check</h3>
      <button className="secondary" disabled={checking} onClick={run}>
        {checking ? 'Searching…' : 'Run a test search'}
      </button>
      {check && (
        <div className="checks">
          {check.map(c => (
            <div key={c.name}>
              <span className={c.ok ? 'ok' : 'bad'}>{c.ok ? '✓' : '✗'}</span> {c.name} — {c.ok ? `${c.results} results in ${c.ms} ms` : c.error}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

type Found = Package & {publisher?: string; downloads?: number | null; links?: {npm?: string; repository?: string}};
function Extensions({settings}: {settings: S}) {
  const toast = useToasts();
  const [fromPi, setFromPi] = useState<Package[]>([]);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[] | null>(null);
  const [busy, setBusy] = useState('');
  const [confirming, setConfirming] = useState<Found | null>(null);
  const [safe, setSafe] = useState(true);
  useEffect(() => {
    api('/packages').then(
      r => setFromPi(r.fromPi),
      () => {},
    );
  }, [settings.packages.length]);
  async function search(text = q) {
    setBusy('search');
    try {
      setFound((await api(`/packages/search?q=${encodeURIComponent(text)}`)).results);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy('');
    }
  }
  async function install(p: Package) {
    setBusy(p.name);
    try {
      await api('/packages', 'POST', {name: p.source || p.name, ignoreScripts: safe});
      toast.notify(`Added ${p.name}. Turn it on for a workspace under “This project”.`);
      setConfirming(null);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy('');
    }
  }

  // MCP
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'stdio' | 'http'>('stdio');
  const [command, setCommand] = useState('');
  const [url, setUrl] = useState('');
  const [env, setEnv] = useState('');
  const [description, setDescription] = useState('');
  async function addServer() {
    let server: Record<string, unknown>;
    if (kind === 'http') server = {url: url.trim()};
    else {
      const parts =
        command
          .trim()
          .match(/"[^"]*"|\S+/g)
          ?.map(s => s.replace(/^"|"$/g, '')) || [];
      server = {command: parts[0], args: parts.slice(1)};
    }
    if (description.trim()) server.description = description.trim();
    const vars = Object.fromEntries(
      env
        .split('\n')
        .map(l => l.match(/^\s*([A-Za-z_][\w]*)\s*=\s*(.*)$/))
        .filter(Boolean)
        .map(m => [m![1], m![2]]),
    );
    if (Object.keys(vars).length) server[kind === 'http' ? 'headers' : 'env'] = vars;
    try {
      await api(`/mcp/${encodeURIComponent(name.trim())}`, 'PUT', {server});
      toast.notify(`Added ${name}. Turn it on for a workspace under “This project”.`);
      setName('');
      setCommand('');
      setUrl('');
      setEnv('');
      setDescription('');
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <section>
      <h2>Packages and MCP</h2>
      <p>
        Give workers more tools. Install once here, then turn each one on per workspace under <i>This project</i> in the sidebar, so a code tool can serve your
        code projects without touching your writing.
      </p>
      <h3>Pi packages</h3>
      <div className="row-list">
        {settings.packages.map(p => (
          <div key={p.source} className="row-item">
            <span className="grow">
              <b>{p.name}</b> <span className="quiet">{p.version}</span>
              <small>{p.description}</small>
            </span>
            <button className="ghost danger" onClick={() => api('/packages', 'DELETE', {source: p.source}).catch(toast.error)}>
              Remove
            </button>
          </div>
        ))}
        {fromPi.map(p => (
          <div key={p.source} className="row-item">
            <span className="grow">
              <b>{p.name}</b> <span className="quiet">in your Pi</span>
              <small>{p.description}</small>
            </span>
            <button className="ghost" disabled={!!busy} onClick={() => setConfirming(p)}>
              Add
            </button>
          </div>
        ))}
        {!settings.packages.length && !fromPi.length && <p className="quiet">No packages yet.</p>}
      </div>
      <form
        className="form-row"
        onSubmit={e => {
          e.preventDefault();
          search();
        }}
      >
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search Pi packages on npm, or type a name" aria-label="Search packages" />
        <button className="secondary" disabled={busy === 'search'}>
          {busy === 'search' ? 'Searching…' : 'Search'}
        </button>
        {q.trim() && (
          <button
            type="button"
            className="ghost"
            onClick={() => setConfirming({source: q.trim(), name: q.trim(), version: '', description: 'Installed by name'})}
          >
            Add “{q.trim()}”
          </button>
        )}
      </form>
      {found && (
        <div className="row-list" style={{marginTop: 10}}>
          {!found.length && <p className="quiet">Nothing found.</p>}
          {found.map(p => (
            <div key={p.source} className="row-item">
              <span className="grow">
                <b>{p.name}</b>{' '}
                <span className="quiet">
                  {p.version}
                  {p.publisher && ` · ${p.publisher}`}
                  {p.downloads != null && ` · ${p.downloads.toLocaleString()}/month`}
                </span>
                <small>{p.description}</small>
              </span>
              {p.links?.npm && (
                <a className="ghost" href={p.links.npm} target="_blank" rel="noreferrer">
                  npm
                </a>
              )}
              <button className="ghost" disabled={!!busy || settings.packages.some(x => x.source === p.source)} onClick={() => setConfirming(p)}>
                {settings.packages.some(x => x.source === p.source) ? 'Added' : 'Add'}
              </button>
            </div>
          ))}
        </div>
      )}
      {confirming && (
        <div className="overlay" onMouseDown={e => e.target === e.currentTarget && setConfirming(null)}>
          <div className="dialog" role="dialog" aria-label={`Add ${confirming.name}`}>
            <h2>Add {confirming.name}?</h2>
            <p className="quiet">{confirming.description}</p>
            <p style={{fontSize: 13.5, lineHeight: 1.6}}>
              Pi packages run on your computer with your permissions when a task in a workspace that turned them on runs. Only add packages you trust.
            </p>
            <label className="check">
              <input type="checkbox" checked={safe} onChange={e => setSafe(e.target.checked)} /> Don’t run its install scripts (safer; a few packages need them)
            </label>
            <div className="dialog-actions">
              <button className="ghost" onClick={() => setConfirming(null)}>
                Cancel
              </button>
              <button className="primary" disabled={!!busy} onClick={() => install(confirming)}>
                {busy === confirming.name ? 'Installing…' : 'Install'}
              </button>
            </div>
          </div>
        </div>
      )}

      <h3>MCP servers</h3>
      <p className="lead">
        Model Context Protocol servers, in the same format as Claude Desktop, Cursor and Pi. Their tools are offered to workers in workspaces that turn them on.
      </p>
      <div className="row-list">
        {Object.entries(settings.mcpServers).map(([n, s]) => (
          <div key={n} className="row-item">
            <span className="grow">
              <b>{n}</b> <span className="quiet">{s.kind}</span>
              <small>{s.description || s.target}</small>
            </span>
            <button className="ghost danger" onClick={() => api(`/mcp/${encodeURIComponent(n)}`, 'DELETE').catch(toast.error)}>
              Remove
            </button>
          </div>
        ))}
        {!Object.keys(settings.mcpServers).length && <p className="quiet">No MCP servers yet.</p>}
      </div>
      <div className="form-grid">
        <span>Name</span>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="filesystem" />
        <span>Kind</span>
        <div className="seg" role="radiogroup">
          <button role="radio" aria-checked={kind === 'stdio'} className={kind === 'stdio' ? 'on' : ''} onClick={() => setKind('stdio')}>
            A program
          </button>
          <button role="radio" aria-checked={kind === 'http'} className={kind === 'http' ? 'on' : ''} onClick={() => setKind('http')}>
            A URL
          </button>
        </div>
        {kind === 'stdio' ? (
          <>
            <span>Command</span>
            <input
              value={command}
              onChange={e => setCommand(e.target.value)}
              placeholder="npx -y @modelcontextprotocol/server-filesystem ."
              style={{fontFamily: 'var(--mono)', fontSize: 12}}
            />
          </>
        ) : (
          <>
            <span>URL</span>
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com/mcp" />
          </>
        )}
        <span>{kind === 'http' ? 'Headers' : 'Environment'}</span>
        {/* biome-ignore lint/suspicious/noTemplateCurlyInString: ${NAME} is MCP's own syntax for environment variables */}
        <textarea value={env} onChange={e => setEnv(e.target.value)} placeholder={kind === 'http' ? 'Authorization=Bearer ${TOKEN}' : 'API_KEY=${MY_KEY}'} />
        <span>Description</span>
        <input value={description} onChange={e => setDescription(e.target.value)} placeholder="What it offers, in a sentence (optional)" />
        <span />
        <div>
          <button className="secondary" disabled={!name.trim() || (kind === 'stdio' ? !command.trim() : !url.trim())} onClick={addServer}>
            Add server
          </button>
        </div>
      </div>
    </section>
  );
}

function Appearance({settings, save}: {settings: S; save: Save}) {
  const toast = useToasts();
  return (
    <section>
      <h2>Appearance</h2>
      <Row title="Theme" hint="System follows your computer's light or dark setting.">
        <div className="seg" role="radiogroup" aria-label="Theme">
          {(['system', 'light', 'dark'] as const).map(t => (
            <button key={t} role="radio" aria-checked={settings.theme === t} className={settings.theme === t ? 'on' : ''} onClick={() => save({theme: t})}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </Row>
      <Row title="Notifications" hint="A browser notification when a task finishes or needs you while Rumi is in the background.">
        <Toggle
          on={settings.notifications}
          label="Notifications"
          onChange={async v => {
            if (v && (await askPermission()) !== 'granted')
              return toast.notify('Your browser blocked notifications for this page. Allow them in the site settings.');
            save({notifications: v});
          }}
        />
      </Row>
    </section>
  );
}

const SHORTCUT_NAMES: [keyof S['shortcuts'], string][] = [
  ['delegate', 'Delegate the selection'],
  ['palette', 'Command palette'],
  ['newDocument', 'New document'],
  ['focusMode', 'Focus mode'],
  ['shortcuts', 'Show shortcuts'],
];
function ShortcutsSection({settings, save}: {settings: S; save: Save}) {
  const [listening, setListening] = useState<string | null>(null);
  return (
    <section>
      <h2>Shortcuts</h2>
      <p>Click a shortcut, then press the keys you want. Mod is Ctrl, or ⌘ on a Mac.</p>
      {SHORTCUT_NAMES.map(([key, label]) => (
        <Row key={key} title={label}>
          <input
            className={`kbd-input${listening === key ? ' listening' : ''}`}
            readOnly
            value={listening === key ? 'Press keys…' : show(settings.shortcuts[key])}
            onFocus={() => setListening(key)}
            onBlur={() => setListening(null)}
            onKeyDown={e => {
              e.preventDefault();
              if (e.key === 'Escape') return (e.target as HTMLInputElement).blur();
              const spec = record(e.nativeEvent);
              if (!spec) return;
              save({shortcuts: {[key]: spec}});
              (e.target as HTMLInputElement).blur();
            }}
            aria-label={`Shortcut for ${label}`}
          />
        </Row>
      ))}
      <div className="form-row">
        <button
          className="ghost"
          onClick={() => save({shortcuts: {delegate: 'Mod+Enter', palette: 'Mod+K', newDocument: 'Mod+Alt+N', focusMode: 'Mod+Shift+F', shortcuts: 'Shift+?'}})}
        >
          Reset to defaults
        </button>
      </div>
    </section>
  );
}

function Privacy({settings, save}: {settings: S; save: Save}) {
  return (
    <section>
      <h2>Privacy and safety</h2>
      <p>
        Rumi runs on your computer and sends nothing about you anywhere. Your documents go only to the model you chose, as context for the tasks you delegate.
      </p>
      <Row
        title="Let workers open local addresses"
        hint="Off by default: a web page could try to make a worker read this computer or your network. Turn on only if tasks need an intranet page or a local server."
      >
        <Toggle on={settings.allowPrivateNetwork} onChange={v => save({allowPrivateNetwork: v})} label="Allow private network" />
      </Row>
      <Row title="Check for updates" hint="Once a day, Rumi asks GitHub for the latest version number. Nothing else is sent.">
        <Toggle on={settings.updateCheck} onChange={v => save({updateCheck: v})} label="Check for updates" />
      </Row>
      <Row
        title="Where your data is"
        hint="Settings and the Global workspace are in Rumi's data folder; a project's documents and tasks are in its .rumi folder, ignored by git."
      >
        <span className="quiet">See About</span>
      </Row>
    </section>
  );
}

type AboutInfo = {
  environment: {rumi: string; node: string; platform: string; data: string; app: string};
  checks: {name: string; ok: boolean; warn?: boolean; detail: string; fix?: string}[];
  log: string;
  models: number;
  git: boolean;
  mode: string;
};
function About({version, update}: {version: string; update: Update | null}) {
  const toast = useToasts();
  const [about, setAbout] = useState<AboutInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [latest, setLatest] = useState<Update | null>(update);
  const [quitting, setQuitting] = useState(false);
  useEffect(() => {
    api<AboutInfo>('/about').then(setAbout, toast.error);
  }, []);
  async function check() {
    setChecking(true);
    try {
      setLatest(await api<Update>('/update/check', 'POST'));
    } catch (e) {
      toast.error(e);
    } finally {
      setChecking(false);
    }
  }
  return (
    <section>
      <h2>About Rumi</h2>
      <p>
        Version {version}. Open source under the MIT license.{' '}
        <a href="https://github.com/muzaffermahi/rumi" target="_blank" rel="noreferrer">
          github.com/muzaffermahi/rumi
        </a>
      </p>
      <Row
        title="Updates"
        hint={
          latest
            ? latest.available
              ? `Rumi ${latest.latest} is available. To update: ${latest.install.how}`
              : latest.latest
                ? 'You have the latest version.'
                : 'No releases published yet.'
            : 'Not checked yet.'
        }
      >
        <span style={{display: 'flex', gap: 6}}>
          {latest?.available && (
            <a className="primary" href={latest.url} target="_blank" rel="noreferrer" style={{textDecoration: 'none'}}>
              What’s new
            </a>
          )}
          <button className="secondary" disabled={checking} onClick={check}>
            {checking ? 'Checking…' : 'Check now'}
          </button>
        </span>
      </Row>
      {about && (
        <>
          <h3>This computer</h3>
          <div className="checks">
            <div>
              Node {about.environment.node} · {about.environment.platform}
            </div>
            <div>
              Data folder: <code>{about.environment.data}</code>
            </div>
            <div>
              Sign-ins: {about.mode === 'pi' ? 'shared with Pi' : 'Rumi’s own'} · {about.models} models connected
            </div>
          </div>
          <h3>Checks</h3>
          <div className="checks">
            {about.checks.map(c => (
              <div key={c.name}>
                <span className={c.ok ? 'ok' : c.warn ? 'warn' : 'bad'}>{c.ok ? '✓' : c.warn ? '!' : '✗'}</span> {c.name}: {c.detail}
                {c.fix && <div className="fix">→ {c.fix}</div>}
              </div>
            ))}
          </div>
          <h3>Recent log</h3>
          <pre className="log">{about.log || 'Empty.'}</pre>
          <p className="quiet">
            When you report a problem, include the output of <code>rumi doctor</code>.
          </p>
        </>
      )}
      <h3>Quit</h3>
      <Row title="Stop Rumi" hint="Running tasks are stopped. Start it again with the rumi command or the Rumi shortcut.">
        <button
          className="danger-btn"
          disabled={quitting}
          onClick={() => {
            setQuitting(true);
            fetch('/api/shutdown', {method: 'POST', headers: {'X-Rumi-UI': '1'}}).catch(() => {});
          }}
        >
          {quitting ? 'Rumi has stopped' : 'Quit Rumi'}
        </button>
      </Row>
    </section>
  );
}
