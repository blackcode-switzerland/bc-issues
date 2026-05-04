'use client'

import { useEditor, EditorContent, Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import DOMPurify from 'dompurify'
import { useCallback, useRef, useEffect } from 'react'

// Validate URL to prevent javascript: protocol XSS attacks
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol)
  } catch {
    return false
  }
}
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
  Quote,
  Undo,
  Redo,
  Strikethrough,
} from 'lucide-react'

interface RichTextEditorProps {
  content: string
  onChange: (html: string) => void
  placeholder?: string
  editable?: boolean
  onImageUpload?: (file: File) => Promise<string>
  hideToolbar?: boolean
  minHeight?: string
}

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
      className={`p-1.5 rounded hover:bg-secondary transition-colors ${
        isActive ? 'bg-secondary text-primary' : 'text-muted-foreground'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {children}
    </button>
  )
}

interface MenuBarProps {
  editor: Editor
  onImageUpload?: (file: File) => Promise<string>
}

function MenuBar({ editor, onImageUpload }: MenuBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const setLink = useCallback(() => {
    const previousUrl = editor.getAttributes('link').href
    const url = window.prompt('URL', previousUrl)

    if (url === null) {
      return
    }

    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }

    // Validate URL to prevent XSS
    if (!isValidUrl(url)) {
      alert('Please enter a valid URL starting with http:// or https://')
      return
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }, [editor])

  const handleImageUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !onImageUpload) return

    try {
      const url = await onImageUpload(file)
      editor.chain().focus().setImage({ src: url }).run()
    } catch (error) {
      console.error('Failed to upload image:', error)
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [editor, onImageUpload])

  const addImageFromUrl = useCallback(() => {
    const url = window.prompt('Image URL')
    if (url) {
      // Validate URL to prevent XSS
      if (!isValidUrl(url)) {
        alert('Please enter a valid URL starting with http:// or https://')
        return
      }
      editor.chain().focus().setImage({ src: url }).run()
    }
  }, [editor])

  return (
    <div className="flex flex-wrap items-center gap-0.5 p-2 border-b border-border bg-secondary/30">
      <MenuButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive('bold')}
        title="Bold (Ctrl+B)"
      >
        <Bold size={16} />
      </MenuButton>

      <MenuButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive('italic')}
        title="Italic (Ctrl+I)"
      >
        <Italic size={16} />
      </MenuButton>

      <MenuButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        isActive={editor.isActive('strike')}
        title="Strikethrough"
      >
        <Strikethrough size={16} />
      </MenuButton>

      <MenuButton
        onClick={() => editor.chain().focus().toggleCode().run()}
        isActive={editor.isActive('code')}
        title="Inline Code"
      >
        <Code size={16} />
      </MenuButton>

      <div className="w-px h-5 bg-border mx-1" />

      <MenuButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        isActive={editor.isActive('heading', { level: 1 })}
        title="Heading 1"
      >
        <Heading1 size={16} />
      </MenuButton>

      <MenuButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        isActive={editor.isActive('heading', { level: 2 })}
        title="Heading 2"
      >
        <Heading2 size={16} />
      </MenuButton>

      <div className="w-px h-5 bg-border mx-1" />

      <MenuButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive('bulletList')}
        title="Bullet List"
      >
        <List size={16} />
      </MenuButton>

      <MenuButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor.isActive('orderedList')}
        title="Numbered List"
      >
        <ListOrdered size={16} />
      </MenuButton>

      <MenuButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        isActive={editor.isActive('blockquote')}
        title="Blockquote"
      >
        <Quote size={16} />
      </MenuButton>

      <MenuButton
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        isActive={editor.isActive('codeBlock')}
        title="Code Block"
      >
        <Code size={16} className="rotate-45" />
      </MenuButton>

      <div className="w-px h-5 bg-border mx-1" />

      <MenuButton
        onClick={setLink}
        isActive={editor.isActive('link')}
        title="Add Link"
      >
        <LinkIcon size={16} />
      </MenuButton>

      {onImageUpload ? (
        <>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImageUpload}
            accept="image/*"
            className="hidden"
          />
          <MenuButton
            onClick={() => fileInputRef.current?.click()}
            title="Upload Image"
          >
            <ImageIcon size={16} />
          </MenuButton>
        </>
      ) : (
        <MenuButton
          onClick={addImageFromUrl}
          title="Add Image from URL"
        >
          <ImageIcon size={16} />
        </MenuButton>
      )}

      <div className="w-px h-5 bg-border mx-1" />

      <MenuButton
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        title="Undo (Ctrl+Z)"
      >
        <Undo size={16} />
      </MenuButton>

      <MenuButton
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        title="Redo (Ctrl+Shift+Z)"
      >
        <Redo size={16} />
      </MenuButton>
    </div>
  )
}

export function RichTextEditor({
  content,
  onChange,
  placeholder = 'Write something...',
  editable = true,
  onImageUpload,
  hideToolbar = false,
  minHeight = '150px',
}: RichTextEditorProps) {
  const editorContainerRef = useRef<HTMLDivElement>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Image.configure({
        HTMLAttributes: {
          class: 'max-w-full rounded-lg cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all',
        },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-primary underline hover:no-underline',
        },
      }),
      Placeholder.configure({
        placeholder,
      }),
    ],
    content,
    editable,
    onUpdate: ({ editor: ed }: { editor: Editor }) => {
      onChange(ed.getHTML())
    },
    editorProps: {
      attributes: {
        class: `prose prose-sm dark:prose-invert max-w-none focus:outline-none p-4`,
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
              // Show uploading placeholder
              const placeholderSrc = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect fill="%23f0f0f0" width="100" height="100"/%3E%3Ctext x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%23999" font-size="12"%3EUploading...%3C/text%3E%3C/svg%3E'

              onImageUpload(file)
                .then((url) => {
                  view.dispatch(view.state.tr.replaceSelectionWith(
                    view.state.schema.nodes.image.create({ src: url })
                  ))
                })
                .catch((error) => {
                  console.error('Failed to upload pasted image:', error)
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
        if (moved) return false // Let default behavior handle moved content

        const files = event.dataTransfer?.files
        if (!files || files.length === 0) return false

        for (let i = 0; i < files.length; i++) {
          const file = files[i]
          if (file.type.startsWith('image/')) {
            event.preventDefault()

            onImageUpload(file)
              .then((url) => {
                // Get drop position
                const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY })
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
              })
            return true
          }
        }

        return false
      },
    },
  })

  if (!editor) {
    return (
      <div className="border border-input rounded-lg bg-background">
        <div className="h-10 border-b border-border bg-secondary/30 animate-pulse" />
        <div className="h-[150px] p-4 animate-pulse" />
      </div>
    )
  }

  return (
    <div ref={editorContainerRef} className="border border-input rounded-lg bg-background overflow-hidden">
      {editable && !hideToolbar && <MenuBar editor={editor} onImageUpload={onImageUpload} />}
      <EditorContent editor={editor} />
      <style jsx global>{`
        .ProseMirror p.is-empty::before {
          content: attr(data-placeholder);
          float: left;
          color: hsl(var(--muted-foreground));
          pointer-events: none;
          height: 0;
        }
        .ProseMirror img {
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .ProseMirror img:hover {
          box-shadow: 0 0 0 2px hsl(var(--primary) / 0.3);
        }
        .ProseMirror img.ProseMirror-selectednode {
          box-shadow: 0 0 0 3px hsl(var(--primary));
        }
      `}</style>
    </div>
  )
}

interface RichTextDisplayProps {
  content: string
  onImageClick?: (src: string, alt?: string) => void
}

// Read-only HTML renderer for displaying rich content
export function RichTextDisplay({ content, onImageClick }: RichTextDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Sanitize HTML content to prevent XSS attacks
  const sanitizedContent = typeof window !== 'undefined'
    ? DOMPurify.sanitize(content)
    : content

  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({
        HTMLAttributes: {
          class: 'max-w-full rounded-lg cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all',
        },
      }),
      Link.configure({
        openOnClick: true,
        HTMLAttributes: {
          class: 'text-primary underline hover:no-underline',
        },
      }),
    ],
    content: sanitizedContent,
    editable: false,
  })

  // Add click handler for images
  useEffect(() => {
    if (!containerRef.current || !onImageClick) return

    const handleImageClick = (e: Event) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'IMG') {
        const img = target as HTMLImageElement
        onImageClick(img.src, img.alt)
      }
    }

    containerRef.current.addEventListener('click', handleImageClick)
    return () => {
      containerRef.current?.removeEventListener('click', handleImageClick)
    }
  }, [onImageClick])

  if (!editor) {
    return <div className="animate-pulse h-20 bg-secondary/20 rounded" />
  }

  return (
    <div ref={containerRef} className="prose prose-sm dark:prose-invert max-w-none">
      <EditorContent editor={editor} />
    </div>
  )
}
