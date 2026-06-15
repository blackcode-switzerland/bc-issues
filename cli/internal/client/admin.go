package client

import (
	"encoding/json"
	"fmt"
	"net/url"
)

// Super-admin client methods. These hit /api/super-admin/* which the server
// gates behind requireSuperAdminUser — so a non-super-admin token gets a 403
// (mapped to exit code 4). The whitelist + errors changes here apply
// platform-wide, across every workspace.

// ---------- platform users ----------

type PlatformUser struct {
	ID             int     `json:"id" yaml:"id"`
	Name           *string `json:"name" yaml:"name"`
	Email          string  `json:"email" yaml:"email"`
	AvatarURL      *string `json:"avatar_url" yaml:"avatar_url"`
	CreatedAt      *string `json:"created_at" yaml:"created_at"`
	LastLogin      *string `json:"last_login" yaml:"last_login"`
	WorkspaceCount int     `json:"workspace_count" yaml:"workspace_count"`
}

func (c *Client) ListPlatformUsers() ([]PlatformUser, error) {
	var resp struct {
		Data []PlatformUser `json:"data"`
	}
	if err := c.get("/api/super-admin/users", &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

// ---------- access whitelist ----------

type WhitelistEntry struct {
	ID        int    `json:"id" yaml:"id"`
	Type      string `json:"type" yaml:"type"`
	Value     string `json:"value" yaml:"value"`
	AddedBy   *int   `json:"added_by" yaml:"added_by"`
	CreatedAt string `json:"created_at" yaml:"created_at"`
}

func (c *Client) ListWhitelist() ([]WhitelistEntry, error) {
	var resp struct {
		Data []WhitelistEntry `json:"data"`
	}
	if err := c.get("/api/super-admin/whitelist", &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

// AddWhitelistEntry adds a domain or email to the platform whitelist. The
// server returns the created entry (201) or, when the value already exists, a
// message (200). Exactly one of (entry, message) is meaningful.
func (c *Client) AddWhitelistEntry(typ, value string) (*WhitelistEntry, string, error) {
	body := map[string]string{"type": typ, "value": value}
	var resp struct {
		Entry   *WhitelistEntry `json:"entry"`
		Message string          `json:"message"`
	}
	if err := c.postJSON("/api/super-admin/whitelist", body, &resp); err != nil {
		return nil, "", err
	}
	return resp.Entry, resp.Message, nil
}

func (c *Client) RemoveWhitelistEntry(id int) error {
	return c.deleteJSON(fmt.Sprintf("/api/super-admin/whitelist/%d", id), nil, nil)
}

// ---------- error logs ----------

type ErrorEventStats struct {
	Total      int `json:"total" yaml:"total"`
	Resolved   int `json:"resolved" yaml:"resolved"`
	Unresolved int `json:"unresolved" yaml:"unresolved"`
}

type AdminErrorRow struct {
	ID         int     `json:"id" yaml:"id"`
	Level      string  `json:"level" yaml:"level"`
	Code       *string `json:"code" yaml:"code"`
	Message    string  `json:"message" yaml:"message"`
	Route      *string `json:"route" yaml:"route"`
	Method     *string `json:"method" yaml:"method"`
	StatusCode *int    `json:"status_code" yaml:"status_code"`
	UserID     *int    `json:"user_id" yaml:"user_id"`
	Resolved   bool    `json:"resolved" yaml:"resolved"`
	ResolvedAt *string `json:"resolved_at" yaml:"resolved_at"`
	OccurredAt string  `json:"occurred_at" yaml:"occurred_at"`
}

type AdminErrorsPage struct {
	Data       []AdminErrorRow  `json:"data" yaml:"data"`
	NextCursor *int             `json:"next_cursor" yaml:"next_cursor"`
	Stats      *ErrorEventStats `json:"stats,omitempty" yaml:"stats,omitempty"`
}

// ErrorEventDetail is the full row, including stack + context, returned by the
// detail and PATCH endpoints.
type ErrorEventDetail struct {
	ID          int             `json:"id" yaml:"id"`
	WorkspaceID *int            `json:"workspace_id" yaml:"workspace_id"`
	UserID      *int            `json:"user_id" yaml:"user_id"`
	Level       string          `json:"level" yaml:"level"`
	Code        *string         `json:"code" yaml:"code"`
	Message     string          `json:"message" yaml:"message"`
	Stack       *string         `json:"stack" yaml:"stack"`
	Route       *string         `json:"route" yaml:"route"`
	Method      *string         `json:"method" yaml:"method"`
	StatusCode  *int            `json:"status_code" yaml:"status_code"`
	Context     json.RawMessage `json:"context" yaml:"-"`
	Resolved    bool            `json:"resolved" yaml:"resolved"`
	ResolvedAt  *string         `json:"resolved_at" yaml:"resolved_at"`
	ResolvedBy  *int            `json:"resolved_by" yaml:"resolved_by"`
	OccurredAt  string          `json:"occurred_at" yaml:"occurred_at"`
}

type AdminErrorsOpts struct {
	Level  string
	Status string // "open" | "resolved" | "" (both)
	From   string
	To     string
	Limit  int
	Cursor *int
	Stats  bool
}

func (c *Client) ListAdminErrors(opts AdminErrorsOpts) (*AdminErrorsPage, error) {
	q := url.Values{}
	if opts.Level != "" {
		q.Set("level", opts.Level)
	}
	if opts.Status != "" {
		q.Set("status", opts.Status)
	}
	if opts.From != "" {
		q.Set("from", opts.From)
	}
	if opts.To != "" {
		q.Set("to", opts.To)
	}
	if opts.Limit > 0 {
		q.Set("limit", fmt.Sprint(opts.Limit))
	}
	if opts.Cursor != nil {
		q.Set("cursor", fmt.Sprint(*opts.Cursor))
	}
	if opts.Stats {
		q.Set("stats", "1")
	}
	path := "/api/super-admin/errors"
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	var page AdminErrorsPage
	if err := c.get(path, &page); err != nil {
		return nil, err
	}
	return &page, nil
}

func (c *Client) GetAdminError(id int) (*ErrorEventDetail, error) {
	var resp struct {
		Data ErrorEventDetail `json:"data"`
	}
	if err := c.get(fmt.Sprintf("/api/super-admin/errors/%d", id), &resp); err != nil {
		return nil, err
	}
	return &resp.Data, nil
}

func (c *Client) SetErrorResolved(id int, resolved bool) (*ErrorEventDetail, error) {
	var resp struct {
		Data ErrorEventDetail `json:"data"`
	}
	if err := c.patchJSON(
		fmt.Sprintf("/api/super-admin/errors/%d", id),
		map[string]bool{"resolved": resolved},
		&resp,
	); err != nil {
		return nil, err
	}
	return &resp.Data, nil
}

func (c *Client) DeleteAdminError(id int) error {
	return c.deleteJSON(fmt.Sprintf("/api/super-admin/errors/%d", id), nil, nil)
}

// DeleteAdminErrors bulk-deletes by id and returns the count removed.
func (c *Client) DeleteAdminErrors(ids []int) (int, error) {
	var resp struct {
		Deleted int `json:"deleted"`
	}
	if err := c.deleteJSON("/api/super-admin/errors", map[string]any{"ids": ids}, &resp); err != nil {
		return 0, err
	}
	return resp.Deleted, nil
}
