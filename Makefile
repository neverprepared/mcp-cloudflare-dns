NAME        := mcp-cloudflare-dns
VERSION     := $(shell node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")
ARCH        := all
INSTALL_DIR := /opt/$(NAME)
BIN_DIR     := /usr/bin
STAGE       := .pkg-stage
PKG_OUT     := packages

.PHONY: all build package package-docker clean

all: package

build:
	npm install
	npm run build

package: build
	rm -rf $(STAGE)
	mkdir -p $(STAGE)$(INSTALL_DIR) $(STAGE)$(BIN_DIR) $(PKG_OUT)

	# Copy compiled output and package manifest into staging tree
	cp -r dist              $(STAGE)$(INSTALL_DIR)/dist
	cp    package.json      $(STAGE)$(INSTALL_DIR)/package.json
	cp    package-lock.json $(STAGE)$(INSTALL_DIR)/package-lock.json

	# Install production-only dependencies
	npm ci --prefix $(STAGE)$(INSTALL_DIR) --omit=dev

	# Install wrapper script
	cp packaging$(BIN_DIR)/mcp-cloudflare $(STAGE)$(BIN_DIR)/mcp-cloudflare

	fpm \
		--input-type  dir \
		--output-type deb \
		--chdir       $(STAGE) \
		--name        $(NAME) \
		--version     $(VERSION) \
		--architecture $(ARCH) \
		--description "MCP server for Cloudflare DNS management" \
		--url         "https://github.com/neverprepared/mcp-cloudflare-dns" \
		--license     MIT \
		--depends     nodejs \
		--package     $(PKG_OUT)/ \
		.

# Build the .deb inside an Ubuntu container (safe cross-build from macOS)
package-docker:
	docker run --rm \
		-v "$(CURDIR)":/build \
		-w /build \
		--platform linux/amd64 \
		ubuntu:24.04 \
		bash -c "apt-get update -qq && \
		  apt-get install -y -qq nodejs npm ruby ruby-dev build-essential && \
		  gem install fpm --no-document && \
		  make package"

clean:
	rm -rf dist $(STAGE) $(PKG_OUT)
