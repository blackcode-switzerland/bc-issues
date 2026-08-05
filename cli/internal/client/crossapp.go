package client

// Client methods for the cross-app primitives (Phase 6): federated search over
// platform.entities, typed links between URNs, and the reconciliation report.
//
// All three are workspace-scoped even though a URN already names its workspace.
// That is not redundancy for its own sake: the server decides which workspace the
// caller may act in, and treating the workspace segment of a caller-supplied
// string as an authorisation fact would be the one place a link could reach
// across tenants.

import (
	"fmt"
	"net/url"
	"strings"
)

type entityListEnvelope struct {
	Data []Entity `json:"data"`
}

type linkListEnvelope struct {
	Data []Link `json:"data"`
}

// SearchEntities runs a federated search across every app's entities in the
// active workspace. `apps` and `types` are optional filters; empty means all.
func (c *Client) SearchEntities(query string, apps, types []string, limit int, includeDeleted bool) ([]Entity, error) {
	q := url.Values{}
	q.Set("q", query)
	if len(apps) > 0 {
		q.Set("app", strings.Join(apps, ","))
	}
	if len(types) > 0 {
		q.Set("type", strings.Join(types, ","))
	}
	if limit > 0 {
		q.Set("limit", fmt.Sprint(limit))
	}
	if includeDeleted {
		q.Set("include_deleted", "1")
	}
	path, err := c.wsPath("search")
	if err != nil {
		return nil, err
	}
	var env entityListEnvelope
	if err := c.get(path+"?"+q.Encode(), &env); err != nil {
		return nil, err
	}
	return env.Data, nil
}

// ListLinks returns every link touching `urn`, in both directions.
func (c *Client) ListLinks(urn string) ([]Link, error) {
	q := url.Values{}
	q.Set("urn", urn)
	path, err := c.wsPath("links")
	if err != nil {
		return nil, err
	}
	var env linkListEnvelope
	if err := c.get(path+"?"+q.Encode(), &env); err != nil {
		return nil, err
	}
	return env.Data, nil
}

// CreateLink relates two URNs. Idempotent: the response says whether a row was
// actually inserted, and creating the same link twice is a success either way.
func (c *Client) CreateLink(from, to, rel string) (*CreateLinkResponse, error) {
	path, err := c.wsPath("links")
	if err != nil {
		return nil, err
	}
	var out CreateLinkResponse
	if err := c.postJSON(path, CreateLinkRequest{From: from, To: to, Rel: rel}, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// DeleteLink removes one directed relation. All three components identify it.
func (c *Client) DeleteLink(from, to, rel string) error {
	q := url.Values{}
	q.Set("from", from)
	q.Set("to", to)
	q.Set("rel", rel)
	path, err := c.wsPath("links")
	if err != nil {
		return err
	}
	return c.deleteJSON(path+"?"+q.Encode(), nil, nil)
}

// EntityDrift runs the reconciliation job. `repair` switches it from a read-only
// report to a repair — which, as the route's own comment says, should be read as
// a bug report rather than routine maintenance.
func (c *Client) EntityDrift(ws string, repair bool) (*EntityDriftReport, error) {
	q := url.Values{}
	if ws != "" {
		q.Set("ws", ws)
	}
	path := "/api/super-admin/entity-drift"
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	var out EntityDriftReport
	if repair {
		if err := c.postJSON(path, nil, &out); err != nil {
			return nil, err
		}
		return &out, nil
	}
	if err := c.get(path, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
