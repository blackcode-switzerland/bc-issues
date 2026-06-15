package commands

import "testing"

func TestParseRefs(t *testing.T) {
	t.Run("valid mixed refs", func(t *testing.T) {
		refs, err := parseRefs([]string{"issue:42", "project:3", "milestone:7"})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(refs) != 3 {
			t.Fatalf("want 3 refs, got %d", len(refs))
		}
		want := []struct {
			typ string
			id  int
		}{{"issue", 42}, {"project", 3}, {"milestone", 7}}
		for i, w := range want {
			if refs[i].Type != w.typ || refs[i].ID != w.id {
				t.Errorf("ref %d = %s:%d, want %s:%d", i, refs[i].Type, refs[i].ID, w.typ, w.id)
			}
		}
	})

	t.Run("case-insensitive type and whitespace", func(t *testing.T) {
		refs, err := parseRefs([]string{" ISSUE : 9 "})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if refs[0].Type != "issue" || refs[0].ID != 9 {
			t.Errorf("got %s:%d, want issue:9", refs[0].Type, refs[0].ID)
		}
	})

	t.Run("rejects bad type", func(t *testing.T) {
		if _, err := parseRefs([]string{"widget:1"}); err == nil {
			t.Error("expected error for invalid type")
		}
	})

	t.Run("rejects missing id", func(t *testing.T) {
		if _, err := parseRefs([]string{"issue"}); err == nil {
			t.Error("expected error for missing id")
		}
	})

	t.Run("rejects non-numeric id", func(t *testing.T) {
		if _, err := parseRefs([]string{"issue:abc"}); err == nil {
			t.Error("expected error for non-numeric id")
		}
	})
}

func TestTruncateTitle(t *testing.T) {
	short := "a short title"
	if got := truncateTitle(short); got != short {
		t.Errorf("short title changed: %q", got)
	}
	long := ""
	for i := 0; i < 80; i++ {
		long += "x"
	}
	got := truncateTitle(long)
	if len([]rune(got)) != 48 {
		t.Errorf("truncated length = %d runes, want 48", len([]rune(got)))
	}
	if got[len(got)-len("…")] != "…"[0] {
		t.Errorf("expected ellipsis suffix, got %q", got)
	}
}
