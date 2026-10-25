// The editor's building blocks: TipTap's starter kit plus checklists, tables, highlighted code, images (pasted or
// dropped images are uploaded to the workspace), a placeholder, focus tracking for focus mode, task links and the
// slash menu.
import {Extension} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {TaskItem, TaskList} from '@tiptap/extension-list';
import {TableKit} from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import {CharacterCount, Focus, Placeholder} from '@tiptap/extensions';
import {Plugin} from '@tiptap/pm/state';
import {common, createLowlight} from 'lowlight';
import {TaskLink} from '../taskLink';
import {SlashCommand} from './slash';

const lowlight = createLowlight(common);

export type Upload = (file: File) => Promise<string>;

// Images pasted or dropped into the document are stored in the workspace and linked by URL, never inlined as base64.
const ImageDrop = Extension.create<{upload: Upload | null}>({
  name: 'imageDrop',
  addOptions: () => ({upload: null}),
  addProseMirrorPlugins() {
    const upload = this.options.upload;
    const editor = this.editor;
    const insert = (files: File[], pos?: number) => {
      const images = files.filter(f => /^image\/(png|jpeg|gif|webp)$/.test(f.type));
      if (!images.length || !upload) return false;
      for (const f of images) {
        upload(f).then(src => {
          const chain = editor.chain().focus();
          (pos === undefined ? chain : chain.setTextSelection(pos)).setImage({src, alt: f.name.replace(/\.[^.]+$/, '')}).run();
        });
      }
      return true;
    };
    return [
      new Plugin({
        props: {
          handlePaste: (_view, event) => insert([...(event.clipboardData?.files || [])]),
          handleDrop: (view, event) => {
            const files = [...((event as DragEvent).dataTransfer?.files || [])];
            if (!files.length) return false;
            const at = view.posAtCoords({left: (event as DragEvent).clientX, top: (event as DragEvent).clientY});
            return insert(files, at?.pos);
          },
        },
      }),
    ];
  },
});

export function extensions({upload, placeholder = 'Write, or type / for headings, lists, tables…'}: {upload: Upload | null; placeholder?: string}) {
  return [
    StarterKit.configure({codeBlock: false, link: {openOnClick: false, autolink: true, defaultProtocol: 'https'}}),
    TaskList,
    TaskItem.configure({nested: true}),
    TableKit.configure({table: {resizable: true}}),
    Image.configure({allowBase64: false}),
    CodeBlockLowlight.configure({lowlight, defaultLanguage: null}),
    Placeholder.configure({placeholder, showOnlyCurrent: true}),
    CharacterCount,
    Focus.configure({className: 'has-focus', mode: 'shallowest'}),
    ImageDrop.configure({upload}),
    TaskLink,
    SlashCommand,
  ];
}
