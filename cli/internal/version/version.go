// Package version holds the CLI build-stamp variables and semver helpers.
//
// It lives in its own package (rather than internal/commands) so that
// internal/client can read the running version without creating an import
// cycle (commands imports client, so client must not import commands).
package version

import "strings"

// Version, Commit, and BuildDate are overridden at build time by the
// Makefile via -ldflags "-X .../internal/version.Version=..." etc.
var (
	Version   = "dev"
	Commit    = ""
	BuildDate = ""
)

// Parsable reports whether v looks like a real semver string we can compare.
// It returns false for the empty string, the dev defaults ("dev", "(devel)"),
// and anything that does not start with a digit (e.g. "v1.2.0" with a leading
// "v" is still parsable once trimmed, but unknown junk is not). This lets the
// update logic stay silent on unknown/dev builds rather than nagging or
// blocking them.
func Parsable(v string) bool {
	v = strings.TrimPrefix(v, "v")
	if v == "" || v == "dev" || v == "(devel)" {
		return false
	}
	c := v[0]
	return c >= '0' && c <= '9'
}

// Less reports whether semver string a is strictly older than b.
//
// It strips a leading "v", drops any pre-release/build suffix after "-",
// splits on ".", and compares numeric components left to right. Missing
// components are treated as 0 (so "1.2" < "1.2.1"). If either input is not
// Parsable, it returns false — we never block or notify on unknown versions.
func Less(a, b string) bool {
	if !Parsable(a) || !Parsable(b) {
		return false
	}
	ai := components(a)
	bi := components(b)
	n := len(ai)
	if len(bi) > n {
		n = len(bi)
	}
	for i := 0; i < n; i++ {
		var av, bv int
		if i < len(ai) {
			av = ai[i]
		}
		if i < len(bi) {
			bv = bi[i]
		}
		if av != bv {
			return av < bv
		}
	}
	return false
}

// components parses "v1.2.3-beta.1" into [1, 2, 3]. Non-numeric leftovers in a
// component stop parsing of that component (atoi of a partial number).
func components(v string) []int {
	v = strings.TrimPrefix(v, "v")
	if i := strings.IndexByte(v, '-'); i >= 0 {
		v = v[:i]
	}
	parts := strings.Split(v, ".")
	out := make([]int, len(parts))
	for i, p := range parts {
		out[i] = atoi(p)
	}
	return out
}

// atoi parses the leading run of digits in s as an int (0 if none).
func atoi(s string) int {
	n := 0
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c < '0' || c > '9' {
			break
		}
		n = n*10 + int(c-'0')
	}
	return n
}
