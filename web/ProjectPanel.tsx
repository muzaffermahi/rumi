import {api, type Settings, type Workspace} from './api';

// The Pi packages and MCP servers this workspace's tasks get. Shown only once some are installed (Settings → Packages
// and MCP). What a project is and how you want things done belongs in your document, which every task reads.
export function ProjectPanel({workspace, settings, onError}: {workspace: Workspace; settings: Settings; onError: (e: unknown) => void}) {
  const packages = settings.packages || [];
  const servers = Object.keys(settings.mcpServers || {});
  if (!packages.length && !servers.length) return null;
  const toggle = (list: string[] | undefined, item: string, url: string, key: 'sources' | 'names') => {
    const cur = new Set(list || []);
    const next = cur.has(item) ? [...cur].filter(s => s !== item) : [...cur, item];
    api(`/w/${workspace.id}/${url}`, 'PUT', {[key]: next}).catch(onError);
  };
  const on = (workspace.packages?.length || 0) + (workspace.mcp?.length || 0);
  return (
    <details className="project">
      <summary>Tools for these tasks{on ? ` · ${on} on` : ''}</summary>
      {!!packages.length && (
        <div className="project-list">
          <span className="list-head">Pi packages</span>
          {packages.map(p => (
            <label key={p.source} className="check" title={p.description}>
              <input
                type="checkbox"
                checked={(workspace.packages || []).includes(p.source)}
                onChange={() => toggle(workspace.packages, p.source, 'packages', 'sources')}
              />{' '}
              {p.name}
            </label>
          ))}
        </div>
      )}
      {!!servers.length && (
        <div className="project-list">
          <span className="list-head">MCP servers</span>
          {servers.map(name => (
            <label key={name} className="check" title={settings.mcpServers[name].description || settings.mcpServers[name].target}>
              <input type="checkbox" checked={(workspace.mcp || []).includes(name)} onChange={() => toggle(workspace.mcp, name, 'mcp', 'names')} /> {name}
            </label>
          ))}
        </div>
      )}
    </details>
  );
}
