package client

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type APIError struct {
	Status     int
	ErrorMsg   string `json:"error"`
	Suggestion string `json:"suggestion,omitempty"`
	Details    string `json:"details,omitempty"`
}

func (e *APIError) Error() string {
	if e.Suggestion != "" {
		return fmt.Sprintf("%s (%d) — %s", e.ErrorMsg, e.Status, e.Suggestion)
	}
	if e.Details != "" {
		return fmt.Sprintf("%s (%d): %s", e.ErrorMsg, e.Status, e.Details)
	}
	return fmt.Sprintf("%s (%d)", e.ErrorMsg, e.Status)
}

type Client struct {
	BaseURL string
	Token   string
	// WorkspaceSlug is the active workspace slug from config, used to build
	// canonical /api/workspaces/{slug}/... routes.
	WorkspaceSlug string
	HTTP          *http.Client
}

func New(baseURL, token, workspaceSlug string) *Client {
	return &Client{
		BaseURL:       strings.TrimRight(baseURL, "/"),
		Token:         token,
		WorkspaceSlug: workspaceSlug,
		HTTP:          &http.Client{Timeout: 30 * time.Second},
	}
}

// wsPath builds a workspace-scoped path of the form
// /api/workspaces/{slug}/{suffix}. The suffix should NOT include a leading
// slash for the workspace segment; e.g. wsPath("issues") ->
// /api/workspaces/acme/issues. Returns an error if no active workspace is set.
func (c *Client) wsPath(suffix string) (string, error) {
	if c.WorkspaceSlug == "" {
		return "", fmt.Errorf("no active workspace; run `bk workspace use <slug>`")
	}
	suffix = strings.TrimPrefix(suffix, "/")
	if suffix == "" {
		return "/api/workspaces/" + c.WorkspaceSlug, nil
	}
	return "/api/workspaces/" + c.WorkspaceSlug + "/" + suffix, nil
}

func (c *Client) do(req *http.Request, out any) error {
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "bk-cli/0.1")

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	if resp.StatusCode >= 400 {
		var ae APIError
		_ = json.Unmarshal(body, &ae)
		ae.Status = resp.StatusCode
		if ae.ErrorMsg == "" {
			ae.ErrorMsg = strings.TrimSpace(string(body))
			if ae.ErrorMsg == "" {
				ae.ErrorMsg = http.StatusText(resp.StatusCode)
			}
		}
		return &ae
	}

	if out == nil {
		return nil
	}
	if len(body) == 0 {
		return nil
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("decode response: %w (body=%q)", err, truncate(string(body), 200))
	}
	return nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

func (c *Client) get(path string, out any) error {
	req, err := http.NewRequest(http.MethodGet, c.BaseURL+path, nil)
	if err != nil {
		return err
	}
	return c.do(req, out)
}

func (c *Client) postJSON(path string, body any, out any) error {
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			return err
		}
	}
	req, err := http.NewRequest(http.MethodPost, c.BaseURL+path, &buf)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	return c.do(req, out)
}

func (c *Client) patchJSON(path string, body any, out any) error {
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			return err
		}
	}
	req, err := http.NewRequest(http.MethodPatch, c.BaseURL+path, &buf)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	return c.do(req, out)
}

// ----- public methods -----

func (c *Client) Whoami() (*Me, error) {
	var me Me
	if err := c.get("/api/me", &me); err != nil {
		return nil, err
	}
	return &me, nil
}

func (c *Client) ListProjects() ([]Project, error) {
	path, err := c.wsPath("projects")
	if err != nil {
		return nil, err
	}
	var page ProjectsPage
	if err := c.get(path, &page); err != nil {
		return nil, err
	}
	return page.Data, nil
}

func (c *Client) GetProject(id int) (*Project, error) {
	path, err := c.wsPath(fmt.Sprintf("projects/%d", id))
	if err != nil {
		return nil, err
	}
	var p Project
	if err := c.get(path, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

func (c *Client) ListIssues(opts ListIssuesOpts) (*IssuesPage, error) {
	q := url.Values{}
	if opts.ProjectID > 0 {
		q.Set("project_id", fmt.Sprint(opts.ProjectID))
	}
	if opts.Limit > 0 {
		q.Set("limit", fmt.Sprint(opts.Limit))
	}
	if opts.Cursor != nil {
		q.Set("cursor", fmt.Sprint(*opts.Cursor))
	}

	path, err := c.wsPath("issues")
	if err != nil {
		return nil, err
	}
	if len(q) > 0 {
		path += "?" + q.Encode()
	}

	var page IssuesPage
	if err := c.get(path, &page); err != nil {
		return nil, err
	}
	return &page, nil
}

type ListIssuesOpts struct {
	ProjectID int
	Status    string
	Limit     int
	Cursor    *int
}

type ListProjectsOpts struct {
	Limit  int
	Cursor *int
}

func (c *Client) ListProjectsPage(opts ListProjectsOpts) (*ProjectsPage, error) {
	q := url.Values{}
	if opts.Limit > 0 {
		q.Set("limit", fmt.Sprint(opts.Limit))
	}
	if opts.Cursor != nil {
		q.Set("cursor", fmt.Sprint(*opts.Cursor))
	}
	path, err := c.wsPath("projects")
	if err != nil {
		return nil, err
	}
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	var page ProjectsPage
	if err := c.get(path, &page); err != nil {
		return nil, err
	}
	return &page, nil
}

func (c *Client) ListUsers() ([]User, error) {
	var users []User
	if err := c.get("/api/users", &users); err != nil {
		return nil, err
	}
	return users, nil
}

func (c *Client) ListProjectMembers(projectID int) ([]ProjectMember, error) {
	path, err := c.wsPath(fmt.Sprintf("projects/%d/members", projectID))
	if err != nil {
		return nil, err
	}
	var env projectMembersEnvelope
	if err := c.get(path, &env); err != nil {
		return nil, err
	}
	return env.Data, nil
}

func (c *Client) ListIssueComments(issueID int) ([]Comment, error) {
	path, err := c.wsPath(fmt.Sprintf("issues/%d/comments", issueID))
	if err != nil {
		return nil, err
	}
	var env commentsEnvelope
	if err := c.get(path, &env); err != nil {
		return nil, err
	}
	return env.Data, nil
}

func (c *Client) ListIssueActivity(issueID int) ([]ActivityItem, error) {
	path, err := c.wsPath(fmt.Sprintf("issues/%d/activity", issueID))
	if err != nil {
		return nil, err
	}
	var env activityEnvelope
	if err := c.get(path, &env); err != nil {
		return nil, err
	}
	return env.Data, nil
}

func (c *Client) ListIssueAttachments(issueID int) ([]Attachment, error) {
	path, err := c.wsPath(fmt.Sprintf("issues/%d/attachments", issueID))
	if err != nil {
		return nil, err
	}
	var env attachmentsEnvelope
	if err := c.get(path, &env); err != nil {
		return nil, err
	}
	return env.Data, nil
}

func (c *Client) ListMilestones(projectID int) ([]Milestone, error) {
	path, err := c.wsPath("milestones")
	if err != nil {
		return nil, err
	}
	if projectID > 0 {
		path += "?project_id=" + fmt.Sprint(projectID)
	}
	var env milestonesEnvelope
	if err := c.get(path, &env); err != nil {
		return nil, err
	}
	return env.Data, nil
}

func (c *Client) GetMilestone(id int, includeIssues bool) (*Milestone, error) {
	path, err := c.wsPath(fmt.Sprintf("milestones/%d", id))
	if err != nil {
		return nil, err
	}
	if includeIssues {
		path += "?includeIssues=true"
	}
	var m Milestone
	if err := c.get(path, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

// Activity returns the workspace-scoped activity feed. The scoped route is
// keyset-paginated (cursor = last event id seen); pass cursor=nil for the first
// page. It returns the page of items plus the next cursor (nil when exhausted).
func (c *Client) Activity(limit int, cursor *int) ([]ActivityFeedItem, *int, error) {
	q := url.Values{}
	if limit > 0 {
		q.Set("limit", fmt.Sprint(limit))
	}
	if cursor != nil {
		q.Set("cursor", fmt.Sprint(*cursor))
	}
	path, err := c.wsPath("activity")
	if err != nil {
		return nil, nil, err
	}
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	var env activityFeedEnvelope
	if err := c.get(path, &env); err != nil {
		return nil, nil, err
	}
	return env.Data, env.NextCursor, nil
}

// AnalyticsRaw fetches the workspace-scoped analytics payload as raw JSON. The
// scoped route reads the workspace from the path, so any `ws`/`workspace` value
// in q is consumed as the target slug (and removed from the query); otherwise
// the active workspace is used.
func (c *Client) AnalyticsRaw(q url.Values) (json.RawMessage, error) {
	slug := ""
	if v := q.Get("ws"); v != "" {
		slug = v
	} else if v := q.Get("workspace"); v != "" {
		slug = v
	}
	q.Del("ws")
	q.Del("workspace")

	var path string
	var err error
	if slug != "" {
		path = "/api/workspaces/" + slug + "/analytics"
	} else {
		path, err = c.wsPath("analytics")
		if err != nil {
			return nil, err
		}
	}
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	var raw json.RawMessage
	if err := c.get(path, &raw); err != nil {
		return nil, err
	}
	return raw, nil
}

// ----- write methods -----

func (c *Client) deleteJSON(path string, body any, out any) error {
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			return err
		}
	}
	req, err := http.NewRequest(http.MethodDelete, c.BaseURL+path, &buf)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	return c.do(req, out)
}

func (c *Client) CreateProject(req CreateProjectRequest) (*Project, error) {
	path, err := c.wsPath("projects")
	if err != nil {
		return nil, err
	}
	var p Project
	if err := c.postJSON(path, req, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

func (c *Client) UpdateProject(id int, req UpdateProjectRequest) (*Project, error) {
	path, err := c.wsPath(fmt.Sprintf("projects/%d", id))
	if err != nil {
		return nil, err
	}
	var p Project
	if err := c.patchJSON(path, req, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

// DeleteProject moves a project to the recycle bin. mode is "cascade" (also bin
// the attached issues/milestones) or "detach"/"" (keep them, unlinked).
func (c *Client) DeleteProject(id int, mode string) error {
	path, err := c.wsPath(fmt.Sprintf("projects/%d", id))
	if err != nil {
		return err
	}
	if mode != "" {
		path += "?mode=" + mode
	}
	return c.deleteJSON(path, nil, nil)
}

func (c *Client) AddProjectMember(projectID int, req AddMemberRequest) (*ProjectMember, error) {
	path, err := c.wsPath(fmt.Sprintf("projects/%d/members", projectID))
	if err != nil {
		return nil, err
	}
	var m ProjectMember
	if err := c.postJSON(path, req, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

func (c *Client) RemoveProjectMember(projectID, userID int) error {
	path, err := c.wsPath(fmt.Sprintf("projects/%d/members", projectID))
	if err != nil {
		return err
	}
	body := map[string]any{"user_id": userID}
	return c.deleteJSON(path, body, nil)
}

func (c *Client) DeleteIssue(id int) error {
	path, err := c.wsPath(fmt.Sprintf("issues/%d", id))
	if err != nil {
		return err
	}
	return c.deleteJSON(path, nil, nil)
}

func (c *Client) CreateComment(issueID int, req CreateCommentRequest) (*Comment, error) {
	path, err := c.wsPath(fmt.Sprintf("issues/%d/comments", issueID))
	if err != nil {
		return nil, err
	}
	var cm Comment
	if err := c.postJSON(path, req, &cm); err != nil {
		return nil, err
	}
	return &cm, nil
}

func (c *Client) DeleteAttachment(issueID, attachmentID int) error {
	path, err := c.wsPath(fmt.Sprintf("issues/%d/attachments/%d", issueID, attachmentID))
	if err != nil {
		return err
	}
	return c.deleteJSON(path, nil, nil)
}

func (c *Client) CreateMilestone(req CreateMilestoneRequest) (*Milestone, error) {
	path, err := c.wsPath("milestones")
	if err != nil {
		return nil, err
	}
	var m Milestone
	if err := c.postJSON(path, req, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

func (c *Client) UpdateMilestone(id int, req UpdateMilestoneRequest) (*Milestone, error) {
	path, err := c.wsPath(fmt.Sprintf("milestones/%d", id))
	if err != nil {
		return nil, err
	}
	var m Milestone
	if err := c.patchJSON(path, req, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

// DeleteMilestone moves a milestone to the recycle bin. mode is "cascade" (also
// bin the attached issues) or "detach"/"" (keep them, unlinked).
func (c *Client) DeleteMilestone(id int, mode string) error {
	path, err := c.wsPath(fmt.Sprintf("milestones/%d", id))
	if err != nil {
		return err
	}
	if mode != "" {
		path += "?mode=" + mode
	}
	return c.deleteJSON(path, nil, nil)
}

func (c *Client) Undo(count int) (*UndoResponse, error) {
	body := map[string]any{"count": count}
	var resp UndoResponse
	if err := c.postJSON("/api/undo", body, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (c *Client) AttachExisting(issueID int, up *UploadResponse) (*Attachment, error) {
	return c.AttachToIssue(issueID, up)
}

func (c *Client) GetIssue(id int) (*Issue, error) {
	path, err := c.wsPath(fmt.Sprintf("issues/%d", id))
	if err != nil {
		return nil, err
	}
	var iss Issue
	if err := c.get(path, &iss); err != nil {
		return nil, err
	}
	return &iss, nil
}

func (c *Client) CreateIssue(req CreateIssueRequest) (*Issue, error) {
	path, err := c.wsPath("issues")
	if err != nil {
		return nil, err
	}
	var iss Issue
	if err := c.postJSON(path, req, &iss); err != nil {
		return nil, err
	}
	return &iss, nil
}

func (c *Client) UpdateIssue(id int, req UpdateIssueRequest) (*Issue, error) {
	path, err := c.wsPath(fmt.Sprintf("issues/%d", id))
	if err != nil {
		return nil, err
	}
	var iss Issue
	if err := c.patchJSON(path, req, &iss); err != nil {
		return nil, err
	}
	return &iss, nil
}

func (c *Client) UploadFile(filePath string) (*UploadResponse, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	base := filepath.Base(filePath)
	ctype := mime.TypeByExtension(filepath.Ext(base))
	if ctype == "" {
		ctype = "application/octet-stream"
	}
	if i := strings.Index(ctype, ";"); i >= 0 {
		ctype = strings.TrimSpace(ctype[:i])
	}

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename=%q`, base))
	h.Set("Content-Type", ctype)
	fw, err := w.CreatePart(h)
	if err != nil {
		return nil, err
	}
	if _, err := io.Copy(fw, f); err != nil {
		return nil, err
	}
	if err := w.Close(); err != nil {
		return nil, err
	}

	req, err := http.NewRequest(http.MethodPost, c.BaseURL+"/api/upload", &buf)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())

	var up UploadResponse
	if err := c.do(req, &up); err != nil {
		return nil, err
	}
	return &up, nil
}

func (c *Client) AttachToIssue(issueID int, up *UploadResponse) (*Attachment, error) {
	body := map[string]any{
		"filename":  up.Filename,
		"file_url":  up.URL,
		"file_size": up.Size,
		"mime_type": up.ContentType,
	}
	path, err := c.wsPath(fmt.Sprintf("issues/%d/attachments", issueID))
	if err != nil {
		return nil, err
	}
	var att Attachment
	if err := c.postJSON(path, body, &att); err != nil {
		return nil, err
	}
	return &att, nil
}
