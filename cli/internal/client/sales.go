// Client methods for the sales app — the wire types and the calls behind
// `bk sales …`.
//
// ---------------------------------------------------------------------------
// `Number`, NEVER `ID`
// ---------------------------------------------------------------------------
// Every sales entity is addressed by its workspace #number. The serial row id is
// not served by any route and must not appear in a struct here: once it reaches
// a caller it ends up in a script, and then it is a contract nobody agreed to.
//
// ---------------------------------------------------------------------------
// MONEY AND DATES ARRIVE AS STRINGS, ON PURPOSE
// ---------------------------------------------------------------------------
// `Value` is `numeric(14,2)` and arrives as `"24000.00"`. Decoding it into a
// float64 would round it, silently, in a CRM — and no consumer of this CLI does
// arithmetic on a deal value. `NextAction.Due` is a Postgres `date`
// (`"2026-08-11"`), not an instant: parsing it into a time.Time would make it
// midnight in some timezone, and a due date has no time of day.
package client

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// SalesLabel is a `platform.labels` row attached to a prospect, app-scoped to
// sales (D-14).
type SalesLabel struct {
	ID    int    `json:"id" yaml:"id"`
	Name  string `json:"name" yaml:"name"`
	Color string `json:"color" yaml:"color"`
}

// SalesOwner is the deal owner — a real platform user. Unlike the actor labels
// elsewhere in this app, this is never an agent: an agent can log a call and
// write history, it cannot own a deal.
type SalesOwner struct {
	ID    int    `json:"id" yaml:"id"`
	Name  string `json:"name" yaml:"name"`
	Email string `json:"email" yaml:"email"`
}

// SalesNextAction is what the owner owes this prospect next.
//
// `Due` is the resolved date and `DueLabel` is the phrase the agent actually
// wrote ("this week"). The label is displayed in preference to the date and
// never parsed — the difference between "due Friday" and "sometime this week,
// Friday is my guess" is exactly what a human needs when the follow-up is late.
type SalesNextAction struct {
	Type     string `json:"type" yaml:"type"`
	Due      string `json:"due" yaml:"due"`
	DueLabel string `json:"due_label" yaml:"due_label"`
	Note     string `json:"note" yaml:"note"`
	Owner    string `json:"owner" yaml:"owner"`
}

// SalesJourneyStep is one rung of the deal ladder, including the ones not
// reached yet (`status: upcoming`, with no date and no actor).
type SalesJourneyStep struct {
	Stage      string `json:"stage" yaml:"stage"`
	Status     string `json:"status" yaml:"status"`
	OccurredAt string `json:"occurred_at" yaml:"occurred_at"`
	Actor      string `json:"actor" yaml:"actor"`
	Note       string `json:"note" yaml:"note"`
}

// SalesLink is a cross-app link touching this prospect (D-18). `URL` is
// absolute, built from the other app's registered base_url — a link the caller
// cannot follow to the other deployment is a link that only exists in a table.
type SalesLink struct {
	Direction  string `json:"direction" yaml:"direction"`
	Rel        string `json:"rel" yaml:"rel"`
	URN        string `json:"urn" yaml:"urn"`
	App        string `json:"app" yaml:"app"`
	EntityType string `json:"entity_type" yaml:"entity_type"`
	Number     int    `json:"number" yaml:"number"`
	Title      string `json:"title" yaml:"title"`
	URL        string `json:"url" yaml:"url"`
	Deleted    bool   `json:"deleted" yaml:"deleted"`
}

// Prospect is the core object: the company AND the deal in one row (D-5).
type Prospect struct {
	Number       int             `json:"number" yaml:"number"`
	Name         string          `json:"name" yaml:"name"`
	City         string          `json:"city" yaml:"city"`
	Sector       string          `json:"sector" yaml:"sector"`
	Stage        string          `json:"stage" yaml:"stage"`
	Value        string          `json:"value" yaml:"value"`
	Currency     string          `json:"currency" yaml:"currency"`
	Owner        *SalesOwner     `json:"owner" yaml:"owner"`
	Source       string          `json:"source" yaml:"source"`
	Summary      string          `json:"summary" yaml:"summary"`
	NextAction   SalesNextAction `json:"next_action" yaml:"next_action"`
	ClosedAt     string          `json:"closed_at" yaml:"closed_at"`
	ClosedReason string          `json:"closed_reason" yaml:"closed_reason"`
	Labels       []SalesLabel    `json:"labels" yaml:"labels"`
	URN          string          `json:"urn" yaml:"urn"`
	CreatedAt    string          `json:"created_at" yaml:"created_at"`
	UpdatedAt    string          `json:"updated_at" yaml:"updated_at"`
	DeletedAt    string          `json:"deleted_at" yaml:"deleted_at"`

	// Served by the single-prospect route only; empty on a listing.
	Journey []SalesJourneyStep `json:"journey,omitempty" yaml:"journey,omitempty"`
	Links   []SalesLink        `json:"links,omitempty" yaml:"links,omitempty"`
}

// SalesDeleted is what an irreversible sales command prints: WHAT was destroyed,
// captured by the server before the delete. A count alone is the difference
// between a mistake caught in a minute and one found in a month.
type SalesDeleted struct {
	Deleted bool   `json:"deleted" yaml:"deleted"`
	Type    string `json:"type" yaml:"type"`
	Number  int    `json:"number" yaml:"number"`
	Name    string `json:"name" yaml:"name"`
}

// ListProspectsOpts mirrors `bk sales prospect list`'s flags. Zero values mean
// "no filter", so an empty struct is the whole workspace.
type ListProspectsOpts struct {
	Stages         []string
	Owner          string // an email, or the literal "me"
	Label          string
	Query          string
	Limit          int
	Cursor         int
	IncludeDeleted bool
}

// ProspectsPage is the `{ data, next_cursor }` envelope every list route serves.
type ProspectsPage struct {
	Data       []Prospect `json:"data" yaml:"data"`
	NextCursor *int       `json:"next_cursor" yaml:"next_cursor"`
}

func (c *Client) ListProspects(slugOrID string, opts ListProspectsOpts) (*ProspectsPage, error) {
	q := url.Values{}
	if len(opts.Stages) > 0 {
		q.Set("stage", strings.Join(opts.Stages, ","))
	}
	if s := strings.TrimSpace(opts.Owner); s != "" {
		q.Set("owner", s)
	}
	if s := strings.TrimSpace(opts.Label); s != "" {
		q.Set("label", s)
	}
	if s := strings.TrimSpace(opts.Query); s != "" {
		q.Set("q", s)
	}
	if opts.Limit > 0 {
		q.Set("limit", strconv.Itoa(opts.Limit))
	}
	if opts.Cursor > 0 {
		q.Set("cursor", strconv.Itoa(opts.Cursor))
	}
	if opts.IncludeDeleted {
		q.Set("include_deleted", "true")
	}

	path := salesPath(slugOrID, "prospects")
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	var page ProspectsPage
	if err := c.get(path, &page); err != nil {
		return nil, err
	}
	return &page, nil
}

func (c *Client) GetProspect(slugOrID string, number int) (*Prospect, error) {
	var p Prospect
	if err := c.get(salesPath(slugOrID, fmt.Sprintf("prospects/%d", number)), &p); err != nil {
		return nil, err
	}
	return &p, nil
}

// CreateProspectRequest is the POST body. Every field is `omitempty` so an unset
// flag is ABSENT rather than an empty string — the route distinguishes the two,
// and sending `""` for a city would store an empty city.
type CreateProspectRequest struct {
	Name     string `json:"name"`
	City     string `json:"city,omitempty"`
	Sector   string `json:"sector,omitempty"`
	Stage    string `json:"stage,omitempty"`
	Value    string `json:"value,omitempty"`
	Currency string `json:"currency,omitempty"`
	Owner    string `json:"owner,omitempty"`
	Source   string `json:"source,omitempty"`
	Summary  string `json:"summary,omitempty"`
}

func (c *Client) CreateProspect(slugOrID string, req CreateProspectRequest) (*Prospect, error) {
	var p Prospect
	if err := c.postJSON(salesPath(slugOrID, "prospects"), req, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

// NullString is a PATCH field that can be CLEARED.
//
// A PATCH has three states per field and a plain `string` can only express two.
// `nil` (the field omitted) means "leave it alone"; a pointer to "" marshals to
// JSON `null`, which the route reads as "clear it"; anything else is the new
// value. Without the third state there is no way to remove a city or unassign
// an owner, and the symptom is a flag that appears to do nothing.
//
// `omitempty` on a POINTER omits only when the pointer is nil — which is
// exactly the "absent" case — so the empty string still reaches MarshalJSON.
// This does not work with a plain `*string`: `omitempty` would keep it, and it
// would marshal to `""`, which the route's `str()` treats as absent.
type NullString string

func (n NullString) MarshalJSON() ([]byte, error) {
	if n == "" {
		return []byte("null"), nil
	}
	return json.Marshal(string(n))
}

// Clear is the explicit "remove this field" value, spelled so a call site reads
// as an intention rather than as an empty string somebody forgot to fill in.
func Clear() *NullString { return Set("") }

// Set wraps a value for a PATCH field.
func Set(v string) *NullString { n := NullString(v); return &n }

// UpdateProspectRequest is the PATCH body. See NullString for the three states.
type UpdateProspectRequest struct {
	Name     *NullString `json:"name,omitempty"`
	City     *NullString `json:"city,omitempty"`
	Sector   *NullString `json:"sector,omitempty"`
	Value    *NullString `json:"value,omitempty"`
	Currency *NullString `json:"currency,omitempty"`
	Owner    *NullString `json:"owner,omitempty"`
	Source   *NullString `json:"source,omitempty"`
	Summary  *NullString `json:"summary,omitempty"`
}

func (c *Client) UpdateProspect(slugOrID string, number int, req UpdateProspectRequest) (*Prospect, error) {
	var p Prospect
	path := salesPath(slugOrID, fmt.Sprintf("prospects/%d", number))
	if err := c.patchJSON(path, req, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

// SetProspectStageRequest moves a deal. `Reason` is only read for a terminal
// stage; `Note` becomes the journey step's note either way.
type SetProspectStageRequest struct {
	Stage  string `json:"stage"`
	Note   string `json:"note,omitempty"`
	Reason string `json:"reason,omitempty"`
}

func (c *Client) SetProspectStage(slugOrID string, number int, req SetProspectStageRequest) (*Prospect, error) {
	var p Prospect
	path := salesPath(slugOrID, fmt.Sprintf("prospects/%d/stage", number))
	if err := c.postJSON(path, req, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

// DeleteProspect bins a prospect. `confirm` must be the company's name and is
// checked BY THE SERVER — see the route's header. Sending it from here is not
// the guard; it is how the guard is satisfied.
func (c *Client) DeleteProspect(slugOrID string, number int, confirm string) (*SalesDeleted, error) {
	path := salesPath(slugOrID, fmt.Sprintf("prospects/%d", number)) +
		"?confirm=" + url.QueryEscape(confirm)
	var out SalesDeleted
	if err := c.deleteJSON(path, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// salesPath builds a workspace-scoped path for an explicitly named workspace.
//
// It does NOT use `c.wsPath`, which reads the client's cached active workspace:
// every sales command resolves the workspace itself (--ws, then the active one)
// and passes it in, so there is one place where "which workspace" is decided
// rather than two that can disagree.
func salesPath(slugOrID, suffix string) string {
	return "/api/workspaces/" + slugOrID + "/" + suffix
}
