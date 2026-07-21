# Changelog

All notable changes to this project will be documented in this file.

## [0.1.2] - 2026-07-21

### Fixed
- Replaced dynamic Mermaid diagram Base64 URL with static SVG asset hosted on GitHub to resolve npmjs.com README parsing and display issues.

## [0.1.1] - 2026-07-21

### Fixed
- Fixed config schema validation mismatch in interactive prompt (flat source structure).
- Embedded default configuration directly into CLI to support non-interactive setup without depending on unbundled files.
- Added missing JSON schema file and bundled it in NPM release.
- Added `solid` to allowed frameworks list in configuration schema.
- Pre-rendered Mermaid ingestion diagram in README as a raw Base64 SVG so it renders properly on npmjs.com.

## [0.1.0] - 2026-07-18

### Added
- First public release of **Orbyt**, the ultimate UI-component MCP server proxy and adapter.
- Unified registry store with Fuse.js fuzzy matching, category/framework/style filtering, and automatic cache invalidation.
- Proxy adapter for Magic UI (`@magicuidesign/mcp`) supporting direct component metadata and raw file extraction.
- Custom registry adapter for Aceternity UI, resolving components dynamically via direct JSON endpoints.
- Proxy adapter for shadcn/ui.
- Maintenance tool `refresh_source` to force clear cache and warm specific sources.
- Real token extraction tool `get_theme_tokens` using shadcn's official base color themes.
- Onboarding CLI (`orbyt init`) supporting interactive configuration setup and multiple editors (Claude Code, VS Code, Cursor, Windsurf).
- Robust TypeScript path alias resolution based on `tsconfig.json` or `jsconfig.json`.
- Dynamic dependency version resolution by querying npm registry.
- Dry-run mode (`dryRun`) for previewing installations without writing files to disk.
- Fully defined configuration schema with Zod validation.
