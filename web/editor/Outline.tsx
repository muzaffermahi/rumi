import {useEffect, useState} from 'react';
import type {Editor} from '@tiptap/react';

type Heading = {level: number; text: string; pos: number};

// The document's headings, beside the page. Click one to jump there.
export function Outline({editor}: {editor: Editor}) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  useEffect(() => {
    let timer = 0;
    const read = () => {
      const out: Heading[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading' && node.textContent.trim()) out.push({level: node.attrs.level, text: node.textContent, pos});
        return node.isBlock && node.type.name !== 'heading';
      });
      setHeadings(out);
    };
    const later = () => {
      clearTimeout(timer);
      timer = window.setTimeout(read, 250);
    };
    read();
    editor.on('update', later);
    return () => {
      editor.off('update', later);
      clearTimeout(timer);
    };
  }, [editor]);
  function go(pos: number) {
    editor
      .chain()
      .focus()
      .setTextSelection(pos + 1)
      .run();
    editor.view.domAtPos(pos + 1).node.parentElement?.scrollIntoView({block: 'start', behavior: 'smooth'});
  }
  return (
    <nav className="outline" aria-label="Outline">
      <h3>Outline</h3>
      {!headings.length && <p className="quiet">Headings you add appear here.</p>}
      {headings.map(h => (
        <button key={h.pos} className={`l${h.level}`} onClick={() => go(h.pos)} title={h.text}>
          {h.text}
        </button>
      ))}
    </nav>
  );
}
