package client

import "fmt"

// Per-app access (Phase 4). A workspace is the organisation; an app is a
// capability inside it. Membership puts you in the workspace, `app_access` lets
// you open an app there.
//
// These are PLATFORM calls, not issue-tracker calls: they answer "which apps does
// this org run and who may use them", which is the same question in every app.

type WorkspaceApp struct {
	Slug        string  `json:"slug" yaml:"slug"`
	Name        string  `json:"name" yaml:"name"`
	Description *string `json:"description" yaml:"description"`
	BaseURL     *string `json:"base_url" yaml:"base_url"`
	// Enabled platform-wide. A globally disabled app is off in every workspace.
	GloballyEnabled bool `json:"globally_enabled" yaml:"globally_enabled"`
	// Enabled for THIS workspace.
	Enabled bool `json:"enabled" yaml:"enabled"`
	// "all_members" | "invite_only"; nil when the app is not enabled here.
	DefaultAccess *string `json:"default_access" yaml:"default_access"`
	AccessCount   int     `json:"access_count" yaml:"access_count"`
}

type AppAccessMember struct {
	UserID     int     `json:"user_id" yaml:"user_id"`
	Email      string  `json:"email" yaml:"email"`
	Name       *string `json:"name" yaml:"name"`
	MemberRole string  `json:"member_role" yaml:"member_role"`
	HasAccess  bool    `json:"has_access" yaml:"has_access"`
	GrantedAt  *string `json:"granted_at" yaml:"granted_at"`
}

type UpdateWorkspaceAppRequest struct {
	Enabled       *bool   `json:"enabled,omitempty"`
	DefaultAccess *string `json:"default_access,omitempty"`
}

type WorkspaceAppState struct {
	App           string  `json:"app" yaml:"app"`
	Enabled       bool    `json:"enabled" yaml:"enabled"`
	DefaultAccess *string `json:"default_access" yaml:"default_access"`
}

func (c *Client) ListWorkspaceApps(slugOrID string) ([]WorkspaceApp, error) {
	var resp struct {
		Data []WorkspaceApp `json:"data"`
	}
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/apps", slugOrID), &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (c *Client) UpdateWorkspaceApp(slugOrID, app string, req UpdateWorkspaceAppRequest) (*WorkspaceAppState, error) {
	var state WorkspaceAppState
	if err := c.patchJSON(fmt.Sprintf("/api/workspaces/%s/apps/%s", slugOrID, app), req, &state); err != nil {
		return nil, err
	}
	return &state, nil
}

func (c *Client) ListAppAccess(slugOrID, app string) ([]AppAccessMember, error) {
	var resp struct {
		Data []AppAccessMember `json:"data"`
	}
	if err := c.get(fmt.Sprintf("/api/workspaces/%s/apps/%s/access", slugOrID, app), &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (c *Client) GrantAppAccess(slugOrID, app string, userID int) error {
	body := map[string]int{"user_id": userID}
	return c.postJSON(fmt.Sprintf("/api/workspaces/%s/apps/%s/access", slugOrID, app), body, nil)
}

func (c *Client) RevokeAppAccess(slugOrID, app string, userID int) error {
	return c.deleteJSON(
		fmt.Sprintf("/api/workspaces/%s/apps/%s/access/%d", slugOrID, app, userID),
		nil,
		nil,
	)
}

// ListAllMyWorkspaces is `?all=1`: every workspace you are a member of, whether
// or not this app is usable there, each carrying the apps you CAN reach in it.
//
// Without it, a workspace that this app is not enabled in simply vanishes from
// `bk workspace list` — and "where did my workspace go?" would have no answer
// from inside the app that hid it.
func (c *Client) ListAllMyWorkspaces() ([]WorkspaceWithApps, error) {
	var resp struct {
		Data []WorkspaceWithApps `json:"data"`
	}
	if err := c.get("/api/workspaces?all=1", &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

type WorkspaceWithApps struct {
	Workspace `yaml:",inline"`
	Apps      []string `json:"apps" yaml:"apps"`
}
