# orbyt

One MCP server that proxies UI-component sources with their own MCP server
(shadcn, Magic UI...) and adapts the ones that don't (Aceternity, and any
site that publishes a shadcn-shaped `registry.json`) — behind one small,
normalized tool surface: `list_sources`, `search_components`, `get_component`,
`install_component`, `get_theme_tokens`.

This is the Phase 0–1 scaffold from the implementation plan: it compiles,
wires config → sources → index → tools → stdio transport end to end, and
runs against **shadcn as the first proxy source** and **Aceternity as the
first adapter source**. Everything past that point in the roadmap is a
real, but intentionally minimal, stub — see "What's stubbed" below before
you point this at a real project.

## Layout

```
src/
  index.ts                    server bootstrap (config → sources → store → tools)
  cli.ts                      `orbyt` (run) and `orbyt init --client <x>` (setup)
  config.ts                   orbyt.config.json loading + validation (zod)
  schema.ts                   the normalized OrbytComponent shape every source maps into
  store.ts                    v1 local index (JSON file) — search / get / upsert
  sources/
    types.ts                  OrbytSource interface both lanes implement
    registry.ts                dispatches enabled config entries into source instances
    proxy/
      mcpProxySource.ts          generic child-MCP-process plumbing
      shadcn.ts                    shadcn-specific mapper on top of it
    adapter/
      registryJsonAdapter.ts     generic adapter for sites with a public registry.json
      aceternity.ts                 scraping adapter for sites without one
```

## Try it

```bash
npm install
npm run build
npx orbyt init --client claude   # writes orbyt.config.json + .mcp.json
```

Then restart Claude Code and ask it to search for a component.

## What's stubbed, on purpose

- **shadcn's tool name** in `sources/proxy/shadcn.ts` is a placeholder.
  Confirm it against a real `client.listTools()` dump before relying on it —
  see the TODO comment right above `shadcnMapper`.
- **Aceternity's scrape selector** in `sources/adapter/aceternity.ts` is a
  guess at the docs page structure, and its component list is a short
  hand-picked seed array, not a live crawl.
- **The index** is a flat JSON file (`store.ts`), not SQLite yet. The
  public interface (`search` / `get` / `upsert` / `bySource` / `stale`) is
  written so swapping the backend later doesn't touch any calling code.
- **`install_component`'s path resolution** assumes a conventional
  `@/components/ui` → `components/ui` mapping instead of reading the
  target project's real `tsconfig.json` paths.
- **`get_theme_tokens`** returns `null` for every source — real extraction
  is Phase 05 in the plan, once more than one source is proven out.
- **Magic UI, 21st.dev, and any adapter beyond Aceternity** aren't wired
  into `sources/registry.ts` yet — add a proxy mapper or drop in
  `RegistryJsonAdapter` the same way `shadcn.ts` and `aceternity.ts` do.

## Next step

Phase 00 from the plan: confirm shadcn's real tool names via `listTools()`,
and check whether Aceternity's docs are stable enough to scrape reliably
before investing further there.

