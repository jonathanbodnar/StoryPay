'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import TiptapLink from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { TextStyle, Color } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import { useRef, useState } from 'react';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  List, ListOrdered, ListChecks,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Heading1, Heading2, Heading3,
  Quote, Minus, Link2, Undo2, Redo2,
  Table as TableIcon, Image as ImageIcon,
  Highlighter, Subscript as SubscriptIcon, Superscript as SuperscriptIcon,
  RemoveFormatting, ChevronDown,
  Code, Code2,
  Indent, Outdent,
} from 'lucide-react';

interface RichTextEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}

// ─── Toolbar primitives ──────────────────────────────────────────────────────

function Btn({
  onClick, active, title, disabled, children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      title={title}
      disabled={disabled}
      className={`flex items-center justify-center h-7 w-7 rounded transition-colors flex-shrink-0 ${
        active
          ? 'bg-brand-900 text-white'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
      } disabled:opacity-30 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <div className="w-px h-5 bg-gray-200 mx-1 flex-shrink-0" />;
}

function DropdownBtn({
  label, title, children,
}: { label: string; title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        type="button"
        title={title}
        onMouseDown={(e) => { e.preventDefault(); setOpen(v => !v); }}
        className="flex items-center gap-0.5 h-7 px-1.5 rounded text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors"
      >
        {label}
        <ChevronDown size={11} />
      </button>
      {open && (
        <div
          className="absolute top-full left-0 mt-1 z-50 min-w-[130px] rounded-lg border border-gray-200 bg-white shadow-lg py-1"
          onMouseDown={(e) => e.preventDefault()}
        >
          {children}
        </div>
      )}
      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
    </div>
  );
}

function DropItem({ onClick, active, children }: { onClick: () => void; active?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={`flex w-full items-center px-3 py-1.5 text-sm transition-colors ${
        active ? 'bg-brand-900/10 font-semibold text-brand-900' : 'text-gray-700 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  );
}

// Color swatches
const TEXT_COLORS = [
  { label: 'Black',   value: '#000000' },
  { label: 'Gray',    value: '#6b7280' },
  { label: 'Red',     value: '#ef4444' },
  { label: 'Orange',  value: '#f97316' },
  { label: 'Amber',   value: '#f59e0b' },
  { label: 'Green',   value: '#10b981' },
  { label: 'Blue',    value: '#3b82f6' },
  { label: 'Violet',  value: '#8b5cf6' },
  { label: 'Brand',   value: '#293745' },
];

const HIGHLIGHT_COLORS = [
  { label: 'Yellow',  value: '#fef08a' },
  { label: 'Green',   value: '#bbf7d0' },
  { label: 'Blue',    value: '#bfdbfe' },
  { label: 'Pink',    value: '#fbcfe8' },
  { label: 'Orange',  value: '#fed7aa' },
  { label: 'Clear',   value: null },
];

// ─── Main editor ─────────────────────────────────────────────────────────────

export default function RichTextEditor({
  content, onChange, placeholder, minHeight = 500,
}: RichTextEditorProps) {
  const s = 14;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] }, codeBlock: {} }),
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TiptapLink.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: placeholder || 'Start writing your proposal...' }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Subscript,
      Superscript,
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Image.configure({ inline: false, allowBase64: true }),
    ],
    content,
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
    editorProps: {
      attributes: {
        class: 'focus:outline-none',
        style: `min-height:${minHeight}px`,
      },
    },
  });

  if (!editor) return null;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function setLink() {
    const prev = editor.getAttributes('link').href;
    const url = window.prompt('URL:', prev || 'https://');
    if (url === null) return;
    if (url === '') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url, target: '_blank' }).run();
  }

  function insertImage() {
    const url = window.prompt('Image URL:');
    if (url) editor.chain().focus().setImage({ src: url }).run();
  }

  function insertTable() {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  }

  // ── Toolbar ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col rounded-xl border border-gray-300 overflow-hidden focus-within:border-brand-900 focus-within:ring-2 focus-within:ring-brand-900/20 transition bg-white shadow-sm">

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-gray-200 bg-gray-50/80 sticky top-0 z-10">

        {/* Undo / Redo */}
        <Btn onClick={() => editor.chain().focus().undo().run()} title="Undo" disabled={!editor.can().undo()}>
          <Undo2 size={s} />
        </Btn>
        <Btn onClick={() => editor.chain().focus().redo().run()} title="Redo" disabled={!editor.can().redo()}>
          <Redo2 size={s} />
        </Btn>

        <Sep />

        {/* Paragraph / Heading dropdown */}
        <DropdownBtn label={
          editor.isActive('heading', { level: 1 }) ? 'Heading 1' :
          editor.isActive('heading', { level: 2 }) ? 'Heading 2' :
          editor.isActive('heading', { level: 3 }) ? 'Heading 3' :
          editor.isActive('heading', { level: 4 }) ? 'Heading 4' :
          editor.isActive('codeBlock') ? 'Code Block' :
          'Normal'
        } title="Text style">
          <DropItem onClick={() => editor.chain().focus().setParagraph().run()} active={editor.isActive('paragraph')}>
            <span className="text-sm">Normal text</span>
          </DropItem>
          <DropItem onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })}>
            <span className="text-2xl font-bold leading-tight">Heading 1</span>
          </DropItem>
          <DropItem onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })}>
            <span className="text-xl font-semibold">Heading 2</span>
          </DropItem>
          <DropItem onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })}>
            <span className="text-lg font-semibold">Heading 3</span>
          </DropItem>
          <DropItem onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()} active={editor.isActive('heading', { level: 4 })}>
            <span className="text-base font-semibold">Heading 4</span>
          </DropItem>
          <DropItem onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive('codeBlock')}>
            <span className="font-mono text-xs">Code Block</span>
          </DropItem>
        </DropdownBtn>

        <Sep />

        {/* Basic formatting */}
        <Btn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold (Ctrl+B)">
          <Bold size={s} />
        </Btn>
        <Btn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic (Ctrl+I)">
          <Italic size={s} />
        </Btn>
        <Btn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline (Ctrl+U)">
          <UnderlineIcon size={s} />
        </Btn>
        <Btn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough">
          <Strikethrough size={s} />
        </Btn>
        <Btn onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} title="Inline Code">
          <Code size={s} />
        </Btn>
        <Btn onClick={() => editor.chain().focus().toggleSubscript().run()} active={editor.isActive('subscript')} title="Subscript">
          <SubscriptIcon size={s} />
        </Btn>
        <Btn onClick={() => editor.chain().focus().toggleSuperscript().run()} active={editor.isActive('superscript')} title="Superscript">
          <SuperscriptIcon size={s} />
        </Btn>

        <Sep />

        {/* Text color */}
        <DropdownBtn label="A" title="Text color">
          <div className="px-2 py-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Text Color</p>
            <div className="grid grid-cols-5 gap-1">
              {TEXT_COLORS.map(c => (
                <button
                  key={c.value}
                  type="button"
                  title={c.label}
                  onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().setColor(c.value).run(); }}
                  className="h-5 w-5 rounded border border-gray-200 hover:scale-110 transition-transform"
                  style={{ backgroundColor: c.value }}
                />
              ))}
            </div>
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().unsetColor().run(); }}
              className="mt-2 w-full text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
            >
              <RemoveFormatting size={11} /> Remove color
            </button>
          </div>
        </DropdownBtn>

        {/* Highlight */}
        <DropdownBtn label="🖊" title="Highlight">
          <div className="px-2 py-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Highlight</p>
            <div className="grid grid-cols-3 gap-1">
              {HIGHLIGHT_COLORS.map(c => (
                <button
                  key={c.label}
                  type="button"
                  title={c.label}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (!c.value) { editor.chain().focus().unsetHighlight().run(); }
                    else { editor.chain().focus().toggleHighlight({ color: c.value }).run(); }
                  }}
                  className="h-6 w-full rounded border border-gray-200 text-xs font-medium hover:scale-105 transition-transform flex items-center justify-center"
                  style={{ backgroundColor: c.value ?? '#f9fafb' }}
                >
                  {c.value ? '' : '✕'}
                </button>
              ))}
            </div>
          </div>
        </DropdownBtn>

        <Sep />

        {/* Alignment */}
        <Btn onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Align left">
          <AlignLeft size={s} />
        </Btn>
        <Btn onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Align center">
          <AlignCenter size={s} />
        </Btn>
        <Btn onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Align right">
          <AlignRight size={s} />
        </Btn>
        <Btn onClick={() => editor.chain().focus().setTextAlign('justify').run()} active={editor.isActive({ textAlign: 'justify' })} title="Justify">
          <AlignJustify size={s} />
        </Btn>

        <Sep />

        {/* Lists */}
        <Btn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list">
          <List size={s} />
        </Btn>
        <Btn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list">
          <ListOrdered size={s} />
        </Btn>
        <Btn onClick={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive('taskList')} title="Checklist">
          <ListChecks size={s} />
        </Btn>
        <Btn onClick={() => editor.chain().focus().sinkListItem('listItem').run()} title="Indent" disabled={!editor.can().sinkListItem('listItem')}>
          <Indent size={s} />
        </Btn>
        <Btn onClick={() => editor.chain().focus().liftListItem('listItem').run()} title="Outdent" disabled={!editor.can().liftListItem('listItem')}>
          <Outdent size={s} />
        </Btn>

        <Sep />

        {/* Block elements */}
        <Btn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Blockquote">
          <Quote size={s} />
        </Btn>
        <Btn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Horizontal rule">
          <Minus size={s} />
        </Btn>

        <Sep />

        {/* Links, images, tables */}
        <Btn onClick={setLink} active={editor.isActive('link')} title="Insert / edit link">
          <Link2 size={s} />
        </Btn>
        <Btn onClick={insertImage} title="Insert image (by URL)">
          <ImageIcon size={s} />
        </Btn>
        <Btn onClick={insertTable} title="Insert table">
          <TableIcon size={s} />
        </Btn>

        {/* Table sub-controls */}
        {editor.isActive('table') && (
          <>
            <Sep />
            <DropdownBtn label="Table" title="Table options">
              <DropItem onClick={() => editor.chain().focus().addColumnBefore().run()}>Add column before</DropItem>
              <DropItem onClick={() => editor.chain().focus().addColumnAfter().run()}>Add column after</DropItem>
              <DropItem onClick={() => editor.chain().focus().deleteColumn().run()}>Delete column</DropItem>
              <DropItem onClick={() => editor.chain().focus().addRowBefore().run()}>Add row above</DropItem>
              <DropItem onClick={() => editor.chain().focus().addRowAfter().run()}>Add row below</DropItem>
              <DropItem onClick={() => editor.chain().focus().deleteRow().run()}>Delete row</DropItem>
              <DropItem onClick={() => editor.chain().focus().toggleHeaderRow().run()}>Toggle header row</DropItem>
              <DropItem onClick={() => editor.chain().focus().mergeCells().run()}>Merge cells</DropItem>
              <DropItem onClick={() => editor.chain().focus().splitCell().run()}>Split cell</DropItem>
              <DropItem onClick={() => editor.chain().focus().deleteTable().run()}>Delete table</DropItem>
            </DropdownBtn>
          </>
        )}

        <Sep />

        {/* Clear formatting */}
        <Btn onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()} title="Clear formatting">
          <RemoveFormatting size={s} />
        </Btn>

      </div>

      {/* ── Document area ── */}
      <div className="flex-1 overflow-y-auto bg-white">
        <div className="w-full px-6 sm:px-10 py-8">
          <style>{`
            .tiptap-editor h1 { font-size: 2rem; font-weight: 700; margin-bottom: 0.75rem; font-family: 'Playfair Display', Georgia, serif; }
            .tiptap-editor h2 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.6rem; }
            .tiptap-editor h3 { font-size: 1.25rem; font-weight: 600; margin-bottom: 0.5rem; }
            .tiptap-editor h4 { font-size: 1.1rem; font-weight: 600; margin-bottom: 0.4rem; }
            .tiptap-editor p { margin-bottom: 0.75rem; line-height: 1.7; color: #1f2937; }
            .tiptap-editor ul { list-style: disc; padding-left: 1.5rem; margin-bottom: 0.75rem; }
            .tiptap-editor ol { list-style: decimal; padding-left: 1.5rem; margin-bottom: 0.75rem; }
            .tiptap-editor li { margin-bottom: 0.25rem; line-height: 1.6; }
            .tiptap-editor blockquote { border-left: 3px solid #293745; padding-left: 1rem; color: #4b5563; font-style: italic; margin: 1rem 0; }
            .tiptap-editor hr { border: none; border-top: 1px solid #e5e7eb; margin: 1.5rem 0; }
            .tiptap-editor a { color: #293745; text-decoration: underline; }
            .tiptap-editor code { background: #f1f5f9; border-radius: 3px; padding: 0.1em 0.3em; font-size: 0.875em; font-family: monospace; }
            .tiptap-editor pre { background: #1e293b; color: #e2e8f0; border-radius: 8px; padding: 1rem; overflow-x: auto; margin-bottom: 0.75rem; }
            .tiptap-editor pre code { background: none; padding: 0; font-size: 0.85em; }
            .tiptap-editor img { max-width: 100%; border-radius: 6px; margin: 0.5rem 0; }
            .tiptap-editor table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; }
            .tiptap-editor th { background: #293745; color: white; font-weight: 600; text-align: left; padding: 8px 12px; border: 1px solid #293745; }
            .tiptap-editor td { padding: 8px 12px; border: 1px solid #e5e7eb; vertical-align: top; }
            .tiptap-editor tr:nth-child(even) td { background: #f9fafb; }
            .tiptap-editor ul[data-type="taskList"] { list-style: none; padding-left: 0; }
            .tiptap-editor ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 0.5rem; }
            .tiptap-editor ul[data-type="taskList"] li > label { margin-top: 0.2rem; }
            .tiptap-editor .is-editor-empty:first-child::before { content: attr(data-placeholder); float: left; color: #9ca3af; pointer-events: none; height: 0; }
            .tiptap-editor mark { border-radius: 2px; padding: 0.1em 0.2em; }
          `}</style>
          <EditorContent editor={editor} className="tiptap-editor" />
        </div>
      </div>

      {/* ── Word count footer ── */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-gray-100 bg-gray-50/60 text-[11px] text-gray-400">
        <span>
          {editor.storage.characterCount
            ? `${editor.getText().split(/\s+/).filter(Boolean).length} words`
            : `${editor.getText().split(/\s+/).filter(Boolean).length} words`}
        </span>
        <span>
          {editor.getText().replace(/\s/g, '').length} characters
        </span>
      </div>
    </div>
  );
}
