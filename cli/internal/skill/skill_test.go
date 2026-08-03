package skill

import (
	"strings"
	"testing"
)

// The skill's one design rule: it contains NO facts that can rot. If someone
// adds a status value, a byte cap or an HTTP route to the template, a stale
// installed copy starts actively misleading agents instead of merely pointing
// at the right commands.
func TestTemplateContainsNoRottableFacts(t *testing.T) {
	banned := []string{
		"100MB", "on_track", "at_risk", "backlog", "in_progress",
		"/api/", "Bearer", "openapi", "P0", "P1",
	}
	for _, b := range banned {
		if strings.Contains(template, b) {
			t.Errorf("skill template mentions %q — it must only point at `bk guide` / `bk meta`", b)
		}
	}
	if n := len(strings.Split(strings.TrimSpace(template), "\n")); n > 40 {
		t.Errorf("skill template is %d lines; keep it ~30 — specifics belong behind `bk guide`", n)
	}
}

func TestRenderRoundTripsTheVersionStamp(t *testing.T) {
	out := Render("1.9.0")
	if got := StampedVersion(out); got != "1.9.0" {
		t.Errorf("StampedVersion(Render(1.9.0)) = %q, want 1.9.0", got)
	}
	if StampedVersion("no stamp here") != "" {
		t.Error("an unstamped file must report an empty version, not a false match")
	}
}

func TestUpsertAgentsSectionReplacesInPlace(t *testing.T) {
	doc := "# My project\n\nSome prose.\n"
	first := UpsertAgentsSection(doc, RenderAgentsSection("1.9.0"))
	if !strings.Contains(first, "My project") {
		t.Fatal("upsert dropped the host document")
	}
	second := UpsertAgentsSection(first, RenderAgentsSection("1.9.1"))
	if strings.Count(second, agentsBegin) != 1 {
		t.Errorf("re-running install duplicated the section (%d copies)", strings.Count(second, agentsBegin))
	}
	if !strings.Contains(second, "1.9.1") || strings.Contains(second, "bk 1.9.0 -->") {
		t.Error("re-running install did not update the version stamp in place")
	}
	// Headings must be demoted so the block nests under the host document.
	if strings.Contains(second, "\n# blackcode issues") {
		t.Error("the AGENTS.md section kept a top-level heading")
	}
}
