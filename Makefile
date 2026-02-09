.PHONY: help install build typecheck lint check format format-check watch start clean prepare test test-watch coverage all

# Default target
help:
	@echo "Available targets:"
	@echo "  make install      - Install dependencies (npm install)"
	@echo "  make build        - Bundle with esbuild → dist/index.js"
	@echo "  make typecheck    - Type-check with tsc (no emit)"
	@echo "  make format       - Format code with Prettier"
	@echo "  make format-check - Check code formatting with Prettier"
	@echo "  make lint         - Lint with ESLint"
	@echo "  make check        - Run typecheck + lint"
	@echo "  make watch        - Rebuild on file changes"
	@echo "  make start        - Start the MCP server (node dist/index.js)"
	@echo "  make prepare      - Run prepare script (npm run build)"
	@echo "  make test         - Run tests (vitest)"
	@echo "  make test-watch   - Run tests in watch mode"
	@echo "  make coverage     - Run tests with coverage report"
	@echo "  make clean        - Remove dist/ and node_modules/"
	@echo "  make all          - Install and build"

# Install dependencies using npm ci for reproducible builds
node_modules: package.json package-lock.json
	npm ci
	@touch node_modules

# Install dependencies (for manual use)
install:
	npm install

# Bundle the project
build: node_modules
	npm run build

# Type-check (no emit)
typecheck: node_modules
	npm run typecheck

# Format code with Prettier
format: node_modules
	npm run format

# Check code formatting with Prettier
format-check: node_modules
	npm run format:check

# Lint with ESLint
lint: node_modules
	npm run lint

# Run all static checks (typecheck + lint)
check: typecheck lint

# Watch mode for development
watch: node_modules
	npm run watch

# Start the server
start: node_modules
	npm start

# Prepare (triggered by npm on install)
prepare: node_modules
	npm run prepare

# Run tests
test: node_modules
	npm test

# Run tests in watch mode
test-watch: node_modules
	npm run test:watch

# Run tests with coverage
coverage: node_modules
	npm run coverage

# Clean build artifacts
clean:
	rm -rf dist/
	rm -rf node_modules/

# Install and build
all: node_modules build
