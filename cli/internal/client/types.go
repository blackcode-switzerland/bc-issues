package client

import "encoding/json"

type Me struct {
	ID        int     `json:"id" yaml:"id"`
	Email     string  `json:"email" yaml:"email"`
	Name      *string `json:"name" yaml:"name"`
	AvatarURL *string `json:"avatar_url" yaml:"avatar_url"`
	Role      string  `json:"role" yaml:"role"`
	Via       string  `json:"via" yaml:"via"`
}

type User struct {
	ID        int     `json:"id" yaml:"id"`
	Email     string  `json:"email" yaml:"email"`
	Name      *string `json:"name" yaml:"name"`
	AvatarURL *string `json:"avatar_url" yaml:"avatar_url"`
	Role      string  `json:"role" yaml:"role"`
}

type Project struct {
	ID          int     `json:"id" yaml:"id"`
	Name        string  `json:"name" yaml:"name"`
	Description *string `json:"description" yaml:"description"`
	Status      *string `json:"status" yaml:"status"`
	OwnerID     *int    `json:"owner_id" yaml:"owner_id"`
	IssueCount  *int    `json:"issue_count,omitempty" yaml:"issue_count,omitempty"`
	OpenIssues  *int    `json:"open_issues,omitempty" yaml:"open_issues,omitempty"`
	MemberRole  *string `json:"member_role,omitempty" yaml:"member_role,omitempty"`
	CreatedAt   *string `json:"created_at" yaml:"created_at"`
}

type Issue struct {
	ID              int             `json:"id" yaml:"id"`
	ProjectID       int             `json:"project_id" yaml:"project_id"`
	MilestoneID     *int            `json:"milestone_id" yaml:"milestone_id"`
	Title           string          `json:"title" yaml:"title"`
	Description     *string         `json:"description" yaml:"description"`
	Status          string          `json:"status" yaml:"status"`
	Priority        int             `json:"priority" yaml:"priority"`
	AssigneeID      *int            `json:"assignee_id" yaml:"assignee_id"`
	ReporterID      *int            `json:"reporter_id" yaml:"reporter_id"`
	StartDate       *string         `json:"start_date" yaml:"start_date"`
	DueDate         *string         `json:"due_date" yaml:"due_date"`
	EstimatedHours  json.RawMessage `json:"estimated_hours,omitempty" yaml:"-"`
	AssigneeName    *string         `json:"assignee_name,omitempty" yaml:"assignee_name,omitempty"`
	AssigneeAvatar  *string         `json:"assignee_avatar,omitempty" yaml:"assignee_avatar,omitempty"`
	MilestoneName   *string         `json:"milestone_name,omitempty" yaml:"milestone_name,omitempty"`
	ProjectName     *string         `json:"project_name,omitempty" yaml:"project_name,omitempty"`
	CommentCount    *int            `json:"comment_count,omitempty" yaml:"comment_count,omitempty"`
	AttachmentCount *int            `json:"attachment_count,omitempty" yaml:"attachment_count,omitempty"`
	CreatedAt       *string         `json:"created_at" yaml:"created_at"`
	UpdatedAt       *string         `json:"updated_at" yaml:"updated_at"`
}

type IssuesPage struct {
	Data       []Issue `json:"data" yaml:"data"`
	NextCursor *int    `json:"next_cursor" yaml:"next_cursor"`
}

type ProjectsPage struct {
	Data       []Project `json:"data" yaml:"data"`
	NextCursor *int      `json:"next_cursor" yaml:"next_cursor"`
}

type ProjectMember struct {
	ID        int     `json:"id" yaml:"id"`
	ProjectID int     `json:"project_id" yaml:"project_id"`
	UserID    int     `json:"user_id" yaml:"user_id"`
	Role      string  `json:"role" yaml:"role"`
	Name      *string `json:"name" yaml:"name"`
	Email     string  `json:"email" yaml:"email"`
	AvatarURL *string `json:"avatar_url" yaml:"avatar_url"`
	CreatedAt *string `json:"created_at,omitempty" yaml:"created_at,omitempty"`
}

type Milestone struct {
	ID               int     `json:"id" yaml:"id"`
	ProjectID        int     `json:"project_id" yaml:"project_id"`
	Name             string  `json:"name" yaml:"name"`
	Description      *string `json:"description" yaml:"description"`
	DueDate          *string `json:"due_date" yaml:"due_date"`
	Status           *string `json:"status,omitempty" yaml:"status,omitempty"`
	ProjectName      *string `json:"project_name,omitempty" yaml:"project_name,omitempty"`
	IssueCount       *int    `json:"issue_count,omitempty" yaml:"issue_count,omitempty"`
	CompletedIssues  *int    `json:"completed_issues,omitempty" yaml:"completed_issues,omitempty"`
	CreatedAt        *string `json:"created_at,omitempty" yaml:"created_at,omitempty"`
	UpdatedAt        *string `json:"updated_at,omitempty" yaml:"updated_at,omitempty"`
	Issues           []Issue `json:"issues,omitempty" yaml:"issues,omitempty"`
}

type Comment struct {
	ID           int     `json:"id" yaml:"id"`
	IssueID      int     `json:"issue_id" yaml:"issue_id"`
	UserID       *int    `json:"user_id" yaml:"user_id"`
	Content      string  `json:"content" yaml:"content"`
	AuthorName   *string `json:"author_name,omitempty" yaml:"author_name,omitempty"`
	AuthorAvatar *string `json:"author_avatar,omitempty" yaml:"author_avatar,omitempty"`
	CreatedAt    *string `json:"created_at" yaml:"created_at"`
	UpdatedAt    *string `json:"updated_at,omitempty" yaml:"updated_at,omitempty"`
}

type ActivityItem struct {
	ID            int             `json:"id" yaml:"id"`
	Type          string          `json:"type" yaml:"type"`
	Content       *string         `json:"content,omitempty" yaml:"content,omitempty"`
	OperationType *string         `json:"operation_type,omitempty" yaml:"operation_type,omitempty"`
	OldData       json.RawMessage `json:"old_data,omitempty" yaml:"-"`
	NewData       json.RawMessage `json:"new_data,omitempty" yaml:"-"`
	UserID        *int            `json:"user_id" yaml:"user_id"`
	UserName      *string         `json:"user_name,omitempty" yaml:"user_name,omitempty"`
	UserAvatar    *string         `json:"user_avatar,omitempty" yaml:"user_avatar,omitempty"`
	CreatedAt     *string         `json:"created_at" yaml:"created_at"`
}

type ActivityFeedItem struct {
	ID            int             `json:"id" yaml:"id"`
	OperationType string          `json:"operation_type" yaml:"operation_type"`
	TableName     string          `json:"table_name" yaml:"table_name"`
	RecordID      *int            `json:"record_id" yaml:"record_id"`
	UserID        *int            `json:"user_id" yaml:"user_id"`
	UserName      *string         `json:"user_name,omitempty" yaml:"user_name,omitempty"`
	OldData       json.RawMessage `json:"old_data,omitempty" yaml:"-"`
	NewData       json.RawMessage `json:"new_data,omitempty" yaml:"-"`
	CreatedAt     *string         `json:"created_at" yaml:"created_at"`
}

type CreateIssueRequest struct {
	ProjectID   int             `json:"project_id"`
	Title       string          `json:"title"`
	Description string          `json:"description,omitempty"`
	Status      string          `json:"status,omitempty"`
	Priority    int             `json:"priority,omitempty"`
	AssigneeID  json.RawMessage `json:"assignee_id,omitempty"`
	MilestoneID json.RawMessage `json:"milestone_id,omitempty"`
	StartDate   *string         `json:"start_date,omitempty"`
	DueDate     *string         `json:"due_date,omitempty"`
}

// UpdateIssueRequest uses json.RawMessage for assignee_id, milestone_id,
// start_date, due_date so they can be sent as null to clear, an int/string
// to set, or omitted entirely to leave untouched.
type UpdateIssueRequest struct {
	Title       *string         `json:"title,omitempty"`
	Description *string         `json:"description,omitempty"`
	Status      *string         `json:"status,omitempty"`
	Priority    *int            `json:"priority,omitempty"`
	AssigneeID  json.RawMessage `json:"assignee_id,omitempty"`
	MilestoneID json.RawMessage `json:"milestone_id,omitempty"`
	StartDate   json.RawMessage `json:"start_date,omitempty"`
	DueDate     json.RawMessage `json:"due_date,omitempty"`
}

type CreateProjectRequest struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

type UpdateProjectRequest struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
	Status      *string `json:"status,omitempty"`
}

type AddMemberRequest struct {
	Email string `json:"email"`
	Role  string `json:"role,omitempty"`
}

type CreateMilestoneRequest struct {
	ProjectID   int     `json:"project_id"`
	Name        string  `json:"name"`
	Description string  `json:"description,omitempty"`
	DueDate     *string `json:"due_date,omitempty"`
}

type UpdateMilestoneRequest struct {
	Name        *string         `json:"name,omitempty"`
	Description *string         `json:"description,omitempty"`
	DueDate     json.RawMessage `json:"due_date,omitempty"`
}

type CreateCommentRequest struct {
	Content string `json:"content"`
}

type UndoResponse struct {
	Success     bool            `json:"success" yaml:"success"`
	UndoneCount int             `json:"undone_count" yaml:"undone_count"`
	Operations  json.RawMessage `json:"operations" yaml:"-"`
}

type UploadResponse struct {
	URL         string `json:"url"`
	Filename    string `json:"filename"`
	Size        int    `json:"size"`
	ContentType string `json:"contentType"`
}

type Attachment struct {
	ID        int     `json:"id" yaml:"id"`
	IssueID   int     `json:"issue_id" yaml:"issue_id"`
	Filename  string  `json:"filename" yaml:"filename"`
	FileURL   string  `json:"file_url" yaml:"file_url"`
	FileSize  *int    `json:"file_size" yaml:"file_size"`
	MimeType  string  `json:"mime_type" yaml:"mime_type"`
	UploadedBy *int   `json:"uploaded_by,omitempty" yaml:"uploaded_by,omitempty"`
	CreatedAt *string `json:"created_at,omitempty" yaml:"created_at,omitempty"`
}

type Analytics struct {
	Raw json.RawMessage `json:"-" yaml:"-"`
}
