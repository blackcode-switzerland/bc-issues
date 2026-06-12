package commands

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"

	"github.com/mustneerar7/blackcode-issues/cli/internal/client"
	"github.com/mustneerar7/blackcode-issues/cli/internal/config"
	"github.com/spf13/cobra"
	"golang.org/x/term"
)


// AddYesFlag attaches the --yes/-y skip-confirmation flag to a destructive command.
func AddYesFlag(cmd *cobra.Command, target *bool) {
	cmd.Flags().BoolVarP(target, "yes", "y", false, "Skip the interactive confirmation")
}

// Confirm prints prompt to stderr and waits for y/N. Always returns true if
// yes is set, the terminal isn't a TTY (e.g. CI / piped), or BK_NO_PROMPT=1.
func Confirm(prompt string, yes bool) bool {
	if yes {
		return true
	}
	if os.Getenv("BK_NO_PROMPT") == "1" {
		return true
	}
	if !term.IsTerminal(int(os.Stdin.Fd())) {
		return true
	}
	fmt.Fprintf(os.Stderr, "%s [y/N] ", prompt)
	r := bufio.NewReader(os.Stdin)
	line, _ := r.ReadString('\n')
	line = strings.TrimSpace(strings.ToLower(line))
	return line == "y" || line == "yes"
}

// ReadBody resolves a textual body from one of three sources, in priority
// order: --<flag>-file FILE, --<flag> "-" (stdin), --<flag> "literal".
// It returns the resolved string. It is safe to pass empty values for
// fields that aren't being set.
func ReadBody(literal, fromFile string) (string, error) {
	if fromFile != "" {
		b, err := os.ReadFile(fromFile)
		if err != nil {
			return "", fmt.Errorf("read %s: %w", fromFile, err)
		}
		return string(b), nil
	}
	if literal == "-" {
		b, err := io.ReadAll(os.Stdin)
		if err != nil {
			return "", fmt.Errorf("read stdin: %w", err)
		}
		return string(b), nil
	}
	return literal, nil
}

// ResolveUserRef turns a user reference (numeric id, email, name, or "me")
// into a numeric user id. Empty input returns (0, nil) so callers can
// distinguish "not provided".
func ResolveUserRef(c *client.Client, cfg *config.Config, ref string) (int, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return 0, nil
	}
	if strings.EqualFold(ref, "me") {
		if cfg.UserID == 0 {
			return 0, errors.New("no cached user id; run `bk login` again")
		}
		return cfg.UserID, nil
	}
	if id, err := strconv.Atoi(ref); err == nil {
		return id, nil
	}
	users, err := c.ListUsers()
	if err != nil {
		return 0, fmt.Errorf("resolve user %q: %w", ref, err)
	}
	if strings.Contains(ref, "@") {
		for _, u := range users {
			if strings.EqualFold(u.Email, ref) {
				return u.ID, nil
			}
		}
		return 0, fmt.Errorf("no user with email %q", ref)
	}
	for _, u := range users {
		if u.Name != nil && strings.EqualFold(*u.Name, ref) {
			return u.ID, nil
		}
	}
	return 0, fmt.Errorf("no user matching %q (try id or email)", ref)
}

// IntOrNullJSON returns the JSON encoding of n, or "null" when ref is the
// literal "none" / "null" / "unset". Empty ref returns nil so the field
// is omitted from the request entirely.
func IntOrNullJSON(ref string, c *client.Client, cfg *config.Config) ([]byte, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return nil, nil
	}
	switch strings.ToLower(ref) {
	case "none", "null", "unset", "clear":
		return []byte("null"), nil
	}
	id, err := ResolveUserRef(c, cfg, ref)
	if err != nil {
		// Fall through: maybe it's a milestone id, not a user
		if strings.Contains(err.Error(), "no user") {
			return nil, err
		}
		return nil, err
	}
	return []byte(strconv.Itoa(id)), nil
}

// PlainIntOrNullJSON does the same but does not try to resolve names —
// useful for milestone ids where we expect numeric input.
func PlainIntOrNullJSON(ref string) ([]byte, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return nil, nil
	}
	switch strings.ToLower(ref) {
	case "none", "null", "unset", "clear":
		return []byte("null"), nil
	}
	if _, err := strconv.Atoi(ref); err != nil {
		return nil, fmt.Errorf("expected an integer or 'none', got %q", ref)
	}
	return []byte(ref), nil
}

// StringOrNullJSON encodes ref as a JSON string, or null for the unset
// keywords, or nil to omit.
func StringOrNullJSON(ref string) []byte {
	r := strings.TrimSpace(ref)
	if r == "" {
		return nil
	}
	switch strings.ToLower(r) {
	case "none", "null", "unset", "clear":
		return []byte("null")
	}
	b, _ := jsonString(r)
	return b
}

// renderCommentList returns a table renderer for workspace-scoped comments.
func renderCommentList(comments []client.WorkspaceComment, stderr io.Writer) func(io.Writer) error {
	return func(w io.Writer) error {
		if len(comments) == 0 {
			fmt.Fprintln(stderr, "(no comments)")
			return nil
		}
		for _, cm := range comments {
			author := derefOr(cm.AuthorName, derefOr(cm.AuthorEmail, "—"))
			ts := derefOr(cm.CreatedAt, "")
			edited := ""
			if cm.EditedAt != nil {
				edited = " (edited)"
			}
			fmt.Fprintf(w, "── #%d · %s · %s%s ─────\n%s\n\n", cm.ID, author, ts, edited, cm.Content)
		}
		return nil
	}
}

func jsonString(s string) ([]byte, error) {
	// minimal JSON-string encoder; keep dependencies low
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"', '\\':
			b.WriteByte('\\')
			b.WriteRune(r)
		case '\n':
			b.WriteString("\\n")
		case '\r':
			b.WriteString("\\r")
		case '\t':
			b.WriteString("\\t")
		default:
			if r < 0x20 {
				fmt.Fprintf(&b, "\\u%04x", r)
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
	return []byte(b.String()), nil
}
