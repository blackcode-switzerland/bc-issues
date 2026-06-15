package commands

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/blackcode-switzerland/bc-issues/cli/internal/browser"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/client"
	"github.com/blackcode-switzerland/bc-issues/cli/internal/config"
	"github.com/spf13/cobra"
	"golang.org/x/term"
)

func newLoginCmd() *cobra.Command {
	var server string
	var pasteToken bool
	cmd := &cobra.Command{
		Use:   "login",
		Short: "Authenticate against a blackcode-issues server",
		Long: `By default, opens a browser to /cli/authorize on the server, captures
the minted token via a loopback HTTP server, and saves credentials to
~/.config/bk/config.json (mode 0600).

Use --token to paste a token manually instead (useful for headless/CI).`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if server == "" {
				server = "https://bc-issues.vercel.app"
			}

			if pasteToken {
				return runPasteLogin(server)
			}
			return runBrowserLogin(server)
		},
	}
	cmd.Flags().StringVar(&server, "server", "", "Server base URL (default: https://bc-issues.vercel.app)")
	cmd.Flags().BoolVar(&pasteToken, "token", false, "Paste a pre-existing token from stdin instead of opening a browser")
	return cmd
}

func runPasteLogin(server string) error {
	fmt.Fprintf(os.Stderr, "Server: %s\n", server)
	fd := int(os.Stdin.Fd())
	var raw string
	if term.IsTerminal(fd) {
		fmt.Fprint(os.Stderr, "Token (paste, input hidden): ")
		b, err := term.ReadPassword(fd)
		fmt.Fprintln(os.Stderr)
		if err != nil {
			return fmt.Errorf("read token: %w", err)
		}
		raw = string(b)
	} else {
		line, err := bufio.NewReader(os.Stdin).ReadString('\n')
		if err != nil && line == "" {
			return fmt.Errorf("read token: %w", err)
		}
		raw = line
	}
	token := strings.TrimSpace(raw)
	if token == "" {
		return fmt.Errorf("empty token")
	}
	return finishLogin(server, token)
}

func runBrowserLogin(server string) error {
	state, err := randomHex(32)
	if err != nil {
		return fmt.Errorf("generate state: %w", err)
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("loopback listen: %w", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	callback := fmt.Sprintf("http://127.0.0.1:%d/callback", port)

	hostname, _ := os.Hostname()
	tokenName := fmt.Sprintf("cli-%s", hostname)
	if hostname == "" {
		tokenName = "cli"
	}

	authorizeURL := fmt.Sprintf(
		"%s/cli/authorize?callback=%s&state=%s&name=%s",
		strings.TrimRight(server, "/"),
		url.QueryEscape(callback),
		url.QueryEscape(state),
		url.QueryEscape(tokenName),
	)

	type result struct {
		token string
		err   error
	}
	ch := make(chan result, 1)

	mux := http.NewServeMux()
	mux.HandleFunc("/callback", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		gotState := q.Get("state")
		gotToken := q.Get("token")
		if gotState != state {
			http.Error(w, "state mismatch — close this tab and try again", http.StatusBadRequest)
			ch <- result{err: errors.New("state mismatch")}
			return
		}
		if gotToken == "" {
			http.Error(w, "missing token", http.StatusBadRequest)
			ch <- result{err: errors.New("missing token in callback")}
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprintln(w, `<!doctype html><html><head><meta charset="utf-8"><title>bk CLI</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0b10;color:#e7e7ee;display:flex;
align-items:center;justify-content:center;height:100vh;margin:0}.box{max-width:420px;padding:32px;
background:#15151d;border:1px solid #25252e;border-radius:16px}h1{margin:0 0 8px;font-size:18px}
p{margin:0;color:#a1a1aa;font-size:14px}</style></head><body><div class="box">
<h1>✓ bk CLI authorized</h1><p>You can close this tab and return to your terminal.</p>
</div></body></html>`)
		ch <- result{token: gotToken}
	})

	server2 := &http.Server{Handler: mux}
	go func() { _ = server2.Serve(listener) }()
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = server2.Shutdown(ctx)
	}()

	fmt.Fprintf(os.Stderr, "Opening browser to authorize:\n  %s\n", authorizeURL)
	if err := browser.Open(authorizeURL); err != nil {
		fmt.Fprintf(os.Stderr,
			"\nCouldn't open browser automatically. Open this URL manually:\n  %s\n\n",
			authorizeURL,
		)
	}
	fmt.Fprintln(os.Stderr, "Waiting for approval (5 minutes timeout)…")

	select {
	case res := <-ch:
		if res.err != nil {
			return fmt.Errorf("authorization failed: %w", res.err)
		}
		return finishLogin(server, res.token)
	case <-time.After(5 * time.Minute):
		return errors.New("timed out waiting for browser authorization")
	}
}

func finishLogin(server, token string) error {
	c := client.New(server, token)
	me, err := c.Whoami()
	if err != nil {
		return fmt.Errorf("token validation failed: %w", err)
	}
	cfg := &config.Config{
		Server: server,
		Token:  token,
		UserID: me.ID,
		Email:  me.Email,
	}
	if err := config.Save(cfg); err != nil {
		return fmt.Errorf("save config: %w", err)
	}
	fmt.Fprintf(os.Stderr, "Logged in as %s (id=%d, role=%s)\n", me.Email, me.ID, me.Role)
	return nil
}

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func newLogoutCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "logout",
		Short: "Remove stored credentials",
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := config.Delete(); err != nil {
				return err
			}
			fmt.Fprintln(os.Stderr, "Logged out.")
			return nil
		},
	}
}

func newWhoamiCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "whoami",
		Short: "Print the authenticated user",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := config.Load()
			if err != nil {
				return err
			}
			c := client.New(cfg.Server, cfg.Token)
			me, err := c.Whoami()
			if err != nil {
				return err
			}
			name := ""
			if me.Name != nil {
				name = *me.Name
			}
			fmt.Printf("id:    %d\nemail: %s\nname:  %s\nrole:  %s\nvia:   %s\n",
				me.ID, me.Email, name, me.Role, me.Via)
			if me.IsSuperAdmin {
				fmt.Printf("super: yes (platform-wide admin — `bk super-admin --help`)\n")
			}
			return nil
		},
	}
}
