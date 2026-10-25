import {memo, useEffect, useRef, useState} from 'react';
import {EditorContent, type Editor} from '@tiptap/react';
import {TextSelection} from '@tiptap/pm/state';
import type {DocMeta, Kinds, Model, Preset, Task} from './api';
import {linkPassage} from './taskLink';
import {Margin} from './Margin';
import {matches, show} from './keys';
import {ModelPicker} from './ModelPicker';
import {Toolbar} from './editor/Toolbar';
import {Outline} from './editor/Outline';
import {History} from './editor/History';
import {DELEGATE_EVENT, IMAGE_EVENT, SlashMenu} from './editor/slash';

export type DelegateRequest = {selection: string; offset?: number; instruction: string; model?: string; kind: string; label?: string};
type Snapshot = {text: string; from: number; to: number; offset: number};

export function plainText(editor: Editor) {
  const doc = editor.state.doc;
  return doc.textBetween(0, doc.content.size, '\n\n', '\n');
}

function snapshot(editor: Editor): Snapshot {
  const {from, to} = editor.state.selection;
  const doc = editor.state.doc;
  return {text: doc.textBetween(from, to, '\n\n', '\n'), from, to, offset: doc.textBetween(0, from, '\n\n', '\n').length};
}

type Props = {
  editor: Editor;
  wid: string;
  doc: DocMeta;
  saveStatus: string;
  saveFailed: boolean;
  words: number;
  models: Model[];
  defaultModel: string;
  openSignal: number;
  onDelegate: (r: DelegateRequest) => Promise<string | null>;
  onError: (e: unknown) => void;
  tasks: Task[];
  onOpenTask: (id: string) => void;
  onInsert: (markdown: string, taskId: string) => void;
  onReplace: (markdown: string, taskId: string) => void;
  kinds: Kinds;
  presets: Preset[];
  lastKind: string;
  hasFolder: boolean;
  delegateKey: string;
  focus: boolean;
  onFocus: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onExport: (f: 'md' | 'html' | 'txt' | 'print' | 'copy') => void;
  conflict: boolean;
  onConflict: (keep: 'mine' | 'theirs') => void;
  onReload: () => void;
  upload: (f: File) => Promise<string>;
};

export const DocumentPane = memo(function DocumentPane(p: Props) {
  const {editor, doc, tasks, kinds, presets, hasFolder} = p;
  const canvas = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{top: number; left: number} | null>(null);
  const [popover, setPopover] = useState<{snap: Snapshot; top: number; left: number} | null>(null);
  const [instruction, setInstruction] = useState('');
  const [model, setModel] = useState('');
  const [kind, setKind] = useState('');
  const [preset, setPreset] = useState('');
  const [outline, setOutline] = useState(() => localStorage.getItem('rumi.outline') === 'on');
  const [history, setHistory] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [title, setTitle] = useState(doc.title);
  const titleRef = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  useEffect(() => setTitle(doc.title), [doc.id, doc.title]);
  useEffect(() => {
    setHistory(false);
    setPreview(null);
  }, [doc.id]);

  // The kind starts as the one used last; kinds that change files are only offered in a project folder.
  const usable = (k: string) => kinds[k] && (hasFolder || !kinds[k].needsFolder);
  const kindNow = usable(kind) ? kind : usable(p.lastKind) ? p.lastKind : Object.keys(kinds).find(usable) || 'research';
  const [tick, setTick] = useState(0); // re-measures the margin after edits and resizes
  useEffect(() => {
    let frame = 0;
    const bump = () => {
      clearTimeout(frame);
      frame = window.setTimeout(() => setTick(n => n + 1), 40);
    };
    editor.on('update', bump);
    const ro = new ResizeObserver(bump);
    if (canvas.current) ro.observe(canvas.current);
    // Clicking a highlighted passage opens its task (the caret stays where it was put).
    const click = (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest?.('[data-task]');
      if (link && editor.state.selection.empty) p.onOpenTask(link.getAttribute('data-task')!);
    };
    editor.view.dom.addEventListener('click', click);
    return () => {
      editor.off('update', bump);
      ro.disconnect();
      editor.view.dom.removeEventListener('click', click);
      clearTimeout(frame);
    };
  }, [editor, p.onOpenTask]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  function position(pos: number) {
    const box = canvas.current!.getBoundingClientRect();
    const c = editor.view.coordsAtPos(pos);
    return {top: c.bottom - box.top + 8, left: Math.max(0, Math.min(c.left - box.left, box.width - 320))};
  }

  // Floating Delegate button next to a non-empty selection.
  useEffect(() => {
    const update = () => {
      const {from, to, empty} = editor.state.selection;
      if (empty || !editor.isFocused || !editor.state.doc.textBetween(from, to).trim()) return setAnchor(null);
      setAnchor(position(to));
    };
    const blur = () => setTimeout(() => !canvas.current?.contains(document.activeElement) && setAnchor(null));
    editor.on('selectionUpdate', update);
    editor.on('focus', update);
    editor.on('blur', blur);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('focus', update);
      editor.off('blur', blur);
    };
  }, [editor]);

  function open() {
    const snap = snapshot(editor);
    const at = snap.text.trim() ? position(snap.to) : {top: 12, left: 0};
    setPopover({snap, ...at});
    setAnchor(null);
    setTimeout(() => input.current?.focus());
  }

  function close(collapseTo?: number) {
    setPopover(null);
    setPreset('');
    if (collapseTo !== undefined) {
      const {state, view} = editor;
      view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, Math.min(collapseTo, state.doc.content.size))));
    }
    editor.view.focus(); // keeps the selection and does not scroll
  }

  async function submit() {
    if (!popover || busy) return;
    setBusy(true);
    const {snap} = popover;
    const id = await p.onDelegate({
      selection: snap.text,
      offset: snap.offset,
      instruction,
      model: model || undefined,
      kind: kindNow,
      label: presets.find(pr => pr.id === preset)?.label,
    });
    setBusy(false);
    if (!id) return;
    // The passage stays linked to its task: highlighted, with the task's status beside it.
    if (snap.text.trim() && snap.to <= editor.state.doc.content.size) linkPassage(editor, snap.from, snap.to, id);
    setInstruction('');
    close(snap.to);
  }

  function applyPreset(pr: Preset) {
    if (preset === pr.id) {
      setPreset('');
      setInstruction('');
      return;
    }
    setPreset(pr.id);
    setInstruction(pr.instruction);
    if (pr.kind && usable(pr.kind)) setKind(pr.kind);
    input.current?.focus();
  }

  // The Delegate shortcut in the document (or anywhere outside a text field), and from the slash menu.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!matches(e, p.delegateKey)) return;
      const el = document.activeElement as HTMLElement | null;
      if (!el?.closest('.tiptap') && el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      e.preventDefault();
      e.stopPropagation(); // before the editor turns it into a line break
      open();
    };
    const slash = () => setTimeout(open);
    const image = () => imageInput.current?.click();
    window.addEventListener('keydown', key, true);
    window.addEventListener(DELEGATE_EVENT, slash);
    window.addEventListener(IMAGE_EVENT, image);
    return () => {
      window.removeEventListener('keydown', key, true);
      window.removeEventListener(DELEGATE_EVENT, slash);
      window.removeEventListener(IMAGE_EVENT, image);
    };
  }, [editor, p.delegateKey]);
  useEffect(() => {
    if (p.openSignal) open();
  }, [p.openSignal]);

  const passage = popover?.snap.text.trim();
  const shortcut = show(p.delegateKey);
  const visiblePresets = presets.filter(pr => !pr.kind || usable(pr.kind));
  return (
    <section className="doc" aria-label="Document">
      <Toolbar
        editor={editor}
        saveStatus={p.saveStatus}
        saveFailed={p.saveFailed}
        words={p.words}
        delegateKey={shortcut}
        outline={outline}
        onOutline={() =>
          setOutline(o => {
            localStorage.setItem('rumi.outline', o ? 'off' : 'on');
            return !o;
          })
        }
        focus={p.focus}
        onFocus={p.onFocus}
        onHistory={() => setHistory(true)}
        onExport={p.onExport}
        onDelegate={open}
        onRename={() => titleRef.current?.select()}
        onDelete={p.onDelete}
      />
      {p.conflict && (
        <div className="banner" role="alert">
          <span className="grow">This document was changed in another tab or window. Your latest edits are not saved yet.</span>
          <button className="secondary" onClick={() => p.onConflict('theirs')}>
            Load theirs
          </button>
          <button className="primary" onClick={() => p.onConflict('mine')}>
            Keep mine
          </button>
        </div>
      )}
      <div className="doc-body">
        <div className="doc-scroll" id="main">
          <div className="canvas" ref={canvas}>
            <input
              ref={titleRef}
              className="doc-title"
              value={title}
              aria-label="Document title"
              placeholder="Untitled"
              onChange={e => {
                setTitle(e.target.value);
                p.onRename(e.target.value);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  // Focus right away (TipTap's focus() waits a frame, and the next keys would land in the title).
                  editor.view.focus();
                  editor.commands.setTextSelection(1);
                }
              }}
            />
            {preview !== null ? <div className="tiptap preview" dangerouslySetInnerHTML={{__html: preview}} /> : <EditorContent editor={editor} />}
            {preview === null && (
              <Margin
                editor={editor}
                tasks={tasks}
                canvas={canvas.current}
                tick={tick}
                onOpenTask={p.onOpenTask}
                onInsert={p.onInsert}
                onReplace={p.onReplace}
                onError={p.onError}
              />
            )}
            {anchor && !popover && (
              <button className="float-delegate" style={anchor} onMouseDown={e => e.preventDefault()} onClick={open}>
                Delegate <kbd>{shortcut}</kbd>
              </button>
            )}
            {popover && (
              <div
                className="popover"
                role="dialog"
                aria-label="Delegate"
                style={{top: popover.top, left: popover.left}}
                onKeyDown={e => e.key === 'Escape' && !e.defaultPrevented && close()}
              >
                <div className="pop-scope">{passage ? `“${passage.slice(0, 120)}${passage.length > 120 ? '…' : ''}”` : 'Whole document'}</div>
                <div className="kinds" role="radiogroup" aria-label="Kind of help">
                  {Object.entries(kinds)
                    .filter(([k]) => usable(k))
                    .map(([key, k]) => (
                      <button
                        key={key}
                        role="radio"
                        aria-checked={kindNow === key}
                        className={`kind${kindNow === key ? ' on' : ''}`}
                        title={k.hint}
                        onClick={() => setKind(key)}
                      >
                        {k.label}
                      </button>
                    ))}
                </div>
                <div className="kind-hint">{kinds[kindNow]?.hint}</div>
                {!!visiblePresets.length && (
                  <div className="presets" aria-label="Saved instructions">
                    {visiblePresets.map(pr => (
                      <button key={pr.id} className={`preset${preset === pr.id ? ' on' : ''}`} onClick={() => applyPreset(pr)} title={pr.instruction}>
                        {pr.label}
                      </button>
                    ))}
                  </div>
                )}
                <input
                  ref={input}
                  aria-label="Task instruction"
                  placeholder="What should the worker do? (optional)"
                  value={instruction}
                  onChange={e => {
                    setInstruction(e.target.value);
                    setPreset('');
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                />
                <div className="pop-row">
                  <div style={{flex: 1, minWidth: 0}}>
                    <ModelPicker
                      models={p.models}
                      value={model}
                      onChange={setModel}
                      defaultLabel={`Default · ${p.defaultModel || 'none'}`}
                      label="Model for this task"
                    />
                  </div>
                  <button className="primary" disabled={busy} onClick={submit}>
                    {busy ? 'Delegating…' : 'Delegate'}
                  </button>
                </div>
                <small>Enter to delegate · Esc to keep writing</small>
              </div>
            )}
          </div>
        </div>
        {outline && preview === null && <Outline editor={editor} />}
        {history && <History wid={p.wid} docId={doc.id} onPreview={setPreview} onRestored={p.onReload} onClose={() => setHistory(false)} />}
      </div>
      <SlashMenu />
      <input
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        hidden
        onChange={async e => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            editor
              .chain()
              .focus()
              .setImage({src: await p.upload(f), alt: f.name.replace(/\.[^.]+$/, '')})
              .run();
          } catch (err) {
            p.onError(err);
          }
        }}
      />
    </section>
  );
});
