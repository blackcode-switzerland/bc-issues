package platform

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/version"
)

// serverAdvertising returns a stub API that sets the version headers the real
// one sets on every response.
func serverAdvertising(t *testing.T, latest, min string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if latest != "" {
			w.Header().Set("X-BK-CLI-Latest", latest)
		}
		if min != "" {
			w.Header().Set("X-BK-CLI-Min", min)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"entries":[],"cli_latest_version":"","cli_min_version":""}`))
	}))
	t.Cleanup(srv.Close)
	return srv
}

// withRunningVersion pins version.Version (normally "dev", which the floor
// deliberately never blocks) and restores it afterwards.
func withRunningVersion(t *testing.T, v string) {
	t.Helper()
	prev := version.Version
	prevLatest, prevMin := client.LatestSeen, client.MinSeen
	version.Version = v
	client.LatestSeen, client.MinSeen = "", ""
	t.Cleanup(func() {
		version.Version = prev
		client.LatestSeen, client.MinSeen = prevLatest, prevMin
	})
}

// The regression: `bk skill sync` is what an agent runs to recover. When the
// binary is below the server's minimum, every other command fails with exit 8 —
// sync used to report "skill synced" and exit 0, telling the agent it was
// current at the exact moment it was blocked.
func TestHarvestVersionsPropagatesHardFloor(t *testing.T) {
	withRunningVersion(t, "1.9.0")
	srv := serverAdvertising(t, "1.9.2", "1.9.2")

	err := harvestVersions(client.New(srv.URL, "", ""))

	var oe *client.OutdatedError
	if !errors.As(err, &oe) {
		t.Fatalf("harvestVersions() = %v, want *client.OutdatedError so main.go can exit 8", err)
	}
	if oe.Min != "1.9.2" {
		t.Errorf("OutdatedError.Min = %q, want 1.9.2", oe.Min)
	}
}

// A supported version must not be blocked, and the headers must still be read.
func TestHarvestVersionsAcceptsSupportedVersion(t *testing.T) {
	withRunningVersion(t, "1.9.2")
	srv := serverAdvertising(t, "1.9.3", "1.9.0")

	if err := harvestVersions(client.New(srv.URL, "", "")); err != nil {
		t.Fatalf("harvestVersions() = %v, want nil", err)
	}
	if client.LatestSeen != "1.9.3" {
		t.Errorf("LatestSeen = %q, want 1.9.3 — the headers are the whole point of the call", client.LatestSeen)
	}
}

// A blip must not break the recovery path: `bk skill sync` still has useful work
// to do offline, since the template ships inside the binary.
func TestHarvestVersionsIgnoresNetworkFailure(t *testing.T) {
	withRunningVersion(t, "1.9.2")

	// A port nothing is listening on.
	if err := harvestVersions(client.New("http://127.0.0.1:1", "", "")); err != nil {
		t.Fatalf("harvestVersions() = %v, want nil so an offline sync still works", err)
	}
}

// Dev / unparsable builds are never blocked — otherwise local development would
// break every time the floor moved.
func TestHarvestVersionsNeverBlocksDevBuilds(t *testing.T) {
	withRunningVersion(t, "dev")
	srv := serverAdvertising(t, "99.0.0", "99.0.0")

	if err := harvestVersions(client.New(srv.URL, "", "")); err != nil {
		t.Fatalf("harvestVersions() = %v, want nil for a dev build", err)
	}
}

// Exit 9 covers two situations that need opposite instructions. Conflating them
// sends an agent into a loop: told to `npm install` when the binary is already
// current, it upgrades, nothing changes, it re-checks, same message.
func TestUpdateAvailableErrorDistinguishesBinaryFromSkill(t *testing.T) {
	binaryBehind := (&UpdateAvailableError{Current: "1.9.1", Latest: "1.9.2"}).Error()
	if !strings.Contains(binaryBehind, "npm install") {
		t.Errorf("a behind binary must name the upgrade command, got: %q", binaryBehind)
	}

	skillOnly := (&UpdateAvailableError{Current: "1.9.2", SkillOnly: true}).Error()
	if strings.Contains(skillOnly, "npm install") {
		t.Errorf("the binary is current — telling the agent to upgrade loops it: %q", skillOnly)
	}
	if !strings.Contains(skillOnly, "bk skill install") {
		t.Errorf("must name the actual fix, got: %q", skillOnly)
	}
	if strings.Contains(skillOnly, "is behind 1.9.2") {
		t.Errorf("must not claim a version is behind itself: %q", skillOnly)
	}
}
