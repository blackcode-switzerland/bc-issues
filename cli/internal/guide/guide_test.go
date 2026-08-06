package guide

import (
	"regexp"
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
// Values that live in lib/work-items.ts, lib/limits.ts or lib/upload.ts and can
// change without a CLI release.
//
// WIDENED 2026-08-06, after watching the previous version NOT fire. It was a
// substring match over six hand-written strings, and a topic containing the
// ENTIRE issue status vocabulary, the ENTIRE priority vocabulary and a stale
// "50 MB" limit passed every section. Three separate holes, each worth naming
// because each needs a different kind of rule:
//
//  1. The two most-restated vocabularies — issue statuses and priorities — were
//     simply absent from the list.
//  2. The list banned "100MB", the CORRECT spelling of the limit. A topic that
//     had gone stale and said "50 MB" was the one case it could not catch, which
//     is backwards: a wrong number is worse than a right one. Sizes are matched
//     by SHAPE now, not by value.
//  3. Bare status words ("done", "todo") cannot be banned outright — they are
//     ordinary English and appear all over the guide as prose. So membership is
//     counted instead: three or more of one vocabulary in a single topic is a
//     restatement, not a sentence.
//
// CALIBRATED in the same change, after the first version failed the REAL topics
// and both hits were legitimate. The distinction that matters is ENUMERATING a
// vocabulary versus ILLUSTRATING a command:
//
//   - `bk issues issue edit 42 --status in_progress` is a worked example. An
//     example has to name some value to be worth reading, and this one teaches
//     flag shape, not the status set. Banning it buys nothing and costs every
//     runnable example in the guide.
//   - "the CLI also accepts the friendly words `urgent|high|medium|low|none`"
//     is STATIC behaviour of this binary's flag parser — precisely what the
//     guide is for — and that passage already ends "Do not hardcode either —
//     `bk meta` is authoritative."
//
// So a vocabulary enumeration is only a finding when the topic does NOT send the
// reader to `bk meta`. A guard that fails on correct writing gets weakened or
// deleted, and then it protects nothing at all.
var (
	// Distinctive machine values. Safe as substrings — none is ordinary prose,
	// and none is a plausible value to show in a worked example.
	bannedLiterals = []string{
		"on_track", "at_risk", "off_track", // project_update_health
		"image/svg+xml", // media.blocked_mime_types
	}

	// Any size limit, right or wrong: `100MB`, `50 MB`, `100 mb`.
	bannedSizeShape = regexp.MustCompile(`(?i)\b\d+\s?[MG]B\b`)

	// Counted, not banned. Three of one set in a topic = a restated vocabulary.
	countedVocabularies = map[string][]string{
		"issue statuses":   {"backlog", "todo", "in_progress", "done", "cancelled"},
		"issue priorities": {"urgent", "high", "medium", "low", "no priority"},
	}
)

func TestTopicsDoNotHardcodeDynamicValues(t *testing.T) {
	for _, section := range Sections() {
		t.Run(section, func(t *testing.T) {
			topics := TopicsIn(section)
			if len(topics) == 0 {
				t.Fatalf("section %q has no topics", section)
			}
			for _, top := range topics {
				body := strings.ToLower(top.Body)

				for _, b := range bannedLiterals {
					if strings.Contains(body, strings.ToLower(b)) {
						t.Errorf("topic %q hardcodes %q — point at `bk meta` instead", top.Slug, b)
					}
				}

				if m := bannedSizeShape.FindString(top.Body); m != "" {
					t.Errorf("topic %q hardcodes the size limit %q — it is served by `bk meta` "+
						"(limits.upload_max_label) and changes without a CLI release", top.Slug, m)
				}

				// An enumeration is a finding unless `bk meta` is RIGHT THERE.
				//
				// The escape was topic-wide for one draft, and that made this
				// branch inert: every topic worth writing mentions `bk meta`
				// somewhere, so a bare enumeration anywhere else in the file got
				// a permanent free pass. Caught by injecting the enumeration and
				// watching it stay green. The window is the line plus its
				// neighbours, which is what the real `issues/items` passage
				// looks like — the values on one line, "`bk meta` is
				// authoritative" on the next.
				lines := strings.Split(body, "\n")
				for name, vocab := range countedVocabularies {
					for i, line := range lines {
						var hits []string
						for _, v := range vocab {
							if strings.Contains(line, v) {
								hits = append(hits, v)
							}
						}
						if len(hits) < 3 {
							continue
						}
						near := strings.Join(lines[max(0, i-1):min(len(lines), i+2)], "\n")
						if strings.Contains(near, "bk meta") {
							continue
						}
						t.Errorf("topic %q line %d restates the %s vocabulary (%s) with no "+
							"`bk meta` pointer beside it — say \"run `bk meta` for the current "+
							"values\" instead", top.Slug, i+1, name, strings.Join(hits, ", "))
					}
				}
			}
		})
	}
}

// docs/platform-architecture.md §7.2: a topic under topics/<app>/ may not describe
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
