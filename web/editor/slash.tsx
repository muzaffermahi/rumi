// The slash menu: type / at the start of a line for headings, lists, tables and more. The TipTap side (SlashCommand)
// publishes its state to a tiny store; <SlashMenu/> renders it, so the menu is ordinary React.
import {useEffect, useRef, useSyncExternalStore} from 'react';
import {Extension, type Editor, type Range} from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';

export type SlashItem = {title: string; hint: string; icon: string; keywords: string; run: (editor: Editor, range: Range) => void};

// Opens the Delegate box (DocumentPane listens for it).
export const DELEGATE_EVENT = 'rumi:delegate';
// Asks DocumentPane to pick an image file to upload.
export const IMAGE_EVENT = 'rumi:image';

export const SLASH_ITEMS: SlashItem[] = [
  {title: 'Text', hint: 'Plain paragraph', icon: '¶', keywords: 'paragraph body', run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run()},
  {
    title: 'Heading 1',
    hint: 'Big section title',
    icon: 'H1',
    keywords: 'title h1',
    run: (e, r) => e.chain().focus().deleteRange(r).setHeading({level: 1}).run(),
  },
  {title: 'Heading 2', hint: 'Section', icon: 'H2', keywords: 'subtitle h2', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({level: 2}).run()},
  {title: 'Heading 3', hint: 'Subsection', icon: 'H3', keywords: 'h3', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({level: 3}).run()},
  {
    title: 'Bulleted list',
    hint: 'A simple list',
    icon: '•',
    keywords: 'ul unordered bullet',
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run(),
  },
  {
    title: 'Numbered list',
    hint: 'A list with numbers',
    icon: '1.',
    keywords: 'ol ordered number',
    run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run(),
  },
  {
    title: 'Checklist',
    hint: 'Things to tick off',
    icon: '☐',
    keywords: 'todo task check',
    run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run(),
  },
  {title: 'Quote', hint: 'Set a passage apart', icon: '❝', keywords: 'blockquote', run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run()},
  {
    title: 'Code',
    hint: 'Code with highlighting',
    icon: '{}',
    keywords: 'codeblock pre snippet',
    run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run(),
  },
  {
    title: 'Table',
    hint: '3 × 3, with a header row',
    icon: '▦',
    keywords: 'grid',
    run: (e, r) => e.chain().focus().deleteRange(r).insertTable({rows: 3, cols: 3, withHeaderRow: true}).run(),
  },
  {
    title: 'Divider',
    hint: 'A horizontal line',
    icon: '—',
    keywords: 'hr rule separator',
    run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run(),
  },
  {
    title: 'Image',
    hint: 'Upload a picture',
    icon: '▣',
    keywords: 'picture photo upload',
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run();
      window.dispatchEvent(new Event(IMAGE_EVENT));
    },
  },
  {
    title: 'Delegate…',
    hint: 'Hand this document to a worker',
    icon: '→',
    keywords: 'agent task research ask',
    run: (e, r) => {
      e.chain().focus().deleteRange(r).run();
      window.dispatchEvent(new Event(DELEGATE_EVENT));
    },
  },
];

export function filterItems(query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter(i => i.title.toLowerCase().includes(q) || i.keywords.includes(q));
}

// --- the store between TipTap and React ---
type State = {items: SlashItem[]; index: number; rect: DOMRect | null; pick: (i: SlashItem) => void} | null;
let state: State = null;
const listeners = new Set<() => void>();
const set = (s: State) => {
  state = s;
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        char: '/',
        startOfLine: true,
        allowSpaces: false,
        items: ({query}) => filterItems(query),
        command: ({editor, range, props}) => props.run(editor, range),
        render: () => {
          let pick: (i: SlashItem) => void = () => {};
          return {
            onStart: p => {
              pick = item => p.command(item);
              set({items: p.items, index: 0, rect: p.clientRect?.() || null, pick});
            },
            onUpdate: p => {
              pick = item => p.command(item);
              set({items: p.items, index: Math.min(state?.index || 0, Math.max(0, p.items.length - 1)), rect: p.clientRect?.() || null, pick});
            },
            onKeyDown: ({event}) => {
              if (!state) return false;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                const n = state.items.length || 1;
                set({...state, index: (state.index + (event.key === 'ArrowDown' ? 1 : n - 1)) % n});
                return true;
              }
              if (event.key === 'Enter' || event.key === 'Tab') {
                const item = state.items[state.index];
                if (item) state.pick(item);
                return !!item;
              }
              if (event.key === 'Escape') {
                set(null);
                return true;
              }
              return false;
            },
            onExit: () => set(null),
          };
        },
      }),
    ];
  },
});

export function SlashMenu() {
  const s = useSyncExternalStore(subscribe, () => state);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector('.on')?.scrollIntoView({block: 'nearest'});
  }, [s?.index]);
  if (!s?.rect) return null;
  const below = s.rect.bottom + 330 < window.innerHeight;
  const style = {left: Math.min(s.rect.left, window.innerWidth - 270), ...(below ? {top: s.rect.bottom + 6} : {bottom: window.innerHeight - s.rect.top + 6})};
  return (
    <div className="slash" style={style} ref={list} role="listbox" aria-label="Insert">
      {!s.items.length && <div className="none">No matching block</div>}
      {s.items.map((item, i) => (
        <button
          key={item.title}
          role="option"
          aria-selected={i === s.index}
          className={i === s.index ? 'on' : ''}
          onMouseDown={e => {
            e.preventDefault();
            s.pick(item);
          }}
          onMouseEnter={() => set({...s, index: i})}
        >
          <span className="slash-icon">{item.icon}</span>
          <span>
            {item.title}
            <small>{item.hint}</small>
          </span>
        </button>
      ))}
    </div>
  );
}
