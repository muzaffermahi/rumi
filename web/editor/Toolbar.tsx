import type React from 'react';
import {useEffect, useReducer, useRef, useState} from 'react';
import type {Editor} from '@tiptap/react';
import {show} from '../keys';
import {IMAGE_EVENT} from './slash';
import {Icon} from '../Icon';

type Props = {
  editor: Editor;
  saveStatus: string;
  saveFailed: boolean;
  words: number;
  delegateKey: string;
  outline: boolean;
  onOutline: () => void;
  focus: boolean;
  onFocus: () => void;
  onHistory: () => void;
  onExport: (format: 'md' | 'html' | 'txt' | 'print' | 'copy') => void;
  onDelegate: () => void;
  onRename: () => void;
  onDelete: () => void;
};

// One formatting button. `extra` ones step aside on small screens (they're also in the slash menu).
function B({label, title, active, run, kbd, extra}: {label: React.ReactNode; title: string; active?: string; run: () => void; kbd?: string; extra?: boolean}) {
  return (
    <button
      className={[active, extra && 'extra'].filter(Boolean).join(' ')}
      onClick={run}
      aria-label={title}
      title={kbd ? `${title} (${kbd})` : title}
      aria-pressed={active === 'on'}
    >
      {label}
    </button>
  );
}

// Formatting on the left; words, save state, views and the document menu on the right.
export function Toolbar({
  editor,
  saveStatus,
  saveFailed,
  words,
  delegateKey,
  outline,
  onOutline,
  focus,
  onFocus,
  onHistory,
  onExport,
  onDelegate,
  onRename,
  onDelete,
}: Props) {
  const [, redraw] = useReducer(n => n + 1, 0);
  useEffect(() => {
    editor.on('transaction', redraw);
    return () => {
      editor.off('transaction', redraw);
    };
  }, [editor]);
  const [linking, setLinking] = useState(false);
  const [url, setUrl] = useState('');
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [menu]);

  const c = () => editor.chain().focus();
  const on = (name: string, attrs?: Record<string, unknown>) => (editor.isActive(name, attrs) ? 'on' : '');
  const inTable = editor.isActive('table');
  function startLink() {
    setUrl(editor.getAttributes('link').href || '');
    setLinking(true);
  }
  function applyLink() {
    const href = url.trim();
    if (!href) c().extendMarkRange('link').unsetLink().run();
    else
      c()
        .extendMarkRange('link')
        .setLink({href: /^[a-z]+:|^\/|^#/i.test(href) ? href : `https://${href}`})
        .run();
    setLinking(false);
  }
  return (
    <div className="doc-bar" role="toolbar" aria-label="Formatting">
      {linking ? (
        <form
          className="format"
          onSubmit={e => {
            e.preventDefault();
            applyLink();
          }}
        >
          <input
            autoFocus
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="Paste a link, or leave empty to remove"
            aria-label="Link address"
            style={{width: 280}}
            onKeyDown={e => e.key === 'Escape' && setLinking(false)}
          />
          <button className="ghost">Apply</button>
          <button type="button" className="ghost" onClick={() => setLinking(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <div className="format">
          <B label={<b>B</b>} title="Bold" kbd={show('Mod+B')} active={on('bold')} run={() => c().toggleBold().run()} />
          <B label={<i>I</i>} title="Italic" kbd={show('Mod+I')} active={on('italic')} run={() => c().toggleItalic().run()} />
          <B label={<s>S</s>} title="Strikethrough" extra active={on('strike')} run={() => c().toggleStrike().run()} />
          <B label={<code style={{background: 'none'}}>{'<>'}</code>} title="Inline code" extra active={on('code')} run={() => c().toggleCode().run()} />
          <B label={<Icon name="link" />} title="Link" active={on('link')} run={startLink} />
          <span className="sep" />
          <B label="H1" title="Heading 1" active={on('heading', {level: 1})} run={() => c().toggleHeading({level: 1}).run()} />
          <B label="H2" title="Heading 2" active={on('heading', {level: 2})} run={() => c().toggleHeading({level: 2}).run()} />
          <B label="H3" title="Heading 3" extra active={on('heading', {level: 3})} run={() => c().toggleHeading({level: 3}).run()} />
          <span className="sep" />
          <B label={<Icon name="bullets" />} title="Bulleted list" active={on('bulletList')} run={() => c().toggleBulletList().run()} />
          <B label={<Icon name="numbers" />} title="Numbered list" active={on('orderedList')} run={() => c().toggleOrderedList().run()} />
          <B label={<Icon name="checklist" />} title="Checklist" active={on('taskList')} run={() => c().toggleTaskList().run()} />
          <B label={<Icon name="quote" />} title="Quote" extra active={on('blockquote')} run={() => c().toggleBlockquote().run()} />
          <B label={<Icon name="code" />} title="Code block" extra active={on('codeBlock')} run={() => c().toggleCodeBlock().run()} />
          <B
            label={<Icon name="table" />}
            title="Table"
            extra
            active={inTable ? 'on' : ''}
            run={() => c().insertTable({rows: 3, cols: 3, withHeaderRow: true}).run()}
          />
          <B label={<Icon name="image" />} title="Image" extra run={() => window.dispatchEvent(new Event(IMAGE_EVENT))} />
          {inTable && (
            <>
              <span className="sep" />
              <B label="+row" title="Add a row below" run={() => c().addRowAfter().run()} />
              <B label="+col" title="Add a column to the right" run={() => c().addColumnAfter().run()} />
              <B label="−row" title="Delete this row" run={() => c().deleteRow().run()} />
              <B label="−col" title="Delete this column" run={() => c().deleteColumn().run()} />
              <B label="✕" title="Delete the table" run={() => c().deleteTable().run()} />
            </>
          )}
        </div>
      )}
      <span className="grow" />
      <span className="words" title="Words in this document">
        {words.toLocaleString()} {words === 1 ? 'word' : 'words'}
      </span>
      <span className={`save${saveFailed ? ' bad' : ''}`} role="status">
        {saveStatus}
      </span>
      <button className={`ghost${outline ? ' on' : ''}`} onClick={onOutline} title="Outline" aria-pressed={outline}>
        <Icon name="outline" />
      </button>
      <button className={`ghost${focus ? ' on' : ''}`} onClick={onFocus} title="Focus mode" aria-pressed={focus}>
        <Icon name="focus" />
      </button>
      <div className="bar-menu" ref={menuRef}>
        <button className="ghost" onClick={() => setMenu(m => !m)} aria-haspopup="menu" aria-expanded={menu} title="Document">
          <Icon name="more" />
        </button>
        {menu && (
          <div className="menu" role="menu" onClick={() => setMenu(false)}>
            <button role="menuitem" onClick={onRename}>
              Rename
            </button>
            <button role="menuitem" onClick={onHistory}>
              Version history
            </button>
            <hr />
            <button role="menuitem" onClick={() => onExport('copy')}>
              Copy as Markdown
            </button>
            <button role="menuitem" onClick={() => onExport('md')}>
              Download Markdown
            </button>
            <button role="menuitem" onClick={() => onExport('html')}>
              Download HTML
            </button>
            <button role="menuitem" onClick={() => onExport('txt')}>
              Download plain text
            </button>
            <button role="menuitem" onClick={() => onExport('print')}>
              Print or save as PDF
            </button>
            <hr />
            <button role="menuitem" className="danger" onClick={onDelete}>
              Delete document
            </button>
          </div>
        )}
      </div>
      <button className="secondary" onClick={onDelegate} title={`Delegate (${delegateKey})`}>
        Delegate <kbd>{delegateKey}</kbd>
      </button>
    </div>
  );
}
