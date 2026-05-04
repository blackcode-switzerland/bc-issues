// Shared types for Blackcode Issues

export interface User {
  id: number
  google_id?: string
  email: string
  name?: string
  avatar_url?: string
  role: string
  last_login?: string
  created_at: string
  updated_at: string
}

export interface Project {
  id: number
  name: string
  description?: string
  status: string
  owner_id?: number
  issue_count?: number
  open_issues?: number
  member_role?: string
  created_at: string
  updated_at: string
}

export interface Milestone {
  id: number
  project_id: number
  name: string
  description?: string
  due_date?: string
  status: string
  issue_count?: number
  completed_issues?: number
  created_at: string
  updated_at: string
}

export interface Issue {
  id: number
  project_id: number
  milestone_id?: number
  title: string
  description?: string
  status: string
  priority: number
  assignee_id?: number
  reporter_id?: number
  due_date?: string
  estimate_hours?: number
  assignee_name?: string
  assignee_avatar?: string
  milestone_name?: string
  labels?: string[]
  comment_count: number
  attachment_count: number
  created_at: string
  updated_at: string
}

export interface Comment {
  id: number
  issue_id: number
  user_id?: number
  content: string
  author_name?: string
  author_avatar?: string
  created_at: string
  updated_at: string
}

export interface Attachment {
  id: number
  issue_id: number
  filename: string
  file_url: string
  file_size?: number
  mime_type?: string
  uploaded_by?: number
  created_at: string
}

export interface Label {
  id: number
  project_id: number
  name: string
  color: string
  description?: string
  created_at: string
}

export interface ProjectMember {
  id: number
  project_id: number
  user_id: number
  role: string
  name?: string
  email?: string
  avatar_url?: string
  joined_at: string
}

export interface TransactionLog {
  id: number
  user_id?: number
  operation_type: string
  table_name: string
  record_id: number
  old_data?: Record<string, unknown>
  new_data?: Record<string, unknown>
  rolled_back: boolean
  created_at: string
}

export interface KanbanData {
  backlog: Issue[]
  todo: Issue[]
  in_progress: Issue[]
  blocked: Issue[]
  in_review: Issue[]
  done: Issue[]
  [key: string]: Issue[]
}

// API Response types
export interface ApiError {
  error: string
  suggestion?: string
}

export interface ApiSuccess<T> {
  data: T
}

