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
	HTTP    *http.Client
}

func New(baseURL, token string) *Client {
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		Token:   token,
		HTTP:    &http.Client{Timeout: 30 * time.Second},
	}
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
	if err := c.get("/api/users/me", &me); err != nil {
		return nil, err
	}
	return &me, nil
}

func (c *Client) ListProjects() ([]Project, error) {
	var projects []Project
	if err := c.get("/api/projects", &projects); err != nil {
		return nil, err
	}
	return projects, nil
}

func (c *Client) GetProject(id int) (*Project, error) {
	var p Project
	if err := c.get(fmt.Sprintf("/api/projects/%d", id), &p); err != nil {
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

	path := "/api/issues"
	if len(q) > 0 {
		path += "?" + q.Encode()
	}

	if opts.Limit > 0 || opts.Cursor != nil {
		var page IssuesPage
		if err := c.get(path, &page); err != nil {
			return nil, err
		}
		return &page, nil
	}

	var issues []Issue
	if err := c.get(path, &issues); err != nil {
		return nil, err
	}
	return &IssuesPage{Data: issues, NextCursor: nil}, nil
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
	path := "/api/projects"
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	if opts.Limit > 0 || opts.Cursor != nil {
		var page ProjectsPage
		if err := c.get(path, &page); err != nil {
			return nil, err
		}
		return &page, nil
	}
	var projects []Project
	if err := c.get(path, &projects); err != nil {
		return nil, err
	}
	return &ProjectsPage{Data: projects, NextCursor: nil}, nil
}

func (c *Client) ListUsers() ([]User, error) {
	var users []User
	if err := c.get("/api/users", &users); err != nil {
		return nil, err
	}
	return users, nil
}

func (c *Client) ListProjectMembers(projectID int) ([]ProjectMember, error) {
	var members []ProjectMember
	if err := c.get(fmt.Sprintf("/api/projects/%d/members", projectID), &members); err != nil {
		return nil, err
	}
	return members, nil
}

func (c *Client) ListIssueComments(issueID int) ([]Comment, error) {
	var comments []Comment
	if err := c.get(fmt.Sprintf("/api/issues/%d/comments", issueID), &comments); err != nil {
		return nil, err
	}
	return comments, nil
}

func (c *Client) ListIssueActivity(issueID int) ([]ActivityItem, error) {
	var items []ActivityItem
	if err := c.get(fmt.Sprintf("/api/issues/%d/activity", issueID), &items); err != nil {
		return nil, err
	}
	return items, nil
}

func (c *Client) ListIssueAttachments(issueID int) ([]Attachment, error) {
	var atts []Attachment
	if err := c.get(fmt.Sprintf("/api/issues/%d/attachments", issueID), &atts); err != nil {
		return nil, err
	}
	return atts, nil
}

func (c *Client) ListMilestones(projectID int) ([]Milestone, error) {
	path := "/api/milestones"
	if projectID > 0 {
		path += "?project_id=" + fmt.Sprint(projectID)
	}
	var milestones []Milestone
	if err := c.get(path, &milestones); err != nil {
		return nil, err
	}
	return milestones, nil
}

func (c *Client) GetMilestone(id int, includeIssues bool) (*Milestone, error) {
	path := fmt.Sprintf("/api/milestones/%d", id)
	if includeIssues {
		path += "?includeIssues=true"
	}
	var m Milestone
	if err := c.get(path, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

func (c *Client) Activity(limit, offset int) ([]ActivityFeedItem, error) {
	q := url.Values{}
	if limit > 0 {
		q.Set("limit", fmt.Sprint(limit))
	}
	if offset > 0 {
		q.Set("offset", fmt.Sprint(offset))
	}
	path := "/api/activity"
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	var items []ActivityFeedItem
	if err := c.get(path, &items); err != nil {
		return nil, err
	}
	return items, nil
}

func (c *Client) AnalyticsRaw(q url.Values) (json.RawMessage, error) {
	path := "/api/analytics"
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
	var p Project
	if err := c.postJSON("/api/projects", req, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

func (c *Client) UpdateProject(id int, req UpdateProjectRequest) (*Project, error) {
	var p Project
	if err := c.patchJSON(fmt.Sprintf("/api/projects/%d", id), req, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

// DeleteProject moves a project to the recycle bin. mode is "cascade" (also bin
// the attached issues/milestones) or "detach"/"" (keep them, unlinked).
func (c *Client) DeleteProject(id int, mode string) error {
	path := fmt.Sprintf("/api/projects/%d", id)
	if mode != "" {
		path += "?mode=" + mode
	}
	return c.deleteJSON(path, nil, nil)
}

func (c *Client) AddProjectMember(projectID int, req AddMemberRequest) (*ProjectMember, error) {
	var m ProjectMember
	if err := c.postJSON(fmt.Sprintf("/api/projects/%d/members", projectID), req, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

func (c *Client) RemoveProjectMember(projectID, userID int) error {
	body := map[string]any{"user_id": userID}
	return c.deleteJSON(fmt.Sprintf("/api/projects/%d/members", projectID), body, nil)
}

func (c *Client) DeleteIssue(id int) error {
	return c.deleteJSON(fmt.Sprintf("/api/issues/%d", id), nil, nil)
}

func (c *Client) CreateComment(issueID int, req CreateCommentRequest) (*Comment, error) {
	var cm Comment
	if err := c.postJSON(fmt.Sprintf("/api/issues/%d/comments", issueID), req, &cm); err != nil {
		return nil, err
	}
	return &cm, nil
}

func (c *Client) DeleteAttachment(issueID, attachmentID int) error {
	path := fmt.Sprintf("/api/issues/%d/attachments?attachmentId=%d", issueID, attachmentID)
	return c.deleteJSON(path, nil, nil)
}

func (c *Client) CreateMilestone(req CreateMilestoneRequest) (*Milestone, error) {
	var m Milestone
	if err := c.postJSON("/api/milestones", req, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

func (c *Client) UpdateMilestone(id int, req UpdateMilestoneRequest) (*Milestone, error) {
	var m Milestone
	if err := c.patchJSON(fmt.Sprintf("/api/milestones/%d", id), req, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

// DeleteMilestone moves a milestone to the recycle bin. mode is "cascade" (also
// bin the attached issues) or "detach"/"" (keep them, unlinked).
func (c *Client) DeleteMilestone(id int, mode string) error {
	path := fmt.Sprintf("/api/milestones/%d", id)
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
	var iss Issue
	if err := c.get(fmt.Sprintf("/api/issues/%d", id), &iss); err != nil {
		return nil, err
	}
	return &iss, nil
}

func (c *Client) CreateIssue(req CreateIssueRequest) (*Issue, error) {
	var iss Issue
	if err := c.postJSON("/api/issues", req, &iss); err != nil {
		return nil, err
	}
	return &iss, nil
}

func (c *Client) UpdateIssue(id int, req UpdateIssueRequest) (*Issue, error) {
	var iss Issue
	if err := c.patchJSON(fmt.Sprintf("/api/issues/%d", id), req, &iss); err != nil {
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
	var att Attachment
	if err := c.postJSON(fmt.Sprintf("/api/issues/%d/attachments", issueID), body, &att); err != nil {
		return nil, err
	}
	return &att, nil
}
