// Client methods for the scaffold app. One list, one create — the minimum a new
// app's client layer needs, and the shape to copy.
package client

import "fmt"

// TemplateNote mirrors the route's public shape. Note `Number`, not `ID`: the
// workspace #number is the address, and a row id must never reach a client.
type TemplateNote struct {
	Number    int     `json:"number" yaml:"number"`
	Title     string  `json:"title" yaml:"title"`
	Body      *string `json:"body" yaml:"body"`
	CreatedAt string  `json:"created_at" yaml:"created_at"`
}

type CreateTemplateNoteRequest struct {
	Title string `json:"title"`
	Body  string `json:"body,omitempty"`
}

// ListTemplateNotes unwraps the `{ data, next_cursor }` envelope every list
// route serves.
func (c *Client) ListTemplateNotes(slugOrID string, limit int) ([]TemplateNote, error) {
	path := fmt.Sprintf("/api/workspaces/%s/notes", slugOrID)
	if limit > 0 {
		path += fmt.Sprintf("?limit=%d", limit)
	}
	var resp struct {
		Data []TemplateNote `json:"data"`
	}
	if err := c.get(path, &resp); err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func (c *Client) CreateTemplateNote(slugOrID string, req CreateTemplateNoteRequest) (*TemplateNote, error) {
	var out TemplateNote
	if err := c.postJSON(fmt.Sprintf("/api/workspaces/%s/notes", slugOrID), req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
