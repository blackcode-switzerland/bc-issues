package commands

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
)

// mdRefRe matches a Markdown image or link: ![alt](target) or [text](target).
// The target is either angle-bracketed — `(<...>)`, required for paths that
// contain spaces or parentheses (e.g. "song (remix).mp3") — or bare, captured up
// to the first ")". Groups: 1=bang, 2=label, 3=angle target, 4=bare target.
var mdRefRe = regexp.MustCompile(`(!?)\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^)]+?))\s*\)`)

// urlSchemeRe detects an absolute URL / data / mailto / anchor target — anything
// we must NOT treat as a local file path.
var urlSchemeRe = regexp.MustCompile(`^([a-z][a-z0-9+.-]*://|mailto:|data:|#)`)

// resolveBodyMedia uploads files referenced by LOCAL path inside a Markdown body
// and rewrites those references to the uploaded URL, so a description/comment can
// embed local files directly — e.g.
//
//	## Demo
//	![](./screenshot.png)
//	[](/abs/path/clip.mp4)
//
// becomes the same Markdown with the local paths replaced by upload URLs (which
// the server then renders inline: image preview, video/audio player, file card).
// A reference is only rewritten when its target has no URL scheme AND resolves to
// an existing file on disk; everything else is left untouched. When the label is
// empty, it is filled from the filename (with Markdown-significant characters
// escaped, so names with underscores aren't mangled into italics). Each distinct
// path is uploaded once. Progress is printed to stderr to keep stdout clean.
func resolveBodyMedia(c *client.Client, body string) (string, error) {
	if !strings.Contains(body, "](") {
		return body, nil
	}
	cache := map[string]*client.UploadResponse{}
	var firstErr error

	out := mdRefRe.ReplaceAllStringFunc(body, func(match string) string {
		if firstErr != nil {
			return match
		}
		m := mdRefRe.FindStringSubmatch(match)
		bang, label := m[1], m[2]
		target := strings.TrimSpace(m[3]) // angle-bracketed
		if target == "" {
			target = strings.TrimSpace(m[4]) // bare
		}

		if urlSchemeRe.MatchString(target) {
			return match
		}
		path := expandLocalPath(target)
		info, err := os.Stat(path)
		if err != nil || info.IsDir() {
			return match // not a local file — leave the reference as written
		}

		up := cache[path]
		if up == nil {
			up, err = c.UploadFile(path)
			if err != nil {
				firstErr = fmt.Errorf("upload %s: %w", target, err)
				return match
			}
			cache[path] = up
			fmt.Fprintf(os.Stderr, "uploaded %s -> %s\n", up.Filename, up.URL)
		}

		text := label
		if strings.TrimSpace(text) == "" {
			text = up.Filename
		}
		return bang + "[" + escapeMarkdownText(text) + "](" + up.URL + ")"
	})
	return out, firstErr
}

// expandLocalPath expands a leading ~ and returns an absolute-ish path suitable
// for os.Stat. Relative paths resolve against the current working directory.
func expandLocalPath(p string) string {
	if p == "~" || strings.HasPrefix(p, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, strings.TrimPrefix(p, "~"))
		}
	}
	return p
}

// escapeMarkdownText backslash-escapes the characters Markdown would otherwise
// interpret as formatting inside link text (so a filename like
// "a_b_c.mp3" keeps its underscores instead of turning into italics).
func escapeMarkdownText(s string) string {
	r := strings.NewReplacer(
		`\`, `\\`,
		"`", "\\`",
		"*", `\*`,
		"_", `\_`,
		"[", `\[`,
		"]", `\]`,
		"~", `\~`,
	)
	return r.Replace(s)
}
