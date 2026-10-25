import React, {useEffect, useRef, useState, memo} from 'react';
import {EditorContent, Editor} from '@tiptap/react';
import {TextSelection} from '@tiptap/pm/state';
import type {Model, Task} from './api';
import {linkPassage} from './taskLink';
import {Margin} from './Margin';

export type DelegateRequest = {selection: string; offset?: number; instruction: string; model?: string; research: boolean};
type Snapshot = {text: string; from: number; to: number; offset: number};

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const shortcut = isMac ? '⌘↵' : 'Ctrl+↵';

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
  editor: Editor | null; empty: boolean; saveStatus: string; models: Model[]; defaultModel: string;
  openSignal: number; onDelegate: (r: DelegateRequest) => Promise<string | null>; onError: (m: string) => void;
  workspaceName: string; tasks: Task[]; onOpenTask: (id: string) => void; onInsertNear: (markdown: string, taskId: string) => void;
};

export const DocumentPane = memo(function DocumentPane({editor, empty, saveStatus, models, defaultModel, openSignal, onDelegate, onError, workspaceName, tasks, onOpenTask, onInsertNear}: Props) {
  const canvas = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{top: number; left: number} | null>(null);
  const [popover, setPopover] = useState<{snap: Snapshot; top: number; left: number} | null>(null);
  const [instruction, setInstruction] = useState('');
  const [model, setModel] = useState('');
  const [research, setResearch] = useState(true);
  const [tick, setTick] = useState(0); // re-measures the margin after edits and resizes
  useEffect(() => {
    if (!editor) return;
    let frame = 0;
    const bump = () => { clearTimeout(frame); frame = window.setTimeout(() => setTick(n => n + 1), 40); };
    editor.on('update', bump);
    const ro = new ResizeObserver(bump);
    if (canvas.current) ro.observe(canvas.current);
    // Clicking a highlighted passage opens its task (the caret stays where it was put).
    const click = (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest?.('[data-task]');
      if (link && editor.state.selection.empty) onOpenTask(link.getAttribute('data-task')!);
    };
    editor.view.dom.addEventListener('click', click);
    return () => { editor.off('update', bump); ro.disconnect(); editor.view.dom.removeEventListener('click', click); clearTimeout(frame); };
  }, [editor, onOpenTask]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  function position(editor: Editor, pos: number) {
    const box = canvas.current!.getBoundingClientRect();
    const c = editor.view.coordsAtPos(pos);
    return {top: c.bottom - box.top + 8, left: Math.max(0, Math.min(c.left - box.left, box.width - 300))};
  }

  // Floating Delegate button next to a non-empty selection.
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const {from, to, empty} = editor.state.selection;
      if (empty || !editor.isFocused || !editor.state.doc.textBetween(from, to).trim()) return setAnchor(null);
      setAnchor(position(editor, to));
    };
    editor.on('selectionUpdate', update);
    editor.on('focus', update);
    editor.on('blur', () => setTimeout(() => { if (!canvas.current?.contains(document.activeElement)) setAnchor(null); }));
    return () => { editor.off('selectionUpdate', update); editor.off('focus', update); };
  }, [editor]);

  function open() {
    if (!editor) return;
    const snap = snapshot(editor);
    const at = snap.text.trim() ? position(editor, snap.to) : {top: 12, left: 0};
    setPopover({snap, ...at});
    setAnchor(null);
    setTimeout(() => input.current?.focus());
  }

  function close(collapseTo?: number) {
    setPopover(null);
    if (!editor) return;
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
    const id = await onDelegate({selection: snap.text, offset: snap.offset, instruction, model: model || undefined, research});
    setBusy(false);
    if (!id) return;
    // The passage stays linked to its task: highlighted, with the task's status beside it.
    if (editor && snap.text.trim() && snap.to <= editor.state.doc.content.size) linkPassage(editor, snap.from, snap.to, id);
    setInstruction('');
    close(snap.to);
  }

  // Ctrl/⌘+Enter in the document (or anywhere outside a text field) opens the delegate box.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
      const el = document.activeElement as HTMLElement | null;
      const inEditor = !!el?.closest('.tiptap');
      if (!inEditor && el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      e.preventDefault();
      e.stopPropagation(); // before the editor turns it into a line break
      open();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [editor]);
  useEffect(() => { if (openSignal) open(); }, [openSignal]);

  const passage = popover?.snap.text.trim();
  return <section className="doc">
    <div className="doc-bar">
      <div className="format">
        <button onClick={() => editor?.chain().focus().toggleBold().run()} aria-label="Bold" title="Bold"><b>B</b></button>
        <button onClick={() => editor?.chain().focus().toggleItalic().run()} aria-label="Italic" title="Italic"><i>I</i></button>
        <button onClick={() => editor?.chain().focus().toggleHeading({level: 2}).run()} aria-label="Heading" title="Heading">H</button>
        <button onClick={() => editor?.chain().focus().toggleBulletList().run()} aria-label="List" title="List">•—</button>
      </div>
      <span className="doc-folder" title="This document and its tasks belong to this workspace">{workspaceName}</span>
      <small className="save">{saveStatus}</small>
      <button className="ghost" onClick={open} title={`Delegate (${shortcut})`}>Delegate <kbd>{shortcut}</kbd></button>
    </div>
    <div className="doc-scroll">
      <div className="canvas" ref={canvas}>
        {empty && <div className="intro"><h1>Room for a thought.</h1><p>Write freely. Select a passage and press {shortcut} to hand it to a worker — or delegate the whole document.</p></div>}
        <EditorContent editor={editor}/>
        {editor && <Margin editor={editor} tasks={tasks} canvas={canvas.current} tick={tick} onOpenTask={onOpenTask} onInsert={onInsertNear} onError={onError}/>}
        {anchor && !popover && <button className="float-delegate" style={anchor} onMouseDown={e => e.preventDefault()} onClick={open}>Delegate <kbd>{shortcut}</kbd></button>}
        {popover && <div className="popover" style={{top: popover.top, left: popover.left}} onKeyDown={e => { if (e.key === 'Escape' && !e.defaultPrevented) close(); }}>
          <div className="pop-scope">{passage ? `“${passage.slice(0, 120)}${passage.length > 120 ? '…' : ''}”` : 'Whole document'}</div>
          <input ref={input} aria-label="Task instruction" placeholder="What should the worker do? (optional)" value={instruction}
            onChange={e => setInstruction(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}/>
          <div className="pop-row">
            <select aria-label="Model for this task" value={model} onChange={e => setModel(e.target.value)}>
              <option value="">Default · {defaultModel}</option>
              {models.filter(m => m.ref !== defaultModel).map(m => <option key={m.ref} value={m.ref}>{m.ref}</option>)}
            </select>
            <button className="primary" disabled={busy} onClick={submit}>{busy ? 'Delegating…' : 'Delegate'}</button>
          </div>
          <label className="pop-check"><input type="checkbox" checked={research} onChange={e => setResearch(e.target.checked)}/> Research the web first (5–30 searches)</label>
          <small>Enter to delegate · Esc to keep writing</small>
        </div>}
      </div>
    </div>
  </section>;
});
