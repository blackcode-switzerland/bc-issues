# bk CLI — build & cross-compile
#
# Run from cli/. Examples:
#   make                       # build for host platform -> ./bk
#   make build                 # same
#   make all                   # cross-compile every target into dist/
#   make dist                  # all + SHA256SUMS
#   make install               # install to $GOBIN (or ~/go/bin)
#   make run -- whoami         # go run cmd/bk -- whoami
#   make test                  # go test ./...
#   make clean                 # remove ./bk and dist/

# ---- variables -----------------------------------------------------------

BIN       := bk
PKG       := ./cmd/bk
MODULE    := github.com/blackcode-switzerland/bc-issues/cli
VERSION   ?= $(shell git describe --tags --dirty --always 2>/dev/null || echo dev)
COMMIT    ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)
DATE      ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)

# Strip the binary (-s -w) and stamp the version into version.Version.
LDFLAGS   := -s -w \
             -X '$(MODULE)/internal/version.Version=$(VERSION)' \
             -X '$(MODULE)/internal/version.Commit=$(COMMIT)'   \
             -X '$(MODULE)/internal/version.BuildDate=$(DATE)'

GO        ?= go
GOFLAGS   ?= -trimpath
DIST      := dist

# Cross-compile matrix. Add or remove "GOOS/GOARCH" pairs as needed.
TARGETS := \
  darwin/amd64    \
  darwin/arm64    \
  linux/amd64     \
  linux/arm64     \
  windows/amd64   \
  windows/arm64

# Derived list of artifact basenames, e.g. bk-v1.2.3-darwin-arm64
ARTIFACTS := $(foreach t,$(TARGETS),\
  $(DIST)/$(BIN)-$(VERSION)-$(subst /,-,$(t))$(if $(findstring windows,$(t)),.exe,))

# ---- targets -------------------------------------------------------------

.PHONY: help build install all dist sums run test vet fmt tidy clean version targets

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nTargets:\n"} \
	      /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo
	@echo "VERSION=$(VERSION)  COMMIT=$(COMMIT)"
	@echo "Cross targets: $(TARGETS)"

build: $(BIN) ## Build for the host platform -> ./bk

$(BIN):
	$(GO) build $(GOFLAGS) -ldflags "$(LDFLAGS)" -o $(BIN) $(PKG)

install: ## Install to $GOBIN (defaults to ~/go/bin)
	$(GO) install $(GOFLAGS) -ldflags "$(LDFLAGS)" $(PKG)

all: $(ARTIFACTS) ## Cross-compile every target into dist/

dist: all sums ## Cross-compile + write dist/SHA256SUMS

sums: ## Recompute dist/SHA256SUMS over current artifacts
	@cd $(DIST) && shasum -a 256 $(BIN)-$(VERSION)-* > SHA256SUMS && \
	  echo "wrote $(DIST)/SHA256SUMS"

# Static pattern rule: one rule, one binary per target.
# The stem ($*) is "<os>-<arch>" — split it back into GOOS/GOARCH.
$(DIST)/$(BIN)-$(VERSION)-%: $(shell find . -name '*.go' -not -path './$(DIST)/*' 2>/dev/null) go.mod go.sum
	@mkdir -p $(DIST)
	@os=$$(echo $* | sed 's/\.exe$$//' | cut -d- -f1); \
	 arch=$$(echo $* | sed 's/\.exe$$//' | cut -d- -f2); \
	 echo "  build  $$os/$$arch  ->  $@"; \
	 GOOS=$$os GOARCH=$$arch CGO_ENABLED=0 \
	 $(GO) build $(GOFLAGS) -ldflags "$(LDFLAGS)" -o $@ $(PKG)

run: ## go run cmd/bk (pass args after --, e.g. `make run -- whoami`)
	$(GO) run $(PKG) $(filter-out $@,$(MAKECMDGOALS))

# Swallow the post-`--` words so `make run -- whoami` doesn't try to make
# a target called `whoami`. They're already captured by $(MAKECMDGOALS).
%:
	@:

test: ## go test ./...
	$(GO) test $(GOFLAGS) ./...

vet: ## go vet ./...
	$(GO) vet ./...

fmt: ## gofmt -w on all Go sources
	$(GO) fmt ./...

tidy: ## go mod tidy
	$(GO) mod tidy

clean: ## Remove ./bk and dist/
	rm -f $(BIN)
	rm -rf $(DIST)

version: ## Print the resolved version string
	@echo $(VERSION)

targets: ## Print the cross-compile target matrix
	@for t in $(TARGETS); do echo $$t; done
