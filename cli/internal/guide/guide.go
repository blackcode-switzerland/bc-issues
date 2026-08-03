// Package guide is the agent-facing usage guide, embedded in the binary.
//
// Why embedded and not fetched: the guide describes how THIS binary behaves —
// its flags, its exit codes, its workflows. A guide fetched from the server
// would describe whatever version the server knows about, which is worse than
// being out of date: it would tell an agent about a --flag it does not have.
//
// The companion rule: a topic must NEVER restate a value that can change without
// a CLI release (status vocabularies, size caps, the upload block list). Those
// live on the server and are fetched with `bk meta`. Static behaviour here,
// dynamic data there — that split is what keeps the two coherent.
//
// Topics are ordered by their numeric filename prefix, which is stripped to form
// the slug: `03-items.md` → slug `items`, title from the file's `# ` heading.
package guide

import (
	"embed"
	"fmt"
	"io/fs"
	"sort"
	"strings"
)

//go:embed topics/*.md
var topicFS embed.FS

// Topic is one guide section. Body is the Markdown with its `# Title` heading
// removed — the title is carried separately so a renderer can format it.
type Topic struct {
	Slug    string `json:"slug"`
	Title   string `json:"title"`
	Summary string `json:"summary"`
	Body    string `json:"body"`
}

var topics []Topic

func init() {
	entries, err := fs.ReadDir(topicFS, "topics")
	if err != nil {
		// Impossible unless the embed directive is broken, which is a build-time
		// problem, not a runtime one.
		panic("guide: cannot read embedded topics: " + err.Error())
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".md") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names) // numeric prefixes give a stable reading order

	for _, name := range names {
		raw, err := topicFS.ReadFile("topics/" + name)
		if err != nil {
			panic("guide: cannot read " + name + ": " + err.Error())
		}
		topics = append(topics, parseTopic(name, string(raw)))
	}
}

// slugFor turns "03-items.md" into "items".
func slugFor(filename string) string {
	base := strings.TrimSuffix(filename, ".md")
	if i := strings.Index(base, "-"); i >= 0 && isAllDigits(base[:i]) {
		base = base[i+1:]
	}
	return base
}

func isAllDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func parseTopic(filename, raw string) Topic {
	t := Topic{Slug: slugFor(filename), Body: strings.TrimSpace(raw)}

	lines := strings.Split(t.Body, "\n")
	if len(lines) > 0 && strings.HasPrefix(lines[0], "# ") {
		t.Title = strings.TrimSpace(strings.TrimPrefix(lines[0], "# "))
		t.Body = strings.TrimSpace(strings.Join(lines[1:], "\n"))
	} else {
		t.Title = t.Slug
	}

	// Summary: the first line of real prose in the body, trimmed to one sentence.
	// Used by `bk guide --list`. Headings, table rows, list bullets and anything
	// inside a fenced code block are skipped — a topic that opens with an example
	// would otherwise be summarised as "bash".
	inFence := false
	for _, l := range strings.Split(t.Body, "\n") {
		l = strings.TrimSpace(l)
		if strings.HasPrefix(l, "```") {
			inFence = !inFence
			continue
		}
		if inFence || l == "" ||
			strings.HasPrefix(l, "#") ||
			strings.HasPrefix(l, "|") ||
			strings.HasPrefix(l, "- ") ||
			strings.HasPrefix(l, "> ") {
			continue
		}
		t.Summary = firstSentence(stripInlineMarkdown(l))
		break
	}
	return t
}

func firstSentence(s string) string {
	if i := strings.Index(s, ". "); i >= 0 {
		return s[:i+1]
	}
	return s
}

// stripInlineMarkdown removes the emphasis/code markers that would otherwise
// clutter the one-line summaries in `bk guide --list`.
func stripInlineMarkdown(s string) string {
	r := strings.NewReplacer("**", "", "`", "", "*", "")
	return strings.TrimSpace(r.Replace(s))
}

// Topics returns every topic in reading order.
func Topics() []Topic {
	out := make([]Topic, len(topics))
	copy(out, topics)
	return out
}

// Slugs returns every topic slug in reading order.
func Slugs() []string {
	out := make([]string, 0, len(topics))
	for _, t := range topics {
		out = append(out, t.Slug)
	}
	return out
}

// Lookup finds a topic by slug. Matching is case-insensitive and tolerates the
// numeric prefix and the .md suffix, so `bk guide 05-files.md` works too.
func Lookup(slug string) (Topic, bool) {
	want := slugFor(strings.ToLower(strings.TrimSpace(slug)))
	for _, t := range topics {
		if t.Slug == want {
			return t, true
		}
	}
	return Topic{}, false
}

// Render returns the full guide as one document: a header stating the binary
// version, then every topic in order. This is what `bk guide` prints.
func Render(version string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# blackcode issues — agent guide (bk %s)\n\n", version)
	b.WriteString("The complete usage guide for THIS binary. It ships inside the\n")
	b.WriteString("executable, so it can never describe a version you are not running.\n\n")
	b.WriteString("Values that change without a CLI release — status/priority vocabularies,\n")
	b.WriteString("size limits, the upload block list — are deliberately NOT repeated here.\n")
	b.WriteString("Run `bk meta` for those.\n\n")
	b.WriteString("Topics: " + strings.Join(Slugs(), " · ") + "\n")

	for _, t := range topics {
		b.WriteString("\n" + strings.Repeat("─", 72) + "\n\n")
		fmt.Fprintf(&b, "# %s\n\n", t.Title)
		b.WriteString(t.Body + "\n")
	}
	return b.String()
}

// RenderTopic returns one topic as a printable document.
func RenderTopic(t Topic) string {
	return fmt.Sprintf("# %s\n\n%s\n", t.Title, t.Body)
}
