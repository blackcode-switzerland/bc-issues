'use client'

import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import Image from 'next/image'
import { useParams } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import {
  ArrowLeft,
  MessageSquare,
  Paperclip,
  Calendar,
  Upload,
  FileText,
  ImageIcon,
  Trash2,
  ExternalLink,
  History,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { RichTextEditor, RichTextDisplay } from '@/components/rich-text-editor'
import { useImageLightbox } from '@/components/image-lightbox'

const STATUSES = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'todo', label: 'To Do' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'in_review', label: 'In Review' },
  { id: 'done', label: 'Done' },
] as const

const PRIORITY_CONFIG = {
  1: { label: 'Urgent', color: 'text-red-500', bg: 'bg-red-500/10' },
  2: { label: 'High', color: 'text-amber-500', bg: 'bg-amber-500/10' },
  3: { label: 'Medium', color: 'text-blue-500', bg: 'bg-blue-500/10' },
  4: { label: 'Low', color: 'text-gray-500', bg: 'bg-gray-500/10' },
  5: { label: 'None', color: 'text-gray-400', bg: 'bg-gray-400/10' },
} as const

interface Issue {
  id: number
  title: string
  description?: string
  status: string
  priority: number
  assignee_id?: number
  assignee_name?: string
  assignee_avatar?: string
  project_id: number
  project_name?: string
  milestone_id?: number
  milestone_name?: string
  comment_count: number
  attachment_count: number
  start_date?: string
  due_date?: string
  created_at: string
  updated_at: string
}

interface Comment {
  id: number
  content: string
  user_id: number
  author_name?: string
  author_avatar?: string
  created_at: string
}

interface Attachment {
  id: number
  filename: string
  file_url: string
  file_size?: number
  mime_type?: string
  uploader_name?: string
  uploader_avatar?: string
  created_at: string
}

interface ActivityItem {
  id: number
  type: 'comment' | 'change'
  content?: string
  operation_type?: string
  old_data?: any
  new_data?: any
  user_id: number
  user_name?: string
  user_avatar?: string
  created_at: string
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return 'Unknown size'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getFileIcon(mimeType?: string) {
  if (mimeType?.startsWith('image/')) return ImageIcon
  return FileText
}

function getChangeSummary(item: ActivityItem): string {
  if (!item.old_data || !item.new_data) {
    if (item.operation_type === 'INSERT') return 'created this issue'
    if (item.operation_type === 'DELETE') return 'deleted this issue'
    return 'made changes'
  }

  const changes: string[] = []
  const old = item.old_data
  const newData = item.new_data

  if (old.status !== newData.status) {
    changes.push(`status from "${old.status}" to "${newData.status}"`)
  }
  if (old.priority !== newData.priority) {
    const oldP = PRIORITY_CONFIG[old.priority as keyof typeof PRIORITY_CONFIG]?.label || old.priority
    const newP = PRIORITY_CONFIG[newData.priority as keyof typeof PRIORITY_CONFIG]?.label || newData.priority
    changes.push(`priority from "${oldP}" to "${newP}"`)
  }
  if (old.title !== newData.title) {
    changes.push('title')
  }
  if (old.description !== newData.description) {
    changes.push('description')
  }
  if (old.assignee_id !== newData.assignee_id) {
    changes.push('assignee')
  }

  if (changes.length === 0) return 'made changes'
  return `changed ${changes.join(', ')}`
}

export default function IssueDetailPage() {
  const params = useParams()
  const queryClient = useQueryClient()
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [isEditingDescription, setIsEditingDescription] = useState(false)
  const [editedTitle, setEditedTitle] = useState('')
  const [editedDescription, setEditedDescription] = useState('')
  const [commentContent, setCommentContent] = useState('')
  const [showActivity, setShowActivity] = useState(true)
  const [isUploading, setIsUploading] = useState(false)

  // Image lightbox for viewing images in full size
  const { openLightbox, LightboxComponent } = useImageLightbox()

  const issueId = parseInt(params.id as string)

  // Fetch issue
  const { data: issue, isLoading } = useQuery<Issue>({
    queryKey: ['issue', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/issues/${issueId}`)
      if (!res.ok) throw new Error('Failed to fetch issue')
      return res.json()
    },
  })

  // Fetch comments
  const { data: comments = [], refetch: refetchComments } = useQuery<Comment[]>({
    queryKey: ['comments', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/issues/${issueId}/comments`)
      if (!res.ok) return []
      return res.json()
    },
  })

  // Fetch attachments
  const { data: attachments = [], refetch: refetchAttachments } = useQuery<Attachment[]>({
    queryKey: ['attachments', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/issues/${issueId}/attachments`)
      if (!res.ok) return []
      return res.json()
    },
  })

  // Fetch activity
  const { data: activity = [] } = useQuery<ActivityItem[]>({
    queryKey: ['activity', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/issues/${issueId}/activity`)
      if (!res.ok) return []
      return res.json()
    },
  })

  // Fetch project members for assignee dropdown
  const { data: members = [] } = useQuery({
    queryKey: ['project-members', issue?.project_id],
    queryFn: async () => {
      if (!issue?.project_id) return []
      const res = await fetch(`/api/projects/${issue.project_id}/members`)
      if (!res.ok) return []
      return res.json()
    },
    enabled: !!issue?.project_id,
  })

  // Fetch milestones for the project
  const { data: milestones = [] } = useQuery({
    queryKey: ['milestones', issue?.project_id],
    queryFn: async () => {
      if (!issue?.project_id) return []
      const res = await fetch(`/api/milestones?project_id=${issue.project_id}`)
      if (!res.ok) return []
      return res.json()
    },
    enabled: !!issue?.project_id,
  })

  const updateIssue = useMutation({
    mutationFn: async (data: Partial<Issue>) => {
      const res = await fetch(`/api/issues/${issueId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed to update issue')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issue', issueId] })
      queryClient.invalidateQueries({ queryKey: ['all-issues'] })
      queryClient.invalidateQueries({ queryKey: ['activity', issueId] })
      queryClient.invalidateQueries({ queryKey: ['kanban', issue?.project_id] })
      queryClient.invalidateQueries({ queryKey: ['all-milestones'] })
      queryClient.invalidateQueries({ queryKey: ['milestone'] })
      // No toast for inline updates - smoother UX
    },
    onError: () => {
      toast.error('Failed to update issue')
    },
  })

  const createCommentMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await fetch(`/api/issues/${issueId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) throw new Error('Failed to create comment')
      return res.json()
    },
    onSuccess: () => {
      refetchComments()
      queryClient.invalidateQueries({ queryKey: ['issue', issueId] })
      queryClient.invalidateQueries({ queryKey: ['activity', issueId] })
      setCommentContent('')
      toast.success('Comment added!')
    },
    onError: () => {
      toast.error('Failed to create comment')
    },
  })

  const deleteAttachmentMutation = useMutation({
    mutationFn: async (attachmentId: number) => {
      const res = await fetch(`/api/issues/${issueId}/attachments?attachmentId=${attachmentId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete attachment')
      return res.json()
    },
    onSuccess: () => {
      refetchAttachments()
      queryClient.invalidateQueries({ queryKey: ['issue', issueId] })
      toast.success('Attachment deleted!')
    },
    onError: () => {
      toast.error('Failed to delete attachment')
    },
  })

  // Image upload handler for rich text editor
  const handleImageUpload = useCallback(async (file: File): Promise<string> => {
    const formData = new FormData()
    formData.append('file', file)

    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    })

    if (!res.ok) {
      throw new Error('Failed to upload image')
    }

    const data = await res.json()
    return data.url
  }, [])

  // File upload handler for attachments
  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setIsUploading(true)
    try {
      // Upload file
      const formData = new FormData()
      formData.append('file', file)

      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      if (!uploadRes.ok) {
        const error = await uploadRes.json()
        throw new Error(error.error || 'Failed to upload file')
      }

      const uploadData = await uploadRes.json()

      // Create attachment record
      const attachRes = await fetch(`/api/issues/${issueId}/attachments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: uploadData.filename,
          file_url: uploadData.url,
          file_size: uploadData.size,
          mime_type: uploadData.contentType,
        }),
      })

      if (!attachRes.ok) {
        throw new Error('Failed to create attachment record')
      }

      refetchAttachments()
      queryClient.invalidateQueries({ queryKey: ['issue', issueId] })
      toast.success('File uploaded!')
    } catch (error) {
      console.error('Upload failed:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to upload file')
    } finally {
      setIsUploading(false)
      // Reset input
      event.target.value = ''
    }
  }, [issueId, refetchAttachments, queryClient])

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="max-w-5xl mx-auto">
          <div className="h-8 bg-card rounded-lg animate-pulse mb-4" />
          <div className="h-64 bg-card rounded-lg animate-pulse" />
        </div>
      </div>
    )
  }

  if (!issue) {
    return (
      <div className="p-8">
        <div className="max-w-5xl mx-auto text-center py-24">
          <h2 className="text-xl font-semibold mb-2">Issue not found</h2>
          <Link href="/dashboard/issues" className="text-primary hover:underline">
            Back to all issues
          </Link>
        </div>
      </div>
    )
  }

  const priority = PRIORITY_CONFIG[issue.priority as keyof typeof PRIORITY_CONFIG]
  const status = STATUSES.find((s) => s.id === issue.status)

  return (
    <div>
      {/* Header */}
      <header className="sticky top-0 z-20 bg-card/80 backdrop-blur border-b border-border">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/dashboard/issues"
                className="p-2 hover:bg-secondary rounded-lg transition-colors"
              >
                <ArrowLeft size={20} />
              </Link>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono text-muted-foreground">#{issue.id}</span>
                  {isEditingTitle ? (
                    <div className="flex items-center gap-2">
                      <input
                        value={editedTitle}
                        onChange={(e) => setEditedTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && editedTitle.trim()) {
                            updateIssue.mutate({ title: editedTitle.trim() })
                            setIsEditingTitle(false)
                          }
                          if (e.key === 'Escape') {
                            setEditedTitle(issue.title)
                            setIsEditingTitle(false)
                          }
                        }}
                        onBlur={() => {
                          if (editedTitle.trim() && editedTitle !== issue.title) {
                            updateIssue.mutate({ title: editedTitle.trim() })
                          }
                          setIsEditingTitle(false)
                        }}
                        className="px-3 py-1 bg-background border border-input rounded-lg text-2xl font-bold focus:outline-none focus:ring-2 focus:ring-ring min-w-[300px]"
                        autoFocus
                      />
                    </div>
                  ) : (
                    <h1
                      onClick={() => {
                        setEditedTitle(issue.title)
                        setIsEditingTitle(true)
                      }}
                      className="text-2xl font-bold cursor-pointer hover:bg-secondary/30 px-2 py-1 -mx-2 -my-1 rounded-lg transition-colors"
                      title="Click to edit"
                    >
                      {issue.title}
                    </h1>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  <Link
                    href={`/dashboard/${issue.project_id}`}
                    className="hover:text-primary"
                  >
                    {issue.project_name || `Project #${issue.project_id}`}
                  </Link>
                  {' - '}
                  Created {formatDistanceToNow(new Date(issue.created_at))} ago
                </p>
              </div>
            </div>
            {/* Auto-save indicator */}
            {updateIssue.isPending && (
              <span className="text-xs text-muted-foreground">Saving...</span>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="p-6">
        <div className="max-w-5xl mx-auto grid md:grid-cols-3 gap-6">
          {/* Main content */}
          <div className="md:col-span-2 space-y-6">
            {/* Description - Always editable like Linear */}
            <div className="bg-card rounded-lg border border-border p-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold">Description</h2>
                {isEditingDescription && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setEditedDescription(issue.description || '')
                        setIsEditingDescription(false)
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        updateIssue.mutate({ description: editedDescription })
                        setIsEditingDescription(false)
                      }}
                      disabled={updateIssue.isPending}
                      className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
                    >
                      {updateIssue.isPending ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                )}
              </div>
              {isEditingDescription ? (
                <RichTextEditor
                  content={editedDescription}
                  onChange={setEditedDescription}
                  placeholder="Add a description... Use the toolbar for formatting, images, code blocks, and more."
                  onImageUpload={handleImageUpload}
                />
              ) : (
                <div
                  onClick={() => {
                    setEditedDescription(issue.description || '')
                    setIsEditingDescription(true)
                  }}
                  className="cursor-pointer hover:bg-secondary/30 rounded-lg transition-colors min-h-[100px] -m-2 p-2"
                  title="Click to edit"
                >
                  {issue.description ? (
                    <RichTextDisplay content={issue.description} onImageClick={openLightbox} />
                  ) : (
                    <p className="text-sm text-muted-foreground italic">
                      Click to add a description...
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Attachments */}
            <div className="bg-card rounded-lg border border-border p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <Paperclip size={16} />
                  Attachments ({attachments.length})
                </h2>
                <label className="flex items-center gap-2 px-3 py-1.5 bg-secondary text-foreground rounded-lg text-sm font-medium hover:bg-secondary/80 cursor-pointer">
                  <Upload size={16} />
                  {isUploading ? 'Uploading...' : 'Upload'}
                  <input
                    type="file"
                    onChange={handleFileUpload}
                    disabled={isUploading}
                    className="hidden"
                    accept="image/*,application/pdf,text/plain,application/json,text/markdown"
                  />
                </label>
              </div>

              {attachments.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No attachments yet. Upload files to share with your team.
                </p>
              ) : (
                <div className="space-y-2">
                  {attachments.map((attachment) => {
                    const FileIcon = getFileIcon(attachment.mime_type)
                    const isImage = attachment.mime_type?.startsWith('image/')

                    return (
                      <div
                        key={attachment.id}
                        className="flex items-center gap-3 p-3 bg-secondary/50 rounded-lg group"
                      >
                        {isImage ? (
                          <div className="w-10 h-10 rounded overflow-hidden flex-shrink-0">
                            <img
                              src={attachment.file_url}
                              alt={attachment.filename}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        ) : (
                          <div className="w-10 h-10 bg-primary/10 rounded flex items-center justify-center flex-shrink-0">
                            <FileIcon size={20} className="text-primary" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{attachment.filename}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatFileSize(attachment.file_size)}
                            {attachment.uploader_name && ` - ${attachment.uploader_name}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <a
                            href={attachment.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 hover:bg-secondary rounded transition-colors"
                            title="Open in new tab"
                          >
                            <ExternalLink size={16} />
                          </a>
                          <button
                            onClick={() => {
                              if (confirm('Delete this attachment?')) {
                                deleteAttachmentMutation.mutate(attachment.id)
                              }
                            }}
                            className="p-1.5 hover:bg-red-500/10 text-red-500 rounded transition-colors"
                            title="Delete"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Activity History */}
            <div className="bg-card rounded-lg border border-border p-6">
              <button
                onClick={() => setShowActivity(!showActivity)}
                className="flex items-center justify-between w-full text-sm font-semibold mb-4"
              >
                <span className="flex items-center gap-2">
                  <History size={16} />
                  Activity History ({activity.length})
                </span>
                {showActivity ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>

              {showActivity && (
                <div className="space-y-4">
                  {activity.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No activity yet.
                    </p>
                  ) : (
                    activity.map((item) => (
                      <div key={`${item.type}-${item.id}`} className="flex gap-3">
                        {item.user_avatar ? (
                          <Image
                            src={item.user_avatar}
                            alt={item.user_name || 'User'}
                            width={32}
                            height={32}
                            className="rounded-full flex-shrink-0"
                          />
                        ) : (
                          <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0">
                            {item.user_name?.charAt(0) || 'U'}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="text-sm font-medium">
                              {item.user_name || 'Unknown'}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(item.created_at))} ago
                            </span>
                          </div>
                          {item.type === 'comment' ? (
                            <div className="text-sm bg-secondary/50 rounded-lg p-3">
                              <RichTextDisplay content={item.content || ''} onImageClick={openLightbox} />
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              {getChangeSummary(item)}
                            </p>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Add Comment */}
            <div className="bg-card rounded-lg border border-border p-6">
              <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <MessageSquare size={16} />
                Add Comment
              </h2>
              <div className="space-y-3">
                <RichTextEditor
                  content={commentContent}
                  onChange={setCommentContent}
                  placeholder="Write a comment..."
                  onImageUpload={handleImageUpload}
                />
                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      if (commentContent.trim()) {
                        createCommentMutation.mutate(commentContent.trim())
                      }
                    }}
                    disabled={!commentContent.trim() || createCommentMutation.isPending}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                  >
                    {createCommentMutation.isPending ? 'Posting...' : 'Post comment'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar - Inline editable fields */}
          <div className="space-y-4">
            {/* Status - Inline select */}
            <div className="bg-card rounded-lg border border-border p-4">
              <label className="block text-xs font-medium text-muted-foreground mb-2">
                Status
              </label>
              <select
                value={issue.status}
                onChange={(e) => updateIssue.mutate({ status: e.target.value })}
                className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer hover:border-primary transition-colors"
              >
                {STATUSES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Priority - Inline select */}
            <div className="bg-card rounded-lg border border-border p-4">
              <label className="block text-xs font-medium text-muted-foreground mb-2">
                Priority
              </label>
              <select
                value={issue.priority}
                onChange={(e) => updateIssue.mutate({ priority: parseInt(e.target.value) })}
                className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer hover:border-primary transition-colors"
              >
                <option value={1}>Urgent</option>
                <option value={2}>High</option>
                <option value={3}>Medium</option>
                <option value={4}>Low</option>
              </select>
            </div>

            {/* Assignee - Inline select */}
            <div className="bg-card rounded-lg border border-border p-4">
              <label className="block text-xs font-medium text-muted-foreground mb-2">
                Assignee
              </label>
              <select
                value={issue.assignee_id || ''}
                onChange={(e) => updateIssue.mutate({ assignee_id: e.target.value ? parseInt(e.target.value) : null } as any)}
                className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer hover:border-primary transition-colors"
              >
                <option value="">Unassigned</option>
                {members.map((m: any) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name || m.email}
                  </option>
                ))}
              </select>
            </div>

            {/* Start Date - Inline input */}
            <div className="bg-card rounded-lg border border-border p-4">
              <label className="block text-xs font-medium text-muted-foreground mb-2">
                <Calendar size={12} className="inline mr-1" />
                Start Date
              </label>
              <input
                type="date"
                value={issue.start_date ? issue.start_date.split('T')[0] : ''}
                onChange={(e) => updateIssue.mutate({ start_date: e.target.value || null } as any)}
                className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer hover:border-primary transition-colors"
              />
            </div>

            {/* Due Date - Inline input */}
            <div className="bg-card rounded-lg border border-border p-4">
              <label className="block text-xs font-medium text-muted-foreground mb-2">
                <Calendar size={12} className="inline mr-1" />
                Due Date
              </label>
              <input
                type="date"
                value={issue.due_date ? issue.due_date.split('T')[0] : ''}
                onChange={(e) => updateIssue.mutate({ due_date: e.target.value || null } as any)}
                className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer hover:border-primary transition-colors"
              />
            </div>

            {/* Milestone - Inline select */}
            <div className="bg-card rounded-lg border border-border p-4">
              <label className="block text-xs font-medium text-muted-foreground mb-2">
                Milestone
              </label>
              <select
                value={issue.milestone_id || ''}
                onChange={(e) => updateIssue.mutate({ milestone_id: e.target.value ? parseInt(e.target.value) : null } as any)}
                className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer hover:border-primary transition-colors"
              >
                <option value="">No milestone</option>
                {milestones.map((m: any) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Metadata */}
            <div className="bg-card rounded-lg border border-border p-4 space-y-2">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Created
                </label>
                <p className="text-sm">
                  {formatDistanceToNow(new Date(issue.created_at))} ago
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Updated
                </label>
                <p className="text-sm">
                  {formatDistanceToNow(new Date(issue.updated_at))} ago
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Image Lightbox */}
      {LightboxComponent}
    </div>
  )
}
