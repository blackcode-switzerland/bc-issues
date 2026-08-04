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
// Topics are grouped one directory per SECTION — `topics/platform/` for what is
// true of every app, `topics/<app>/` for one app's behaviour. The section is
// part of the slug and the numeric filename prefix is stripped to form the rest:
// `issues/00-items.md` → slug `issues/items`, title from the file's `# ` heading.
//
// Why the section is in the slug rather than inferred: every app will eventually
// have a topic called `items`, `pitfalls` or `output`. Qualifying them now, with
// one app, is a rename; qualifying them later is a migration with N callers and
// a collision to resolve first. Bare slugs still resolve while they are
// unambiguous — see Lookup.
package guide

import (
	"embed"
	"fmt"
	"io/fs"
	"path"
	"sort"
	"strings"
)

//go:embed topics/*/*.md
var topicFS embed.FS

// PlatformSection is the directory holding the topics that are true everywhere.
// Every other section directory is an app slug.
const PlatformSection = "platform"

// Topic is one guide section. Body is the Markdown with its `# Title` heading
// removed — the title is carried separately so a renderer can format it.
type Topic struct {
	// Slug is section-qualified: "platform/workspaces", "issues/items".
	Slug string `json:"slug"`
	// Section is "platform" or an app slug.
	Section string `json:"section"`
	Title   string `json:"title"`
	Summary string `json:"summary"`
	Body    string `json:"body"`
}

// IsPlatform reports whether the topic describes the platform rather than one
// app.
func (t Topic) IsPlatform() bool { return t.Section == PlatformSection }

var (
	topics   []Topic
	sections []string // platform first, then app sections alphabetically
)

func init() {
	dirs, err := fs.ReadDir(topicFS, "topics")
	if err != nil {
		// Impossible unless the embed directive is broken, which is a build-time
		// problem, not a runtime one.
		panic("guide: cannot read embedded topics: " + err.Error())
	}

	var appSections []string
	for _, d := range dirs {
		if !d.IsDir() {
			// The embed pattern only matches topics/*/*.md, so a stray file at
			// the top level is simply not embedded. Nothing to do.
			continue
		}
		if d.Name() == PlatformSection {
			continue
		}
		appSections = append(appSections, d.Name())
	}
	sort.Strings(appSections)
	sections = append([]string{PlatformSection}, appSections...)

	// Platform first, then each app: the reading order `bk guide` prints, and the
	// order an agent should learn things in — you cannot pick a workspace for an
	// app before you know what a workspace is.
	for _, sec := range sections {
		entries, err := fs.ReadDir(topicFS, "topics/"+sec)
		if err != nil {
			panic("guide: cannot read section " + sec + ": " + err.Error())
		}
		names := make([]string, 0, len(entries))
		for _, e := range entries {
			if !e.IsDir() && strings.HasSuffix(e.Name(), ".md") {
				names = append(names, e.Name())
			}
		}
		sort.Strings(names) // numeric prefixes give a stable reading order
		for _, name := range names {
			raw, err := topicFS.ReadFile("topics/" + sec + "/" + name)
			if err != nil {
				panic("guide: cannot read " + sec + "/" + name + ": " + err.Error())
			}
			topics = append(topics, parseTopic(sec, name, string(raw)))
		}
	}
}

// Sections returns every section in reading order: platform, then each app.
func Sections() []string {
	out := make([]string, len(sections))
	copy(out, sections)
	return out
}

// AppSections returns the app sections only.
func AppSections() []string {
	return Sections()[1:]
}

// slugFor turns "issues", "00-items.md" into "issues/items".
func slugFor(section, filename string) string {
	base := strings.TrimSuffix(filename, ".md")
	if i := strings.Index(base, "-"); i >= 0 && isAllDigits(base[:i]) {
		base = base[i+1:]
	}
	if section == "" {
		return base
	}
	return section + "/" + base
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

func parseTopic(section, filename, raw string) Topic {
	t := Topic{
		Slug:    slugFor(section, filename),
		Section: section,
		Body:    strings.TrimSpace(raw),
	}

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

// TopicsIn returns the topics of one section, in reading order. An unknown
// section yields nothing.
func TopicsIn(section string) []Topic {
	var out []Topic
	for _, t := range topics {
		if t.Section == section {
			out = append(out, t)
		}
	}
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

// Lookup finds a topic by slug.
//
// It accepts the qualified form (`platform/files`), and — while it stays
// unambiguous — the bare one (`files`). The bare form is not nostalgia: every
// agent skill and script written before 1.10.0 says `bk guide files`, and
// breaking those in the same release that renames the commands would mean an
// agent hitting the rename cannot read the topic explaining it. When two apps
// eventually both define `pitfalls`, the bare form starts failing WITH both
// candidates named, which is a better answer than silently picking one.
//
// Matching is case-insensitive and tolerates the numeric prefix and the .md
// suffix, so `bk guide platform/04-files.md` works too.
func Lookup(slug string) (Topic, bool) {
	raw := strings.Trim(strings.ToLower(strings.TrimSpace(slug)), "/")
	section, file := path.Split(raw)
	section = strings.TrimSuffix(section, "/")
	want := slugFor(section, file)

	if section != "" {
		for _, t := range topics {
			if t.Slug == want {
				return t, true
			}
		}
		return Topic{}, false
	}

	// Bare slug: unique match only.
	var found Topic
	n := 0
	for _, t := range topics {
		if strings.TrimPrefix(t.Slug, t.Section+"/") == want {
			found, n = t, n+1
		}
	}
	if n == 1 {
		return found, true
	}
	return Topic{}, false
}

// Ambiguous reports the qualified slugs a bare slug could mean, when it could
// mean more than one. The command layer uses it to name both candidates instead
// of just refusing.
func Ambiguous(slug string) []string {
	raw := strings.Trim(strings.ToLower(strings.TrimSpace(slug)), "/")
	if strings.Contains(raw, "/") {
		return nil
	}
	want := slugFor("", raw)
	var out []string
	for _, t := range topics {
		if strings.TrimPrefix(t.Slug, t.Section+"/") == want {
			out = append(out, t.Slug)
		}
	}
	if len(out) < 2 {
		return nil
	}
	return out
}

const header = "The complete usage guide for THIS binary. It ships inside the\n" +
	"executable, so it can never describe a version you are not running.\n\n" +
	"Values that change without a CLI release — status/priority vocabularies,\n" +
	"size limits, the upload block list — are deliberately NOT repeated here.\n" +
	"Run `bk meta` for those.\n\n"

// Render returns the full guide as one document: a header stating the binary
// version, then the platform topics, then each app under its own heading. This
// is what `bk guide` prints.
//
// Platform first is the point. An agent reading top to bottom learns what a
// workspace is, how output and exit codes work and how to stay current before it
// meets any app's nouns — and when a second app arrives, everything it already
// read still holds.
func Render(version string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# Blackcode platform — agent guide (bk %s)\n\n", version)
	b.WriteString(header)
	b.WriteString("Topics: " + strings.Join(Slugs(), " · ") + "\n")

	for _, sec := range sections {
		b.WriteString("\n" + strings.Repeat("═", 72) + "\n")
		if sec == PlatformSection {
			b.WriteString("\n## PLATFORM — true in every app\n")
		} else {
			fmt.Fprintf(&b, "\n## APP: %s\n", sec)
		}
		for _, t := range TopicsIn(sec) {
			b.WriteString("\n" + strings.Repeat("─", 72) + "\n\n")
			fmt.Fprintf(&b, "# %s\n\n", t.Title)
			b.WriteString(t.Body + "\n")
		}
	}
	return b.String()
}

// RenderSection returns one section as a document — `bk guide --app issues`, or
// `--app platform` for the shared half.
func RenderSection(version, section string) string {
	var b strings.Builder
	if section == PlatformSection {
		fmt.Fprintf(&b, "# Blackcode platform — agent guide (bk %s)\n\n", version)
	} else {
		fmt.Fprintf(&b, "# Blackcode %s — agent guide (bk %s)\n\n", section, version)
		b.WriteString("This is one app. Run `bk guide --app platform` for the workspace,\n")
		b.WriteString("output, file and staying-current topics that apply to every app.\n\n")
	}
	b.WriteString(header)

	secTopics := TopicsIn(section)
	slugs := make([]string, 0, len(secTopics))
	for _, t := range secTopics {
		slugs = append(slugs, t.Slug)
	}
	b.WriteString("Topics: " + strings.Join(slugs, " · ") + "\n")

	for _, t := range secTopics {
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
