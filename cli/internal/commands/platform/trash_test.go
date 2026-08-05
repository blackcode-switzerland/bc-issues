package platform

import "testing"

func TestParseRefs(t *testing.T) {
	t.Run("valid mixed refs", func(t *testing.T) {
		refs, err := parseRefs([]string{"issue:42", "project:3", "task:7"})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(refs) != 3 {
			t.Fatalf("want 3 refs, got %d", len(refs))
		}
		want := []struct {
			typ string
			num int
		}{{"issue", 42}, {"project", 3}, {"task", 7}}
		for i, w := range want {
			if refs[i].Type != w.typ || refs[i].Number != w.num {
				t.Errorf("ref %d = %s:%d, want %s:%d", i, refs[i].Type, refs[i].Number, w.typ, w.num)
			}
			// ID must stay ZERO so `omitempty` drops it from the request body.
			// A ref carrying both spellings is rejected by the server as
			// ambiguous — deliberately, because guessing which one to honour on
			// the purge path means guessing which row to destroy.
			if refs[i].ID != 0 {
				t.Errorf("ref %d carries a row id (%d); it must send only the #number", i, refs[i].ID)
			}
		}
	})

	t.Run("case-insensitive type and whitespace", func(t *testing.T) {
		refs, err := parseRefs([]string{" ISSUE : 9 "})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if refs[0].Type != "issue" || refs[0].Number != 9 {
			t.Errorf("got %s:%d, want issue:9", refs[0].Type, refs[0].Number)
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

	t.Run("rejects a non-positive #number", func(t *testing.T) {
		// #numbers start at 1. Row ids do too, so this does not distinguish the
		// eras — it just stops a nonsense ref reaching the purge path.
		for _, bad := range []string{"issue:0", "issue:-1"} {
			if _, err := parseRefs([]string{bad}); err == nil {
				t.Errorf("expected error for %q", bad)
			}
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
