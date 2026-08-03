package guide

import (
	"strings"
	"testing"
)

// The guide's whole value is that it can't disagree with the binary. Two ways it
// could rot silently, both guarded here.

func TestTopicsParse(t *testing.T) {
	got := Topics()
	if len(got) < 10 {
		t.Fatalf("expected the full topic set, got %d", len(got))
	}
	seen := map[string]bool{}
	for _, top := range got {
		if top.Slug == "" || strings.Contains(top.Slug, ".md") {
			t.Errorf("bad slug %q", top.Slug)
		}
		if top.Title == "" || top.Title == top.Slug {
			t.Errorf("topic %q has no `# Title` heading", top.Slug)
		}
		if top.Summary == "" {
			t.Errorf("topic %q has no summary line", top.Slug)
		}
		// A summary lifted out of a fenced code block ("bash", "```") means the
		// extractor regressed.
		if top.Summary == "bash" || strings.HasPrefix(top.Summary, "```") {
			t.Errorf("topic %q summary came from a code fence: %q", top.Slug, top.Summary)
		}
		if seen[top.Slug] {
			t.Errorf("duplicate slug %q", top.Slug)
		}
		seen[top.Slug] = true
		if !strings.Contains(top.Body, "Related commands:") {
			t.Errorf("topic %q is missing its `Related commands:` line", top.Slug)
		}
	}
}

// Dynamic values must never be baked into a topic — that is the one rule that
// makes "embedded guide + live meta" coherent. If a topic hardcodes a status
// name or a byte cap, it will be wrong the first time we change it, and the
// agent has no way to tell.
func TestTopicsDoNotHardcodeDynamicValues(t *testing.T) {
	// Values that live in lib/work-items.ts, lib/limits.ts or lib/upload.ts and
	// can change without a CLI release.
	banned := []string{"100MB", "100 MB", "on_track", "at_risk", "off_track", "image/svg+xml"}
	for _, top := range Topics() {
		for _, b := range banned {
			if strings.Contains(top.Body, b) {
				t.Errorf("topic %q hardcodes %q — point at `bk meta` instead", top.Slug, b)
			}
		}
	}
}

func TestLookup(t *testing.T) {
	for _, in := range []string{"files", "FILES", "05-files", "05-files.md"} {
		if _, ok := Lookup(in); !ok {
			t.Errorf("Lookup(%q) failed", in)
		}
	}
	if _, ok := Lookup("nope"); ok {
		t.Error("Lookup should reject an unknown slug")
	}
}

func TestRenderIncludesEveryTopic(t *testing.T) {
	out := Render("1.9.0")
	if !strings.Contains(out, "bk 1.9.0") {
		t.Error("rendered guide does not state the binary version")
	}
	for _, top := range Topics() {
		if !strings.Contains(out, top.Title) {
			t.Errorf("rendered guide is missing topic %q", top.Slug)
		}
	}
}
