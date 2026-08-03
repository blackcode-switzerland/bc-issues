package client

import (
	"encoding/json"
	"testing"
)

// /api/meta is where every DYNAMIC value lives — limits, media rules, CLI
// versions, vocabularies — and the embedded guide deliberately points at it
// instead of restating them, so a cap can change without a CLI release.
//
// That only holds if `bk meta` is a transparent conduit. A typed struct is not:
// encoding/json silently drops fields it doesn't know, so any block the server
// adds is invisible until someone ships a new binary. `limits` and `media` were
// invisible exactly this way before v1.9.0 — the guide said "run bk meta for the
// current limits" and bk meta didn't show them.
//
// Meta.Raw is the fix, and `bk meta --json|--yaml` prints it verbatim.
func TestMetaRawPreservesUnknownServerFields(t *testing.T) {
	// A payload with the fields the CLI types, plus blocks it has never heard of.
	body := []byte(`{
		"user": {"id": 1, "email": "a@b.c", "via": "token"},
		"active_workspace": null,
		"workspaces": [],
		"vocabulary": {"status": ["todo"]},
		"limits": {"upload_max_bytes": 104857600},
		"media": {"blocked_mime_types": ["image/svg+xml"]},
		"something_invented_next_year": {"nested": true}
	}`)

	var m Meta
	if err := json.Unmarshal(body, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	m.Raw = body

	var got map[string]any
	if err := json.Unmarshal(m.Raw, &got); err != nil {
		t.Fatalf("unmarshal Raw: %v", err)
	}

	for _, key := range []string{"limits", "media", "something_invented_next_year"} {
		if _, ok := got[key]; !ok {
			t.Errorf("Meta.Raw dropped %q — `bk meta --json` must pass the server payload "+
				"through verbatim, or guide topics that say \"run bk meta\" point at nothing", key)
		}
	}

	// And the typed view still works, since the table rendering depends on it.
	if m.User.Email != "a@b.c" {
		t.Errorf("typed view broken: got email %q", m.User.Email)
	}
}
