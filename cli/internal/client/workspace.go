package client

import (
	"encoding/json"
	"fmt"
)

// Workspace-aware client methods. Companion to client.go; the legacy methods
// in that file continue to work via server-side shims, but new commands
// should use these.

// ---------- workspaces ----------

type Workspace struct {
	ID         int     `json:"id" yaml:"id"`
	Name       string  `json:"name" yaml:"name"`
	Slug       string  `json:"slug" yaml:"slug"`
	Key        string  `json:"key" yaml:"key"`
	LogoURL    *string `json:"logo_url" yaml:"logo_url"`
	OwnerID    int     `json:"owner_id" yaml:"owner_id"`
	MemberRole string  `json:"member_role,omitempty" yaml:"member_role,omitempty"`
	CreatedAt  *string `json:"created_at" yaml:"created_at"`
}

type CreateWorkspaceRequest struct {
	Name string `json:"name"`
}

type UpdateWorkspaceRequest struct {
	Name    *string `json:"name,omitempty"`
	Slug    *string `json:"slug,omitempty"`
	Key     *string `json:"key,omitempty"`
	LogoURL *string `json:"logo_url,omitempty"`
}

func (c *Client) ListMyWorkspaces() ([]Workspace, error) {
	var resp struct {
		Data []Workspace `json:"data"`
	}
	if err := c.get("/api/me/workspaces", &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (c *Client) CreateWorkspace(name string) (*Workspace, error) {
	var ws Workspace
	if err := c.postJSON("/api/workspaces", CreateWorkspaceRequest{Name: name}, &ws); err != nil {
		return nil, err
	}
	return &ws, nil
}

type WorkspaceDetail struct {
	Workspace Workspace        `json:"workspace"`
	Role      string           `json:"role"`
	Members   []WorkspaceMember `json:"members"`
}

func (c *Client) GetWorkspace(slugOrID string) (*WorkspaceDetail, error) {
	var detail WorkspaceDetail
	if err := c.get(fmt.Sprintf("/api/workspaces/%s", slugOrID), &detail); err != nil {
		return nil, err
	}
	return &detail, nil
}

func (c *Client) UpdateWorkspace(slugOrID string, req UpdateWorkspaceRequest) (*Workspace, error) {
	var ws Workspace
	if err := c.patchJSON(fmt.Sprintf("/api/workspaces/%s", slugOrID), req, &ws); err != nil {
		return nil, err
	}
	return &ws, nil
}

func (c *Client) DeleteWorkspace(slugOrID string) error {
	return c.deleteJSON(fmt.Sprintf("/api/workspaces/%s", slugOrID), nil, nil)
}

func (c *Client) TransferOwnership(slugOrID string, newOwnerUserID int) error {
	body := map[string]int{"new_owner_user_id": newOwnerUserID}
	return c.postJSON(fmt.Sprintf("/api/workspaces/%s/transfer", slugOrID), body, nil)
}

func (c *Client) SetActiveWorkspace(workspaceID int) (*Workspace, error) {
	body := map[string]int{"workspace_id": workspaceID}
	var resp Workspace
	if err := c.postJSON("/api/me/active-workspace", body, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// ---------- members ----------

type WorkspaceMember struct {
	ID         int     `json:"id" yaml:"id"`
	WorkspaceID int    `json:"workspace_id" yaml:"workspace_id"`
	UserID     int     `json:"user_id" yaml:"user_id"`
	Role       string  `json:"role" yaml:"role"`
	JoinedAt   *string `json:"joined_at,omitempty" yaml:"joined_at,omitempty"`
	Email      string  `json:"email" yaml:"email"`
	Name       *string `json:"name" yaml:"name"`
	AvatarURL  *string `json:"avatar_url" yaml:"avatar_url"`
	DeletedAt  *string `json:"deleted_at,omitempty" yaml:"deleted_at,omitempty"`
}

func (c *Client) ListWorkspaceMembers(slugOrID string) ([]WorkspaceMember, error) {
	var resp struct {
		Data []WorkspaceMember `json:"data"`
	}
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/members", slugOrID), &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (c *Client) RemoveWorkspaceMember(slugOrID string, userID int) error {
	return c.deleteJSON(fmt.Sprintf("/api/workspaces/%s/members/%d", slugOrID, userID), nil, nil)
}

func (c *Client) LeaveWorkspace(slugOrID string) error {
	return c.postJSON(fmt.Sprintf("/api/workspaces/%s/leave", slugOrID), nil, nil)
}

// ---------- invitations ----------

type WorkspaceInvitation struct {
	ID             int     `json:"id" yaml:"id"`
	WorkspaceID    int     `json:"workspace_id" yaml:"workspace_id"`
	Email          string  `json:"email" yaml:"email"`
	Role           string  `json:"role" yaml:"role"`
	Token          string  `json:"token" yaml:"token"`
	Status         string  `json:"status" yaml:"status"`
	InvitedBy      int     `json:"invited_by" yaml:"invited_by"`
	InvitedByEmail *string `json:"invited_by_email,omitempty" yaml:"invited_by_email,omitempty"`
	WorkspaceName  string  `json:"workspace_name,omitempty" yaml:"workspace_name,omitempty"`
	WorkspaceSlug  string  `json:"workspace_slug,omitempty" yaml:"workspace_slug,omitempty"`
	ExpiresAt      string  `json:"expires_at" yaml:"expires_at"`
	CreatedAt      string  `json:"created_at" yaml:"created_at"`
}

type CreateInvitationResponse struct {
	Invitation        WorkspaceInvitation `json:"invitation"`
	InviteeHasAccount bool                `json:"invitee_has_account"`
}

func (c *Client) SendInvitation(slugOrID, email string) (*CreateInvitationResponse, error) {
	var resp CreateInvitationResponse
	if err := c.postJSON(
		fmt.Sprintf("/api/workspaces/%s/invitations", slugOrID),
		map[string]string{"email": email},
		&resp,
	); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *Client) ListInvitations(slugOrID string, includeAll bool) ([]WorkspaceInvitation, error) {
	path := fmt.Sprintf("/api/workspaces/%s/invitations", slugOrID)
	if includeAll {
		path += "?all=true"
	}
	var resp struct {
		Data []WorkspaceInvitation `json:"data"`
	}
	if err := c.get(path, &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (c *Client) RevokeInvitation(slugOrID string, id int) error {
	return c.deleteJSON(fmt.Sprintf("/api/workspaces/%s/invitations/%d", slugOrID, id), nil, nil)
}

func (c *Client) AcceptInvitation(token string) error {
	return c.postJSON("/api/invitations/accept", map[string]string{"token": token}, nil)
}

func (c *Client) DeclineInvitation(token string) error {
	return c.postJSON("/api/invitations/decline", map[string]string{"token": token}, nil)
}

func (c *Client) ListPendingInvitationsForMe() ([]WorkspaceInvitation, error) {
	var resp struct {
		Data []WorkspaceInvitation `json:"data"`
	}
	if err := c.get("/api/me/pending-invitations", &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

// ---------- inbox ----------

type InboxMessage struct {
	ID          int             `json:"id" yaml:"id"`
	UserID      int             `json:"user_id" yaml:"user_id"`
	WorkspaceID *int            `json:"workspace_id" yaml:"workspace_id"`
	Type        string          `json:"type" yaml:"type"`
	EntityType  *string         `json:"entity_type" yaml:"entity_type"`
	EntityID    *int            `json:"entity_id" yaml:"entity_id"`
	ActorUserID *int            `json:"actor_user_id" yaml:"actor_user_id"`
	Payload     json.RawMessage `json:"payload" yaml:"-"`
	ReadAt      *string         `json:"read_at" yaml:"read_at"`
	ArchivedAt  *string         `json:"archived_at" yaml:"archived_at"`
	CreatedAt   string          `json:"created_at" yaml:"created_at"`
}

type InboxPage struct {
	Data        []InboxMessage `json:"data" yaml:"data"`
	NextCursor  *int           `json:"next_cursor" yaml:"next_cursor"`
	UnreadCount int            `json:"unread_count" yaml:"unread_count"`
}

func (c *Client) ListInbox(unreadOnly, includeArchived bool) (*InboxPage, error) {
	path := "/api/me/inbox?limit=200"
	if unreadOnly {
		path += "&unread=true"
	}
	if includeArchived {
		path += "&include_archived=true"
	}
	var page InboxPage
	if err := c.get(path, &page); err != nil {
		return nil, err
	}
	return &page, nil
}

func (c *Client) InboxUnreadCount() (int, error) {
	var resp struct {
		UnreadCount int `json:"unread_count"`
	}
	if err := c.get("/api/me/inbox?count_only=true", &resp); err != nil {
		return 0, err
	}
	return resp.UnreadCount, nil
}

func (c *Client) MarkInboxRead(ids []int, all bool) (int, error) {
	body := map[string]any{}
	if all {
		body["all"] = true
	} else {
		body["ids"] = ids
	}
	var resp struct {
		MarkedRead int `json:"marked_read"`
	}
	if err := c.postJSON("/api/me/inbox/mark-read", body, &resp); err != nil {
		return 0, err
	}
	return resp.MarkedRead, nil
}

func (c *Client) ArchiveInbox(ids []int) (int, error) {
	body := map[string]any{"ids": ids}
	var resp struct {
		Archived int `json:"archived"`
	}
	if err := c.postJSON("/api/me/inbox/archive", body, &resp); err != nil {
		return 0, err
	}
	return resp.Archived, nil
}

// ---------- labels ----------

type Label struct {
	ID          int     `json:"id" yaml:"id"`
	WorkspaceID int     `json:"workspace_id" yaml:"workspace_id"`
	Name        string  `json:"name" yaml:"name"`
	Color       string  `json:"color" yaml:"color"`
	Description *string `json:"description" yaml:"description"`
	IssueCount  int     `json:"issue_count,omitempty" yaml:"issue_count,omitempty"`
	CreatedAt   *string `json:"created_at" yaml:"created_at"`
}

func (c *Client) ListLabels(slugOrID string) ([]Label, error) {
	var resp struct {
		Data []Label `json:"data"`
	}
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/labels", slugOrID), &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

type CreateLabelRequest struct {
	Name        string  `json:"name"`
	Color       string  `json:"color,omitempty"`
	Description *string `json:"description,omitempty"`
}

func (c *Client) CreateLabel(slugOrID string, req CreateLabelRequest) (*Label, error) {
	var label Label
	if err := c.postJSON(fmt.Sprintf("/api/workspaces/%s/labels", slugOrID), req, &label); err != nil {
		return nil, err
	}
	return &label, nil
}

func (c *Client) DeleteLabel(slugOrID string, id int) error {
	return c.deleteJSON(fmt.Sprintf("/api/workspaces/%s/labels/%d", slugOrID, id), nil, nil)
}

func (c *Client) AttachIssueLabel(slugOrID string, issueID, labelID int) error {
	body := map[string]int{"label_id": labelID}
	return c.postJSON(
		fmt.Sprintf("/api/workspaces/%s/issues/%d/labels", slugOrID, issueID),
		body,
		nil,
	)
}

func (c *Client) DetachIssueLabel(slugOrID string, issueID, labelID int) error {
	return c.deleteJSON(
		fmt.Sprintf("/api/workspaces/%s/issues/%d/labels/%d", slugOrID, issueID, labelID),
		nil,
		nil,
	)
}
