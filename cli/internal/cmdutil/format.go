package cmdutil

import "fmt"

// Display formatting shared by every command package. These lived in issue.go
// until Phase 5 split the command tree by app — at which point `bk storage list`
// and `bk super-admin` (platform) were still calling helpers that had moved into
// the issues package, which is exactly the cross-app import §7.1 forbids.

// Truncate shortens s to at most n runes, marking the cut with an ellipsis. It
// counts runes, not bytes, so a multi-byte title is not sliced mid-character.
func Truncate(s string, n int) string {
	if len([]rune(s)) <= n {
		return s
	}
	r := []rune(s)
	return string(r[:n-1]) + "…"
}

// HumanSize is HumanBytes for an OPTIONAL byte count, rendering a missing one
// as an em dash. Two command packages format the same column — `bk storage list`
// (platform) and `bk issues attachment list` — so it lives here rather than in
// either of them.
func HumanSize(n *int) string {
	if n == nil {
		return "—"
	}
	return HumanBytes(*n)
}

// HumanBytes renders a byte count as B/KB/MB/… with one decimal place.
func HumanBytes(n int) string {
	const u = 1024
	if n < u {
		return fmt.Sprintf("%dB", n)
	}
	div, exp := int64(u), 0
	for x := int64(n) / u; x >= u; x /= u {
		div *= u
		exp++
	}
	return fmt.Sprintf("%.1f%cB", float64(n)/float64(div), "KMGTPE"[exp])
}
