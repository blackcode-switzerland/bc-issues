'use client'

import {
  useEditor,
  EditorContent,
  Editor,
  BubbleMenu,
  ReactRenderer,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from '@tiptap/react'
import { Node, mergeAttributes, Extension } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'
import Mention from '@tiptap/extension-mention'
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'
import type { Range } from '@tiptap/core'
import tippy, { type Instance as TippyInstance } from 'tippy.js'
import DOMPurify from 'dompurify'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { toast } from 'sonner'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { MemberAvatar } from '@/components/ui/member-avatar'
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Code,
  Link as LinkIcon,
  Image as ImageIcon,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Quote,
  Strikethrough,
  UnderlineIcon,
  ListChecks,
  Paperclip,
  Download,
  Eye,
  FileText,
  FileVideo,
  FileAudio,
  X,
} from 'lucide-react'

// Validate URL to prevent javascript: protocol XSS attacks
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol)
  } catch {
    return false
  }
}

/* ------------------------------- mentions ------------------------------- */

export interface MentionItem {
  id: number | string
  label: string
  avatarUrl?: string | null
}

interface MentionListProps {
  items: MentionItem[]
  command: (item: { id: string; label: string }) => void
}

interface MentionListHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
}

const MentionList = forwardRef<MentionListHandle, MentionListProps>(function MentionList(
  { items, command },
  ref
) {
  const [selected, setSelected] = useState(0)

  useEffect(() => setSelected(0), [items])

  function select(index: number) {
    const item = items[index]
    if (item) command({ id: String(item.id), label: item.label })
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowUp') {
        setSelected((s) => (s + items.length - 1) % items.length)
        return true
      }
      if (event.key === 'ArrowDown') {
        setSelected((s) => (s + 1) % items.length)
        return true
      }
      if (event.key === 'Enter') {
        select(selected)
        return true
      }
      return false
    },
  }))

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-lg">
        No members found
      </div>
    )
  }

  return (
    <div className="w-56 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-lg">
      {items.map((item, i) => (
        <button
          key={String(item.id)}
          type="button"
          onClick={() => select(i)}
          onMouseEnter={() => setSelected(i)}
          className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] ${
            i === selected ? 'bg-secondary text-foreground' : 'text-foreground/90'
          }`}
        >
          <MemberAvatar name={item.label} avatarUrl={item.avatarUrl} size={18} />
          <span className="truncate">{item.label}</span>
        </button>
      ))}
    </div>
  )
})

/** Build the Mention extension reading live items from a ref (async-safe). */
function buildMention(itemsRef: React.MutableRefObject<MentionItem[]>) {
  return Mention.configure({
    HTMLAttributes: { class: 'mention' },
    suggestion: {
      items: ({ query }) => {
        const q = query.toLowerCase()
        return itemsRef.current
          .filter((m) => m.label.toLowerCase().includes(q))
          .slice(0, 8)
      },
      render: () => {
        let component: ReactRenderer<MentionListHandle, MentionListProps> | null = null
        let popup: TippyInstance[] = []

        return {
          onStart: (props: SuggestionProps<MentionItem>) => {
            component = new ReactRenderer(MentionList, {
              props,
              editor: props.editor,
            })
            if (!props.clientRect) return
            popup = tippy('body', {
              getReferenceClientRect: props.clientRect as () => DOMRect,
              appendTo: () => document.body,
              content: component.element,
              showOnCreate: true,
              interactive: true,
              trigger: 'manual',
              placement: 'bottom-start',
            })
          },
          onUpdate: (props: SuggestionProps<MentionItem>) => {
            component?.updateProps(props)
            if (props.clientRect) {
              popup[0]?.setProps({ getReferenceClientRect: props.clientRect as () => DOMRect })
            }
          },
          onKeyDown: (props: SuggestionKeyDownProps) => {
            if (props.event.key === 'Escape') {
              popup[0]?.hide()
              return true
            }
            return component?.ref?.onKeyDown(props) ?? false
          },
          onExit: () => {
            popup[0]?.destroy()
            component?.destroy()
          },
        }
      },
    },
  })
}

/* -------------------------- file attachment node ------------------------ */

interface FileAttachmentAttrs {
  href: string
  filename: string
  contentType: string
}

interface FileAttachmentViewProps {
  node: { attrs: FileAttachmentAttrs }
  deleteNode: () => void
  editor: { isEditable: boolean }
  selected: boolean
}

function FileAttachmentView({ node, deleteNode, editor, selected }: FileAttachmentViewProps) {
  const { href, filename, contentType } = node.attrs
  const isVideo = contentType?.startsWith('video/')
  const isAudio = contentType?.startsWith('audio/')
  const isPdf = contentType === 'application/pdf'

  const ringClass = selected ? 'ring-2 ring-primary' : ''

  return (
    <NodeViewWrapper>
      <div
        className={`group relative my-2 overflow-hidden rounded-lg border border-border bg-secondary/20 ${ringClass}`}
        contentEditable={false}
      >
        {editor.isEditable && (
          <button
            onMouseDown={(e) => {
              e.preventDefault()
              deleteNode()
            }}
            title="Remove attachment"
            className="absolute right-1 top-1 z-10 hidden rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground group-hover:flex"
            type="button"
          >
            <X size={12} />
          </button>
        )}

        {isVideo ? (
          <div>
            <video src={href} controls className="max-h-72 w-full bg-black" />
            <div className="flex items-center gap-2 border-t border-border px-3 py-1.5">
              <FileVideo size={13} className="shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-[12px] text-muted-foreground">{filename}</span>
              <a
                href={href}
                download={filename}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                onClick={(e) => e.stopPropagation()}
              >
                <Download size={12} /> Download
              </a>
            </div>
          </div>
        ) : isAudio ? (
          <div className="flex items-center gap-2.5 px-3 py-2.5">
            <FileAudio size={16} className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-[13px]">{filename}</span>
            <audio src={href} controls className="h-7 w-44 shrink-0" />
            <a
              href={href}
              download={filename}
              className="shrink-0 rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
              title="Download"
              onClick={(e) => e.stopPropagation()}
            >
              <Download size={14} />
            </a>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 px-3 py-2.5">
            {isPdf ? (
              <FileText size={16} className="shrink-0 text-muted-foreground" />
            ) : (
              <Paperclip size={16} className="shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 truncate text-[13px]">{filename}</span>
            {isPdf && (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                onClick={(e) => e.stopPropagation()}
              >
                <Eye size={12} /> View
              </a>
            )}
            <a
              href={href}
              download={filename}
              className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
              onClick={(e) => e.stopPropagation()}
            >
              <Download size={12} /> Download
            </a>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

function buildFileAttachment() {
  return Node.create({
    name: 'fileAttachment',
    group: 'block',
    atom: true,
    draggable: true,

    addAttributes() {
      return {
        href: {
          default: null,
          parseHTML: (el) => el.getAttribute('data-file-url'),
          renderHTML: (attrs) => ({ 'data-file-url': attrs.href }),
        },
        filename: {
          default: 'file',
          parseHTML: (el) => el.getAttribute('data-filename'),
          renderHTML: (attrs) => ({ 'data-filename': attrs.filename }),
        },
        contentType: {
          default: 'application/octet-stream',
          parseHTML: (el) => el.getAttribute('data-content-type'),
          renderHTML: (attrs) => ({ 'data-content-type': attrs.contentType }),
        },
      }
    },

    parseHTML() {
      return [{ tag: 'div[data-type="file-attachment"]' }]
    },

    renderHTML({ HTMLAttributes }) {
      return ['div', mergeAttributes({ 'data-type': 'file-attachment' }, HTMLAttributes)]
    },

    addNodeView() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ReactNodeViewRenderer(FileAttachmentView as React.FC<any>)
    },
  })
}

/* ----------------------------- slash command ---------------------------- */

interface SlashItem {
  id: string
  label: string
  keywords: string[]
  icon: React.ReactNode
  command: (params: { editor: Editor; range: Range }) => void
}

interface SlashCommandCallbacks {
  setLink: () => void
  triggerAttach: () => void
  hasFileUpload: boolean
}

function buildSlashItems(callbacksRef: React.MutableRefObject<SlashCommandCallbacks>): SlashItem[] {
  return [
    {
      id: 'h1',
      label: 'Heading 1',
      keywords: ['h1', 'heading1', 'heading 1', 'title'],
      icon: <Heading1 size={15} />,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleHeading({ level: 1 }).run(),
    },
    {
      id: 'h2',
      label: 'Heading 2',
      keywords: ['h2', 'heading2', 'heading 2', 'subtitle'],
      icon: <Heading2 size={15} />,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleHeading({ level: 2 }).run(),
    },
    {
      id: 'h3',
      label: 'Heading 3',
      keywords: ['h3', 'heading3', 'heading 3'],
      icon: <Heading3 size={15} />,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleHeading({ level: 3 }).run(),
    },
    {
      id: 'h4',
      label: 'Heading 4',
      keywords: ['h4', 'heading4', 'heading 4'],
      icon: <Heading4 size={15} />,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleHeading({ level: 4 }).run(),
    },
    {
      id: 'bold',
      label: 'Bold',
      keywords: ['bold', 'strong', 'b'],
      icon: <Bold size={15} />,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleBold().run(),
    },
    {
      id: 'italic',
      label: 'Italic',
      keywords: ['italic', 'em', 'i'],
      icon: <Italic size={15} />,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleItalic().run(),
    },
    {
      id: 'strike',
      label: 'Strikethrough',
      keywords: ['strike', 'strikethrough', 'del', 's'],
      icon: <Strikethrough size={15} />,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleStrike().run(),
    },
    {
      id: 'underline',
      label: 'Underline',
      keywords: ['underline', 'u'],
      icon: <UnderlineIcon size={15} />,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleUnderline().run(),
    },
    {
      id: 'link',
      label: 'Link',
      keywords: ['link', 'url', 'href', 'a'],
      icon: <LinkIcon size={15} />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run()
        callbacksRef.current.setLink()
      },
    },
    {
      id: 'quote',
      label: 'Quote',
      keywords: ['quote', 'blockquote', 'callout'],
      icon: <Quote size={15} />,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
    },
    {
      id: 'code',
      label: 'Code block',
      keywords: ['code', 'codeblock', 'code block', 'pre', 'snippet'],
      icon: <Code size={15} />,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
    },
    {
      id: 'bulletList',
      label: 'Bullet list',
      keywords: ['bullet', 'list', 'ul', 'unordered'],
      icon: <List size={15} />,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleBulletList().run(),
    },
    {
      id: 'orderedList',
      label: 'Numbered list',
      keywords: ['number', 'numbered', 'ordered', 'ol', '1.'],
      icon: <ListOrdered size={15} />,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
    },
    {
      id: 'checklist',
      label: 'Checklist',
      keywords: ['check', 'checklist', 'todo', 'task', 'checkbox'],
      icon: <ListChecks size={15} />,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleTaskList().run(),
    },
    {
      id: 'attach',
      label: 'Attach file',
      keywords: ['attach', 'file', 'upload', 'image', 'photo', 'video', 'audio', 'document', 'pdf'],
      icon: <Paperclip size={15} />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run()
        callbacksRef.current.triggerAttach()
      },
    },
  ]
}

interface SlashListProps {
  items: SlashItem[]
  command: (item: SlashItem) => void
}

interface SlashListHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
}

const SlashCommandList = forwardRef<SlashListHandle, SlashListProps>(function SlashCommandList(
  { items, command },
  ref
) {
  const [selected, setSelected] = useState(0)

  useEffect(() => setSelected(0), [items])

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowUp') {
        setSelected((s) => (s + items.length - 1) % items.length)
        return true
      }
      if (event.key === 'ArrowDown') {
        setSelected((s) => (s + 1) % items.length)
        return true
      }
      if (event.key === 'Enter') {
        const item = items[selected]
        if (item) command(item)
        return true
      }
      return false
    },
  }))

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-lg">
        No commands found
      </div>
    )
  }

  return (
    <div className="w-52 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-xl">
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          onClick={() => command(item)}
          onMouseEnter={() => setSelected(i)}
          className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] ${
            i === selected ? 'bg-secondary text-foreground' : 'text-foreground/80'
          }`}
        >
          <span className="flex w-4 shrink-0 items-center justify-center text-muted-foreground">
            {item.icon}
          </span>
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  )
})

function buildSlashCommand(callbacksRef: React.MutableRefObject<SlashCommandCallbacks>) {
  const allItems = buildSlashItems(callbacksRef)

  return Extension.create({
    name: 'slashCommand',
    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          char: '/',
          allowSpaces: false,
          startOfLine: false,
          command: ({ editor, range, props }: { editor: Editor; range: Range; props: SlashItem }) => {
            props.command({ editor, range })
          },
          items: ({ query }: { query: string }) => {
            const q = query.toLowerCase().trim()
            const items = callbacksRef.current.hasFileUpload
              ? allItems
              : allItems.filter((i) => i.id !== 'attach')
            if (!q) return items
            return items.filter(
              (item) =>
                item.label.toLowerCase().includes(q) ||
                item.keywords.some((kw) => kw.includes(q))
            )
          },
          render: () => {
            let component: ReactRenderer<SlashListHandle, SlashListProps> | null = null
            let popup: TippyInstance[] = []

            return {
              onStart: (props: SuggestionProps<SlashItem>) => {
                component = new ReactRenderer(SlashCommandList, {
                  props,
                  editor: props.editor,
                })
                if (!props.clientRect) return
                popup = tippy('body', {
                  getReferenceClientRect: props.clientRect as () => DOMRect,
                  appendTo: () => document.body,
                  content: component.element,
                  showOnCreate: true,
                  interactive: true,
                  trigger: 'manual',
                  placement: 'bottom-start',
                })
              },
              onUpdate: (props: SuggestionProps<SlashItem>) => {
                component?.updateProps(props)
                if (props.clientRect) {
                  popup[0]?.setProps({
                    getReferenceClientRect: props.clientRect as () => DOMRect,
                  })
                }
              },
              onKeyDown: (props: SuggestionKeyDownProps) => {
                if (props.event.key === 'Escape') {
                  popup[0]?.hide()
                  return true
                }
                return component?.ref?.onKeyDown(props) ?? false
              },
              onExit: () => {
                popup[0]?.destroy()
                component?.destroy()
              },
            }
          },
        }),
      ]
    },
  })
}

/* ----------------------------- menu buttons ----------------------------- */

interface MenuButtonProps {
  onClick: () => void
  isActive?: boolean
  disabled?: boolean
  children: React.ReactNode
  title: string
}

function MenuButton({ onClick, isActive, disabled, children, title }: MenuButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={isActive}
      className={`rounded p-1.5 transition-colors hover:bg-secondary ${
        isActive ? 'bg-secondary text-foreground' : 'text-muted-foreground'
      } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      {children}
    </button>
  )
}

/* --------------------------- selection bubble --------------------------- */

function SelectionMenu({ editor, onSetLink }: { editor: Editor; onSetLink: () => void }) {
  return (
    <BubbleMenu
      editor={editor}
      tippyOptions={{ duration: 120, placement: 'top', maxWidth: 'none' }}
      shouldShow={({ editor: ed, from, to }) => from !== to && !ed.isActive('image')}
    >
      <div className="flex items-center gap-0 rounded-lg border border-border bg-popover px-1 py-1 shadow-xl">
        <MenuButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive('bold')}
          title="Bold"
        >
          <Bold size={15} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive('italic')}
          title="Italic"
        >
          <Italic size={15} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          isActive={editor.isActive('strike')}
          title="Strikethrough"
        >
          <Strikethrough size={15} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          isActive={editor.isActive('underline')}
          title="Underline"
        >
          <UnderlineIcon size={15} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleCode().run()}
          isActive={editor.isActive('code')}
          title="Inline code"
        >
          <Code size={15} />
        </MenuButton>
        <div className="mx-1 h-4 w-px bg-border" />
        <MenuButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          isActive={editor.isActive('heading', { level: 1 })}
          title="Heading 1"
        >
          <Heading1 size={15} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          isActive={editor.isActive('heading', { level: 2 })}
          title="Heading 2"
        >
          <Heading2 size={15} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          isActive={editor.isActive('heading', { level: 3 })}
          title="Heading 3"
        >
          <Heading3 size={15} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
          isActive={editor.isActive('heading', { level: 4 })}
          title="Heading 4"
        >
          <Heading4 size={15} />
        </MenuButton>
        <div className="mx-1 h-4 w-px bg-border" />
        <MenuButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={editor.isActive('bulletList')}
          title="Bullet list"
        >
          <List size={15} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={editor.isActive('orderedList')}
          title="Numbered list"
        >
          <ListOrdered size={15} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          isActive={editor.isActive('taskList')}
          title="Checklist"
        >
          <ListChecks size={15} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          isActive={editor.isActive('blockquote')}
          title="Quote"
        >
          <Quote size={15} />
        </MenuButton>
        <div className="mx-1 h-4 w-px bg-border" />
        <MenuButton onClick={onSetLink} isActive={editor.isActive('link')} title="Add link">
          <LinkIcon size={15} />
        </MenuButton>
      </div>
    </BubbleMenu>
  )
}

/* ------------------------------- editor --------------------------------- */

interface RichTextEditorProps {
  content: string
  onChange: (html: string) => void
  placeholder?: string
  editable?: boolean
  /** Called with any selected/pasted/dropped file; should upload and return the public URL. */
  onFileUpload?: (file: File) => Promise<string>
  hideToolbar?: boolean
  minHeight?: string
  /**
   * 'bordered' (default) — boxed editor for forms/modals.
   * 'seamless' — borderless document-style editor for detail pages; relies on
   * the bubble menu for formatting.
   */
  variant?: 'bordered' | 'seamless'
  /** Members offered in the @mention dropdown. Mentions disabled if omitted. */
  mentionItems?: MentionItem[]
  /** Called when focus leaves the editor (useful for save-on-blur). */
  onBlur?: () => void
}

export function RichTextEditor({
  content,
  onChange,
  placeholder = 'Add description… type / to format, @ to mention',
  editable = true,
  onFileUpload,
  hideToolbar = false,
  minHeight = '150px',
  variant = 'bordered',
  mentionItems,
  onBlur,
}: RichTextEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { prompt } = useConfirm()
  const dragOverlayRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const mentionItemsRef = useRef<MentionItem[]>(mentionItems ?? [])
  useEffect(() => {
    mentionItemsRef.current = mentionItems ?? []
  }, [mentionItems])
  const [mentionsEnabled] = useState(() => mentionItems !== undefined)

  const slashCallbacksRef = useRef<SlashCommandCallbacks>({
    setLink: () => {},
    triggerAttach: () => {},
    hasFileUpload: !!onFileUpload,
  })

  const [slashCommandExt] = useState(() => buildSlashCommand(slashCallbacksRef))
  const [fileAttachmentExt] = useState(() => buildFileAttachment())

  const uploadAndInsert = useCallback(
    async (file: File, insertFn: (url: string) => void) => {
      if (!onFileUpload) return
      try {
        const url = await onFileUpload(file)
        insertFn(url)
      } catch {
        toast.error('Upload failed')
      }
    },
    [onFileUpload]
  )

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      Underline,
      TaskList,
      TaskItem.configure({ nested: true }),
      Image.configure({
        HTMLAttributes: {
          class: 'max-w-full rounded-lg cursor-pointer transition-all',
        },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'text-primary underline hover:no-underline' },
      }),
      Placeholder.configure({ placeholder }),
      ...(mentionsEnabled ? [buildMention(mentionItemsRef)] : []),
      slashCommandExt,
      fileAttachmentExt,
    ],
    content,
    editable,
    onUpdate: ({ editor: ed }: { editor: Editor }) => {
      onChange(ed.getHTML())
    },
    onBlur: () => onBlur?.(),
    editorProps: {
      attributes: {
        class: `prose prose-sm dark:prose-invert max-w-none focus:outline-hidden ${
          variant === 'seamless' ? 'px-0 py-1' : 'p-4'
        }`,
        style: `min-height: ${minHeight}`,
      },
      handlePaste: (view, event) => {
        if (!onFileUpload) return false
        const items = event.clipboardData?.items
        if (!items) return false
        for (let i = 0; i < items.length; i++) {
          const item = items[i]
          if (item.kind === 'file') {
            const file = item.getAsFile()
            if (!file) continue
            event.preventDefault()
            if (file.type.startsWith('image/')) {
              uploadAndInsert(file, (url) => {
                view.dispatch(
                  view.state.tr.replaceSelectionWith(
                    view.state.schema.nodes.image.create({ src: url })
                  )
                )
              })
            } else {
              uploadAndInsert(file, (url) => {
                const node = view.state.schema.nodes.fileAttachment?.create({
                  href: url,
                  filename: file.name,
                  contentType: file.type,
                })
                if (node) {
                  const para = view.state.schema.nodes.paragraph.create()
                  let tr = view.state.tr.replaceSelectionWith(node)
                  const afterNode = tr.selection.to
                  tr = tr.insert(afterNode, para)
                  try { view.dispatch(tr.setSelection(TextSelection.create(tr.doc, afterNode + 1))) }
                  catch { view.dispatch(tr) }
                }
              })
            }
            return true
          }
        }
        return false
      },
      handleDrop: (view, event, _slice, moved) => {
        if (!onFileUpload) return false
        if (moved) return false
        const files = event.dataTransfer?.files
        if (!files || files.length === 0) return false
        event.preventDefault()
        for (let i = 0; i < files.length; i++) {
          const file = files[i]
          const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY })
          if (file.type.startsWith('image/')) {
            uploadAndInsert(file, (url) => {
              const node = view.state.schema.nodes.image.create({ src: url })
              if (coordinates) {
                view.dispatch(view.state.tr.insert(coordinates.pos, node))
              } else {
                view.dispatch(view.state.tr.replaceSelectionWith(node))
              }
            })
          } else {
            uploadAndInsert(file, (url) => {
              const node = view.state.schema.nodes.fileAttachment?.create({
                href: url,
                filename: file.name,
                contentType: file.type,
              })
              if (!node) return
              const para = view.state.schema.nodes.paragraph.create()
              let tr: ReturnType<typeof view.state.tr.insert>
              let afterNode: number
              if (coordinates) {
                tr = view.state.tr.insert(coordinates.pos, node)
                afterNode = coordinates.pos + node.nodeSize
              } else {
                tr = view.state.tr.replaceSelectionWith(node)
                afterNode = tr.selection.to
              }
              tr = tr.insert(afterNode, para)
              try { tr = tr.setSelection(TextSelection.create(tr.doc, afterNode + 1)) } catch {}
              view.dispatch(tr)
            })
          }
        }
        return true
      },
    },
  })

  const setLink = useCallback(async () => {
    if (!editor) return
    const previousUrl = editor.getAttributes('link').href
    const url = await prompt({
      title: 'Add link',
      inputLabel: 'URL',
      placeholder: 'https://…',
      inputType: 'url',
      defaultValue: previousUrl,
    })
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    if (!isValidUrl(url)) {
      toast.error('Please enter a valid URL starting with http:// or https://')
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }, [editor, prompt])

  const addFile = useCallback(async () => {
    if (!editor) return
    if (onFileUpload) {
      fileInputRef.current?.click()
      return
    }
    // Fallback to URL input for images when no upload handler
    const url = await prompt({
      title: 'Add image',
      inputLabel: 'URL',
      placeholder: 'https://…',
      inputType: 'url',
    })
    if (!url) return
    if (!isValidUrl(url)) {
      toast.error('Please enter a valid URL starting with http:// or https://')
      return
    }
    editor.chain().focus().setImage({ src: url }).run()
  }, [editor, onFileUpload, prompt])

  const handleFileChosen = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files
      if (!files || files.length === 0 || !onFileUpload || !editor) return
      for (const file of Array.from(files)) {
        if (file.type.startsWith('image/')) {
          uploadAndInsert(file, (url) => {
            editor.chain().focus().setImage({ src: url }).run()
          })
        } else {
          uploadAndInsert(file, (url) => {
            editor.chain()
              .insertContent([
                { type: 'fileAttachment', attrs: { href: url, filename: file.name, contentType: file.type } },
                { type: 'paragraph' },
              ])
              .run()
          })
        }
      }
      if (fileInputRef.current) fileInputRef.current.value = ''
    },
    [editor, onFileUpload, uploadAndInsert]
  )

  // Keep slash command callbacks in sync
  useEffect(() => {
    slashCallbacksRef.current = {
      setLink,
      triggerAttach: () => fileInputRef.current?.click(),
      hasFileUpload: !!onFileUpload,
    }
  }, [setLink, onFileUpload])

  // Drag-over handlers — use DOM refs instead of React state to avoid
  // re-rendering the editor wrapper (which conflicts with ProseMirror's DOM).
  const showOverlay = useCallback(() => {
    if (dragOverlayRef.current) dragOverlayRef.current.style.display = 'flex'
    if (wrapperRef.current && variant === 'seamless') {
      wrapperRef.current.style.outline = '2px dashed hsl(var(--primary) / 0.5)'
      wrapperRef.current.style.outlineOffset = '4px'
      wrapperRef.current.style.borderRadius = '8px'
    } else if (wrapperRef.current) {
      wrapperRef.current.style.borderColor = 'hsl(var(--primary) / 0.6)'
    }
  }, [variant])

  const hideOverlay = useCallback(() => {
    if (dragOverlayRef.current) dragOverlayRef.current.style.display = 'none'
    if (wrapperRef.current) {
      wrapperRef.current.style.outline = ''
      wrapperRef.current.style.outlineOffset = ''
      wrapperRef.current.style.borderRadius = ''
      wrapperRef.current.style.borderColor = ''
    }
  }, [])

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!onFileUpload) return
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault()
        showOverlay()
      }
    },
    [onFileUpload, showOverlay]
  )

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      const related = e.relatedTarget as HTMLElement | null
      if (!e.currentTarget.contains(related)) {
        hideOverlay()
      }
    },
    [hideOverlay]
  )

  const handleWrapperDrop = useCallback(
    (e: React.DragEvent) => {
      hideOverlay()
      // TipTap's handleDrop already called preventDefault for drops on the editor content.
      // Only handle drops that landed outside the prosemirror view (e.g. wrapper padding).
      if (!onFileUpload || !editor || e.defaultPrevented) return
      e.preventDefault()
      const files = Array.from(e.dataTransfer?.files ?? [])
      for (const file of files) {
        if (file.type.startsWith('image/')) {
          uploadAndInsert(file, (url) => {
            editor.chain().focus().setImage({ src: url }).run()
          })
        } else {
          uploadAndInsert(file, (url) => {
            editor.chain()
              .insertContent([
                { type: 'fileAttachment', attrs: { href: url, filename: file.name, contentType: file.type } },
                { type: 'paragraph' },
              ])
              .run()
          })
        }
      }
    },
    [editor, hideOverlay, onFileUpload, uploadAndInsert]
  )

  if (!editor) {
    return variant === 'seamless' ? (
      <div className="h-20 animate-pulse rounded bg-secondary/20" />
    ) : (
      <div className="rounded-lg border border-input bg-background">
        <div className="h-[150px] animate-pulse p-4" />
      </div>
    )
  }

  return (
    <div
      ref={wrapperRef}
      className={`relative ${
        variant === 'seamless'
          ? ''
          : 'overflow-hidden rounded-lg border border-input bg-background focus-within:border-ring/50'
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleWrapperDrop}
    >
      {onFileUpload && (
        <div
          ref={dragOverlayRef}
          style={{ display: 'none' }}
          className="pointer-events-none absolute inset-0 z-20 items-center justify-center rounded-lg bg-primary/5"
        >
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-primary/60 bg-background/90 px-4 py-2.5 shadow-sm">
            <Paperclip size={14} className="text-primary" />
            <span className="text-sm font-medium text-primary">Drop to attach</span>
          </div>
        </div>
      )}

      {editable ? (
        <>
          <SelectionMenu editor={editor} onSetLink={setLink} />
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChosen}
            accept="*"
            multiple
            className="hidden"
          />
        </>
      ) : null}
      {editable && !hideToolbar && variant === 'bordered' ? (
        <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-secondary/30 p-1.5">
          <MenuButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            isActive={editor.isActive('bold')}
            title="Bold"
          >
            <Bold size={15} />
          </MenuButton>
          <MenuButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            isActive={editor.isActive('italic')}
            title="Italic"
          >
            <Italic size={15} />
          </MenuButton>
          <MenuButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            isActive={editor.isActive('bulletList')}
            title="Bullet list"
          >
            <List size={15} />
          </MenuButton>
          <MenuButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            isActive={editor.isActive('orderedList')}
            title="Numbered list"
          >
            <ListOrdered size={15} />
          </MenuButton>
          <MenuButton onClick={setLink} isActive={editor.isActive('link')} title="Add link">
            <LinkIcon size={15} />
          </MenuButton>
          <MenuButton onClick={addFile} title="Attach file">
            {onFileUpload ? <Paperclip size={15} /> : <ImageIcon size={15} />}
          </MenuButton>
        </div>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  )
}

/* ------------------------------- display -------------------------------- */

interface RichTextDisplayProps {
  content: string
  onImageClick?: (src: string, alt?: string) => void
}

// Read-only HTML renderer for displaying rich content
export function RichTextDisplay({ content, onImageClick }: RichTextDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [fileAttachmentExt] = useState(() => buildFileAttachment())

  const sanitizedContent =
    typeof window !== 'undefined'
      ? DOMPurify.sanitize(content, {
          ADD_ATTR: ['data-type', 'data-file-url', 'data-filename', 'data-content-type'],
        })
      : content

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      Underline,
      TaskList,
      TaskItem.configure({ nested: true }),
      Image.configure({
        HTMLAttributes: {
          class: 'max-w-full rounded-lg cursor-pointer transition-all',
        },
      }),
      Link.configure({
        openOnClick: true,
        HTMLAttributes: { class: 'text-primary underline hover:no-underline' },
      }),
      Mention.configure({ HTMLAttributes: { class: 'mention' } }),
      fileAttachmentExt,
    ],
    content: sanitizedContent,
    editable: false,
  })

  // Keep the read-only view in sync when the content prop changes (e.g. paging
  // between project updates reuses the same component instance).
  useEffect(() => {
    if (editor && !editor.isDestroyed && sanitizedContent !== editor.getHTML()) {
      editor.commands.setContent(sanitizedContent)
    }
  }, [editor, sanitizedContent])

  useEffect(() => {
    if (!containerRef.current || !onImageClick) return
    const node = containerRef.current
    const handleImageClick = (e: Event) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'IMG') {
        const img = target as HTMLImageElement
        onImageClick(img.src, img.alt)
      }
    }
    node.addEventListener('click', handleImageClick)
    return () => node.removeEventListener('click', handleImageClick)
  }, [onImageClick])

  if (!editor) {
    return <div className="h-20 animate-pulse rounded bg-secondary/20" />
  }

  return (
    <div ref={containerRef} className="prose prose-sm dark:prose-invert max-w-none">
      <EditorContent editor={editor} />
    </div>
  )
}
