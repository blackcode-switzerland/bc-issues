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
		// Every slug carries its section. Two apps will both want `pitfalls`.
		if !strings.HasPrefix(top.Slug, top.Section+"/") {
			t.Errorf("topic %q is not qualified by its section %q", top.Slug, top.Section)
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
//
// Run per section, so the failure names which half of the guide rotted. An app
// section is the likelier offender: its topics are the ones sitting next to the
// vocabularies.
func TestTopicsDoNotHardcodeDynamicValues(t *testing.T) {
	// Values that live in lib/work-items.ts, lib/limits.ts or lib/upload.ts and
	// can change without a CLI release.
	banned := []string{"100MB", "100 MB", "on_track", "at_risk", "off_track", "image/svg+xml"}
	for _, section := range Sections() {
		t.Run(section, func(t *testing.T) {
			topics := TopicsIn(section)
			if len(topics) == 0 {
				t.Fatalf("section %q has no topics", section)
			}
			for _, top := range topics {
				for _, b := range banned {
					if strings.Contains(top.Body, b) {
						t.Errorf("topic %q hardcodes %q — point at `bk meta` instead", top.Slug, b)
					}
				}
			}
		})
	}
}

// PLATFORM-ARCHITECTURE.md §7.2: a topic under topics/<app>/ may not describe
// another app.
//
// With one app this cannot fail, and saying so is more useful than pretending
// otherwise — its job starts the day topics/sales/ exists, which is exactly when
// nobody will think to write it. It is here now because that is when it is free.
func TestAppTopicsDoNotDescribeAnotherApp(t *testing.T) {
	apps := AppSections()
	if len(apps) == 0 {
		t.Fatal("no app sections found — the guide split did not happen")
	}
	if len(apps) == 1 {
		t.Logf("only one app (%q): this check is structural until a second exists", apps[0])
	}

	for _, app := range apps {
		for _, top := range TopicsIn(app) {
			for _, other := range apps {
				if other == app {
					continue
				}
				// `bk sales …` in an issues topic, or the bare app name.
				for _, needle := range []string{"bk " + other + " ", other + "/"} {
					if strings.Contains(top.Body, needle) {
						t.Errorf("topic %q mentions the %q app (%q) — an app topic describes "+
							"its own app only; shared behaviour belongs in topics/platform/",
							top.Slug, other, needle)
					}
				}
			}
		}
	}
}

// The guide must not teach a spelling the CLI is deprecating. This one is NOT
// structural — it would have caught the whole guide as written before Phase 5,
// where every `bk issue create` example became wrong the moment the commands
// moved. A guide that teaches the deprecated form is worse than none: it is
// confidently wrong, and the agent has no reason to doubt it.
func TestTopicsUseNamespacedAppCommands(t *testing.T) {
	nouns := []string{"issue", "task", "project", "analytics", "move", "copy"}
	for _, top := range Topics() {
		for _, n := range nouns {
			for _, bad := range []string{"bk " + n + " ", "bk " + n + "|", "bk " + n + "\n", "bk " + n + "`"} {
				if strings.Contains(top.Body, bad) {
					t.Errorf("topic %q uses the pre-1.10.0 spelling %q — app verbs sit behind "+
						"their app name (`bk issues %s …`)", top.Slug, strings.TrimSpace(bad), n)
				}
			}
		}
	}
}

func TestLookup(t *testing.T) {
	// Qualified, and the tolerated variants.
	for _, in := range []string{
		"platform/files", "PLATFORM/FILES", "platform/04-files", "platform/04-files.md",
		"issues/items", "issues/pitfalls", "platform/pitfalls",
	} {
		if _, ok := Lookup(in); !ok {
			t.Errorf("Lookup(%q) failed", in)
		}
	}

	// Bare slugs still resolve while unique — every pre-1.10.0 skill says
	// `bk guide files`, and those must not break in the release that renames the
	// commands.
	for _, in := range []string{"files", "FILES", "items", "workspaces", "move-copy"} {
		got, ok := Lookup(in)
		if !ok {
			t.Errorf("Lookup(%q) failed; bare slugs must keep resolving while unambiguous", in)
			continue
		}
		if !strings.HasSuffix(got.Slug, "/"+strings.ToLower(in)) {
			t.Errorf("Lookup(%q) resolved to %q", in, got.Slug)
		}
	}

	// `pitfalls` exists in both platform/ and issues/, so the bare form is
	// ambiguous and must refuse — naming both candidates rather than guessing.
	if _, ok := Lookup("pitfalls"); ok {
		t.Error("Lookup(\"pitfalls\") resolved despite existing in two sections")
	}
	amb := Ambiguous("pitfalls")
	if len(amb) < 2 {
		t.Errorf("Ambiguous(\"pitfalls\") = %v; want both candidates named", amb)
	}

	if _, ok := Lookup("nope"); ok {
		t.Error("Lookup should reject an unknown slug")
	}
	if _, ok := Lookup("issues/nope"); ok {
		t.Error("Lookup should reject an unknown qualified slug")
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
	// Platform before any app: an agent reading top to bottom should learn what a
	// workspace is before it meets an app's nouns.
	for _, app := range AppSections() {
		p := strings.Index(out, "## PLATFORM")
		a := strings.Index(out, "## APP: "+app)
		if p < 0 || a < 0 {
			t.Fatalf("render is missing a section heading (platform=%d, %s=%d)", p, app, a)
		}
		if p > a {
			t.Errorf("app %q is rendered before the platform section", app)
		}
	}
}

func TestRenderSectionScopes(t *testing.T) {
	for _, section := range Sections() {
		t.Run(section, func(t *testing.T) {
			out := RenderSection("1.10.0", section)
			for _, top := range TopicsIn(section) {
				if !strings.Contains(out, top.Title) {
					t.Errorf("--app %s is missing its own topic %q", section, top.Slug)
				}
			}
			// And nothing from another section.
			for _, other := range Sections() {
				if other == section {
					continue
				}
				for _, top := range TopicsIn(other) {
					if strings.Contains(out, "# "+top.Title+"\n") {
						t.Errorf("--app %s leaked topic %q from section %q",
							section, top.Slug, other)
					}
				}
			}
		})
	}
}
