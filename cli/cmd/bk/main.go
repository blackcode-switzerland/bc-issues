package main

import (
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/mustneerar7/blackcode-issues/cli/internal/client"
	"github.com/mustneerar7/blackcode-issues/cli/internal/commands"
	"github.com/mustneerar7/blackcode-issues/cli/internal/config"
)

// Exit codes are stable so LLMs / scripts can branch on outcome:
//
//	0  ok
//	1  generic / runtime error
//	2  bad usage (cobra arg/flag errors)
//	3  not authenticated (401, or no config)
//	4  permission denied (403)
//	5  not found (404)
//	6  validation error (400)
//	7  user aborted (declined a confirm prompt)
const (
	exitOK         = 0
	exitGeneric    = 1
	exitUsage      = 2
	exitAuth       = 3
	exitPermission = 4
	exitNotFound   = 5
	exitValidation = 6
	exitAborted    = 7
)

func main() {
	if err := commands.NewRoot().Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(classify(err))
	}
}

func classify(err error) int {
	if err == nil {
		return exitOK
	}
	if errors.Is(err, config.ErrNotConfigured) {
		return exitAuth
	}
	var ae *client.APIError
	if errors.As(err, &ae) {
		switch ae.Status {
		case 400, 422:
			return exitValidation
		case 401:
			return exitAuth
		case 403:
			return exitPermission
		case 404:
			return exitNotFound
		}
		return exitGeneric
	}
	msg := err.Error()
	switch {
	case strings.HasPrefix(msg, "aborted"):
		return exitAborted
	case strings.Contains(msg, "required") || strings.HasPrefix(msg, "invalid "):
		return exitUsage
	}
	return exitGeneric
}
