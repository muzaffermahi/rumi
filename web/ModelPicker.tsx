import React, {useEffect, useMemo, useRef, useState} from 'react';
import type {Model} from './api';

const FAV_KEY = 'rumi.favModels';
const readFavs = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
  } catch {
    return [];
  }
};

// Choosing a model: search by name, grouped by provider, favourites first, with what each one is.
export function ModelPicker({
  models,
  value,
  onChange,
  defaultLabel,
  up,
  label = 'Model',
}: {
  models: Model[];
  value: string;
  onChange: (ref: string) => void;
  defaultLabel?: string;
  up?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const [favs, setFavs] = useState<string[]>(readFavs);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const groups = useMemo(() => {
    const query = q.trim().toLowerCase();
    const hits = models.filter(m => !query || m.ref.toLowerCase().includes(query) || m.name?.toLowerCase().includes(query));
    const out: {name: string; items: Model[]}[] = [];
    const fav = hits.filter(m => favs.includes(m.ref));
    if (fav.length) out.push({name: 'Favourites', items: fav});
    const byProvider = new Map<string, Model[]>();
    for (const m of hits.filter(m => !favs.includes(m.ref))) byProvider.set(m.provider, [...(byProvider.get(m.provider) || []), m]);
    for (const [name, items] of byProvider) out.push({name, items});
    return out;
  }, [models, q, favs]);
  const flat = [...(defaultLabel ? [{ref: ''} as Model] : []), ...groups.flatMap(g => g.items)];

  function choose(ref: string) {
    onChange(ref);
    setOpen(false);
    setQ('');
  }
  function toggleFav(ref: string) {
    const next = favs.includes(ref) ? favs.filter(f => f !== ref) : [...favs, ref];
    setFavs(next);
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify(next));
    } catch {}
  }
  const current = models.find(m => m.ref === value);
  const badges = (m: Model) =>
    [m.subscription && 'subscription', m.local && 'local', m.contextWindow && `${Math.round(m.contextWindow / 1000)}k`].filter(Boolean).join(' · ');

  return (
    <div className="model-picker" ref={box}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open} aria-label={label}>
        <span>{value ? current?.ref || `${value} (unavailable)` : defaultLabel || 'Choose a model'}</span>▾
      </button>
      {open && (
        <div className={`model-list${up ? ' up' : ''}`}>
          <input
            autoFocus
            placeholder="Search models"
            value={q}
            onChange={e => {
              setQ(e.target.value);
              setIndex(0);
            }}
            onKeyDown={e => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex(i => (i + (e.key === 'ArrowDown' ? 1 : flat.length - 1)) % Math.max(1, flat.length));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (flat[index]) choose(flat[index].ref);
              } else if (e.key === 'Escape') {
                e.stopPropagation();
                setOpen(false);
              }
            }}
            aria-label="Search models"
          />
          <div className="items" role="listbox">
            {defaultLabel && (
              <button role="option" aria-selected={!value} className={index === 0 ? 'on' : ''} onClick={() => choose('')}>
                <span className="grow">{defaultLabel}</span>
              </button>
            )}
            {groups.map(g => (
              <React.Fragment key={g.name}>
                <div className="group">{g.name}</div>
                {g.items.map(m => {
                  const i = flat.indexOf(m);
                  return (
                    <button
                      key={m.ref}
                      role="option"
                      aria-selected={m.ref === value}
                      className={i === index ? 'on' : ''}
                      onClick={() => choose(m.ref)}
                      onMouseEnter={() => setIndex(i)}
                      title={m.ref}
                    >
                      <span className="grow">{m.id}</span>
                      <span className="quiet">{badges(m)}</span>
                      <span
                        className={`star${favs.includes(m.ref) ? ' fav' : ''}`}
                        role="button"
                        aria-label={favs.includes(m.ref) ? 'Remove from favourites' : 'Add to favourites'}
                        onClick={e => {
                          e.stopPropagation();
                          toggleFav(m.ref);
                        }}
                      >
                        {favs.includes(m.ref) ? '★' : '☆'}
                      </span>
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
            {!flat.length && <p className="quiet pad">No model matches. Connect more in Settings → Models.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
