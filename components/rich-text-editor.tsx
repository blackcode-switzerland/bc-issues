'use client'

import {
  useEditor,
  EditorContent,
  Editor,
  BubbleMenu,
  FloatingMenu,
  ReactRenderer,
} from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import Mention from '@tiptap/extension-mention'
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'
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
  Quote,
  Strikethrough,
  CheckSquare,
  TextQuote,
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
      tippyOptions={{ duration: 120, placement: 'top' }}
      shouldShow={({ editor: ed, from, to }) => from !== to && !ed.isActive('image')}
    >
      <div className="flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-xl">
        <MenuButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive('bold')}
          title="Bold"
        >
          <Bold size={14} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive('italic')}
          title="Italic"
        >
          <Italic size={14} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          isActive={editor.isActive('strike')}
          title="Strikethrough"
        >
          <Strikethrough size={14} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleCode().run()}
          isActive={editor.isActive('code')}
          title="Inline code"
        >
          <Code size={14} />
        </MenuButton>
        <div className="mx-0.5 h-4 w-px bg-border" />
        <MenuButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          isActive={editor.isActive('heading', { level: 1 })}
          title="Heading 1"
        >
          <Heading1 size={14} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          isActive={editor.isActive('heading', { level: 2 })}
          title="Heading 2"
        >
          <Heading2 size={14} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={editor.isActive('bulletList')}
          title="Bullet list"
        >
          <List size={14} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          isActive={editor.isActive('blockquote')}
          title="Quote"
        >
          <Quote size={14} />
        </MenuButton>
        <div className="mx-0.5 h-4 w-px bg-border" />
        <MenuButton onClick={onSetLink} isActive={editor.isActive('link')} title="Add link">
          <LinkIcon size={14} />
        </MenuButton>
      </div>
    </BubbleMenu>
  )
}

/* --------------------------- empty-line menu ---------------------------- */

function BlockMenu({
  editor,
  onAddImage,
}: {
  editor: Editor
  onAddImage: () => void
}) {
  return (
    <FloatingMenu
      editor={editor}
      tippyOptions={{ duration: 120, placement: 'left' }}
      shouldShow={({ state }) => {
        const { $from } = state.selection
        const isEmptyParagraph =
          $from.parent.type.name === 'paragraph' && $from.parent.content.size === 0
        return isEmptyParagraph
      }}
    >
      <div className="flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-xl">
        <MenuButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          title="Heading 1"
        >
          <Heading1 size={14} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          title="Heading 2"
        >
          <Heading2 size={14} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          title="Heading 3"
        >
          <Heading3 size={14} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          title="Bullet list"
        >
          <List size={14} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          title="Numbered list"
        >
          <ListOrdered size={14} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          title="Quote"
        >
          <TextQuote size={14} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          title="Code block"
        >
          <Code size={14} />
        </MenuButton>
        <MenuButton onClick={onAddImage} title="Add image">
          <ImageIcon size={14} />
        </MenuButton>
      </div>
    </FloatingMenu>
  )
}

/* ------------------------------- editor --------------------------------- */

interface RichTextEditorProps {
  content: string
  onChange: (html: string) => void
  placeholder?: string
  editable?: boolean
  onImageUpload?: (file: File) => Promise<string>
  hideToolbar?: boolean
  minHeight?: string
  /**
   * 'bordered' (default) — boxed editor for forms/modals.
   * 'seamless' — borderless document-style editor for detail pages; relies on
   * the bubble/floating menus for formatting.
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
  placeholder = 'Write something…',
  editable = true,
  onImageUpload,
  hideToolbar = false,
  minHeight = '150px',
  variant = 'bordered',
  mentionItems,
  onBlur,
}: RichTextEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { prompt } = useConfirm()

  // Live ref so the mention dropdown sees members even when they load after
  // the editor was created.
  const mentionItemsRef = useRef<MentionItem[]>(mentionItems ?? [])
  useEffect(() => {
    mentionItemsRef.current = mentionItems ?? []
  }, [mentionItems])
  const [mentionsEnabled] = useState(() => mentionItems !== undefined)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
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
      // Handle paste events for images
      handlePaste: (view, event) => {
        if (!onImageUpload) return false
        const items = event.clipboardData?.items
        if (!items) return false
        for (let i = 0; i < items.length; i++) {
          const item = items[i]
          if (item.type.startsWith('image/')) {
            event.preventDefault()
            const file = item.getAsFile()
            if (file) {
              onImageUpload(file)
                .then((url) => {
                  view.dispatch(
                    view.state.tr.replaceSelectionWith(
                      view.state.schema.nodes.image.create({ src: url })
                    )
                  )
                })
                .catch((error) => {
                  console.error('Failed to upload pasted image:', error)
                  toast.error('Image upload failed')
                })
            }
            return true
          }
        }
        return false
      },
      // Handle drop events for images
      handleDrop: (view, event, slice, moved) => {
        if (!onImageUpload) return false
        if (moved) return false
        const files = event.dataTransfer?.files
        if (!files || files.length === 0) return false
        for (let i = 0; i < files.length; i++) {
          const file = files[i]
          if (file.type.startsWith('image/')) {
            event.preventDefault()
            onImageUpload(file)
              .then((url) => {
                const coordinates = view.posAtCoords({
                  left: event.clientX,
                  top: event.clientY,
                })
                if (coordinates) {
                  const tr = view.state.tr.insert(
                    coordinates.pos,
                    view.state.schema.nodes.image.create({ src: url })
                  )
                  view.dispatch(tr)
                }
              })
              .catch((error) => {
                console.error('Failed to upload dropped image:', error)
                toast.error('Image upload failed')
              })
            return true
          }
        }
        return false
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

  const addImage = useCallback(async () => {
    if (!editor) return
    if (onImageUpload) {
      fileInputRef.current?.click()
      return
    }
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
  }, [editor, onImageUpload, prompt])

  const handleFileChosen = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file || !onImageUpload || !editor) return
      try {
        const url = await onImageUpload(file)
        editor.chain().focus().setImage({ src: url }).run()
      } catch (error) {
        console.error('Failed to upload image:', error)
        toast.error('Image upload failed')
      }
      if (fileInputRef.current) fileInputRef.current.value = ''
    },
    [editor, onImageUpload]
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
      className={
        variant === 'seamless'
          ? ''
          : 'overflow-hidden rounded-lg border border-input bg-background focus-within:border-ring/50'
      }
    >
      {editable ? (
        <>
          <SelectionMenu editor={editor} onSetLink={setLink} />
          <BlockMenu editor={editor} onAddImage={addImage} />
          {onImageUpload ? (
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChosen}
              accept="image/*"
              className="hidden"
            />
          ) : null}
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
          <MenuButton onClick={addImage} title="Add image">
            <ImageIcon size={15} />
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

  // Sanitize HTML content to prevent XSS attacks
  const sanitizedContent =
    typeof window !== 'undefined' ? DOMPurify.sanitize(content) : content

  const editor = useEditor({
    extensions: [
      StarterKit,
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
    ],
    content: sanitizedContent,
    editable: false,
  })

  // Add click handler for images
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
