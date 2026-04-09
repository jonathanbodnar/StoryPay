'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import TiptapLink from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { TextStyle, Color, FontFamily } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
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
  label, title, icon, align = 'left', children,
}: { label: string; title: string; icon?: React.ReactNode; align?: 'left' | 'right'; children: React.ReactNode }) {
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
        {icon ?? label}
        <ChevronDown size={11} />
      </button>
      {open && (
        <div
          className={`absolute top-full mt-1 z-50 min-w-[180px] rounded-lg border border-gray-200 bg-white shadow-lg py-1 ${align === 'right' ? 'right-0' : 'left-0'}`}
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

// Google Fonts available in editor
const GOOGLE_FONTS = [
  { label: 'Default',           value: '' },
  { label: 'Playfair Display',  value: "'Playfair Display', serif" },
  { label: 'Open Sans',         value: "'Open Sans', sans-serif" },
  { label: 'Lato',              value: "'Lato', sans-serif" },
  { label: 'Montserrat',        value: "'Montserrat', sans-serif" },
  { label: 'Raleway',           value: "'Raleway', sans-serif" },
  { label: 'Merriweather',      value: "'Merriweather', serif" },
  { label: 'Cormorant Garamond',value: "'Cormorant Garamond', serif" },
  { label: 'EB Garamond',       value: "'EB Garamond', serif" },
  { label: 'Libre Baskerville', value: "'Libre Baskerville', serif" },
  { label: 'Roboto',            value: "'Roboto', sans-serif" },
  { label: 'Inter',             value: "'Inter', sans-serif" },
  { label: 'Nunito',            value: "'Nunito', sans-serif" },
  { label: 'Poppins',           value: "'Poppins', sans-serif" },
  { label: 'Dancing Script',    value: "'Dancing Script', cursive" },
  { label: 'Great Vibes',       value: "'Great Vibes', cursive" },
  { label: 'Pacifico',          value: "'Pacifico', cursive" },
  { label: 'Courier Prime',     value: "'Courier Prime', monospace" },
];

// Full color palette — matches reference grid
const TEXT_COLORS = [
  '#000000','#111827','#374151','#6b7280','#9ca3af','#d1d5db','#e5e7eb','#f3f4f6','#f9fafb','#ffffff',
  '#7f1d1d','#b91c1c','#ef4444','#f87171','#fca5a5','#fecaca','#fee2e2','#fff1f2',
  '#78350f','#d97706','#f59e0b','#fbbf24','#fcd34d','#fde68a','#fef3c7',
  '#14532d','#15803d','#22c55e','#4ade80','#86efac','#bbf7d0','#dcfce7',
  '#164e63','#0e7490','#06b6d4','#38bdf8','#7dd3fc','#bae6fd','#e0f2fe',
  '#1e3a5f','#1b1b1b','#1b1b1b','#555555','#aaaaaa','#e5e5e5','#f5f5f5',
  '#4c1d95','#7c3aed','#8b5cf6','#a78bfa','#c4b5fd','#ddd6fe','#ede9fe',
  '#831843','#be185d','#ec4899','#f472b6','#f9a8d4','#fbcfe8','#fce7f3',
  '#1b1b1b','#2d2d2d','#555555','#888888','#a8bed3','#d4e2ee',
];

const HIGHLIGHT_COLORS = [
  '#fef08a','#fde68a','#fef3c7',
  '#bbf7d0','#86efac','#dcfce7',
  '#e5e5e5','#aaaaaa','#f5f5f5',
  '#f9a8d4','#fbcfe8','#fce7f3',
  '#fed7aa','#fdba74','#fff7ed',
  '#e9d5ff','#c4b5fd','#ede9fe',
  '#99f6e4','#5eead4','#ccfbf1',
  '#e2e8f0','#cbd5e1','#f1f5f9',
];

// ─── Main editor ─────────────────────────────────────────────────────────────

export default function RichTextEditor({
  content, onChange, placeholder, minHeight = 500,
}: RichTextEditorProps) {
  const s = 14;
  const prevContent = useRef(content);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] }, codeBlock: {} }),
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TiptapLink.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: placeholder || 'Start writing your proposal...' }),
      TextStyle,
      Color,
      FontFamily,
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
    onUpdate: ({ editor: e }) => {
      const html = e.getHTML();
      prevContent.current = html;
      onChange(html);
    },
    editorProps: {
      attributes: {
        class: 'focus:outline-none',
        style: `min-height:${minHeight}px`,
      },
    },
  });

  // When content is set externally (e.g. AI generation), push it into the editor
  useEffect(() => {
    if (!editor) return;
    if (content !== prevContent.current) {
      prevContent.current = content;
      editor.commands.setContent(content || '');
    }
  }, [content, editor]);

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
            <span className="text-xl font-bold leading-tight whitespace-nowrap">Heading 1</span>
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

        {/* Font family */}
        <DropdownBtn label="Font" title="Font family">
          <div className="py-1 min-w-[200px] max-h-72 overflow-y-auto">
            {GOOGLE_FONTS.map(f => (
              <DropItem
                key={f.value}
                onClick={() => {
                  if (f.value) editor.chain().focus().setFontFamily(f.value).run();
                  else editor.chain().focus().unsetFontFamily().run();
                }}
                active={editor.getAttributes('textStyle').fontFamily === f.value}
              >
                <span style={{ fontFamily: f.value || 'inherit' }}>{f.label}</span>
              </DropItem>
            ))}
          </div>
        </DropdownBtn>

        <Sep />

        {/* Text color — full palette + custom */}
        <DropdownBtn label="A" title="Text color">
          <div className="px-3 py-2.5 w-56">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Text Color</p>
            <div className="grid grid-cols-10 gap-1 mb-2">
              {TEXT_COLORS.map(hex => (
                <button
                  key={hex}
                  type="button"
                  title={hex}
                  onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().setColor(hex).run(); }}
                  className="h-4 w-4 rounded-full border border-gray-200 hover:scale-125 transition-transform"
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>
            <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
              <label className="text-[10px] text-gray-500 font-medium cursor-pointer flex items-center gap-1.5">
                <span>Custom</span>
                <input
                  type="color"
                  className="h-5 w-5 rounded cursor-pointer border-0 p-0"
                  onInput={(e) => { editor.chain().focus().setColor((e.target as HTMLInputElement).value).run(); }}
                />
              </label>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().unsetColor().run(); }}
                className="ml-auto text-[10px] text-gray-400 hover:text-gray-700 flex items-center gap-1"
              >
                <RemoveFormatting size={10} /> Clear
              </button>
            </div>
          </div>
        </DropdownBtn>

        {/* Highlight — full palette + custom */}
        <DropdownBtn label="H" title="Highlight color">
          <div className="px-3 py-2.5 w-56">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Highlight Color</p>
            <div className="grid grid-cols-8 gap-1 mb-2">
              {HIGHLIGHT_COLORS.map(hex => (
                <button
                  key={hex}
                  type="button"
                  title={hex}
                  onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleHighlight({ color: hex }).run(); }}
                  className="h-5 w-5 rounded-full border border-gray-200 hover:scale-125 transition-transform"
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>
            <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
              <label className="text-[10px] text-gray-500 font-medium cursor-pointer flex items-center gap-1.5">
                <span>Custom</span>
                <input
                  type="color"
                  className="h-5 w-5 rounded cursor-pointer border-0 p-0"
                  onInput={(e) => { editor.chain().focus().toggleHighlight({ color: (e.target as HTMLInputElement).value }).run(); }}
                />
              </label>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().unsetHighlight().run(); }}
                className="ml-auto text-[10px] text-gray-400 hover:text-gray-700 flex items-center gap-1"
              >
                <RemoveFormatting size={10} /> Clear
              </button>
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
        {/* Single table dropdown — insert + edit in one */}
        <DropdownBtn
          label=""
          title="Table"
          icon={<TableIcon size={s} />}
          align="right"
        >
          <div className="py-1 min-w-[200px]">
            <DropItem onClick={insertTable}>
              <TableIcon size={13} className="mr-2 text-gray-400" /> Insert table
            </DropItem>
            <div className="h-px bg-gray-100 my-1" />
            <DropItem onClick={() => editor.chain().focus().addColumnBefore().run()} active={false}>Add column before</DropItem>
            <DropItem onClick={() => editor.chain().focus().addColumnAfter().run()}>Add column after</DropItem>
            <DropItem onClick={() => editor.chain().focus().deleteColumn().run()}>Delete column</DropItem>
            <div className="h-px bg-gray-100 my-1" />
            <DropItem onClick={() => editor.chain().focus().addRowBefore().run()}>Add row above</DropItem>
            <DropItem onClick={() => editor.chain().focus().addRowAfter().run()}>Add row below</DropItem>
            <DropItem onClick={() => editor.chain().focus().deleteRow().run()}>Delete row</DropItem>
            <div className="h-px bg-gray-100 my-1" />
            <DropItem onClick={() => editor.chain().focus().toggleHeaderRow().run()}>Toggle header row</DropItem>
            <DropItem onClick={() => editor.chain().focus().mergeCells().run()}>Merge cells</DropItem>
            <DropItem onClick={() => editor.chain().focus().splitCell().run()}>Split cell</DropItem>
            <div className="h-px bg-gray-100 my-1" />
            <DropItem onClick={() => editor.chain().focus().deleteTable().run()}>
              <span className="text-red-500">Delete table</span>
            </DropItem>
          </div>
        </DropdownBtn>

        <Sep />

        {/* Clear formatting */}
        <Btn onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()} title="Clear formatting">
          <RemoveFormatting size={s} />
        </Btn>

      </div>

      {/* ── Document area ── */}
      <div className="flex-1 overflow-y-auto bg-white">
        {/* Google Fonts */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Open+Sans:wght@300;400;600;700&family=Lato:wght@300;400;700&family=Montserrat:wght@300;400;600;700&family=Raleway:wght@300;400;600;700&family=Merriweather:wght@300;400;700&family=Cormorant+Garamond:wght@300;400;600;700&family=EB+Garamond:wght@400;600&family=Libre+Baskerville:wght@400;700&family=Roboto:wght@300;400;700&family=Inter:wght@300;400;600;700&family=Nunito:wght@300;400;600;700&family=Poppins:wght@300;400;600;700&family=Dancing+Script:wght@400;600;700&family=Great+Vibes&family=Pacifico&family=Courier+Prime:wght@400;700&display=swap" />
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
            .tiptap-editor blockquote { border-left: 3px solid #1b1b1b; padding-left: 1rem; color: #4b5563; font-style: italic; margin: 1rem 0; }
            .tiptap-editor hr { border: none; border-top: 1px solid #e5e7eb; margin: 1.5rem 0; }
            .tiptap-editor a { color: #1b1b1b; text-decoration: underline; }
            .tiptap-editor code { background: #f1f5f9; border-radius: 3px; padding: 0.1em 0.3em; font-size: 0.875em; font-family: monospace; }
            .tiptap-editor pre { background: #1e293b; color: #e2e8f0; border-radius: 8px; padding: 1rem; overflow-x: auto; margin-bottom: 0.75rem; }
            .tiptap-editor pre code { background: none; padding: 0; font-size: 0.85em; }
            .tiptap-editor img { max-width: 100%; border-radius: 6px; margin: 0.5rem 0; }
            .tiptap-editor table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; }
            .tiptap-editor th { background: #1b1b1b; color: white; font-weight: 600; text-align: left; padding: 8px 12px; border: 1px solid #1b1b1b; }
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
