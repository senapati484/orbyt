import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { OrbytConfig } from "../config.js";
import { OrbytStore } from "../store.js";
import { OrbytSource } from "../sources/types.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function registerTools(server: McpServer, opts: { config: OrbytConfig; store: OrbytStore; sources: OrbytSource[]; cwd: string }) {
  const { config, store, sources, cwd } = opts;

  server.tool(
    "list_sources",
    "List every UI-component source Orbyt is connected to, whether it's proxied from a real MCP server or scraped through an adapter, and whether it needs auth.",
    {},
    async () => {
      const summary = sources.map((s) => ({ name: s.name, mode: s.mode }));
      return textResult(summary);
    }
  );

  server.tool(
    "search_components",
    "Search for UI components across every connected source. Returns ranked summaries — use get_component for full code.",
    {
      query: z.string().describe("Free-text search, e.g. 'animated pricing card'"),
      framework: z.string().optional().describe("Filter to one framework, e.g. 'react'"),
      style: z.string().optional().describe("Filter to one styling approach, e.g. 'tailwind'"),
    },
    async ({ query, framework, style }) => {
      // Cheap warm: pull fresh catalogs for any source whose cache is
      // empty or stale before searching the local index. Real
      // production behavior (TTL length, background refresh) belongs
      // in Phase 03 — this is the minimum to make search useful today.
      for (const source of sources) {
        const stale = await store.stale(source.name, ONE_DAY_MS);
        const existing = await store.bySource(source.name);
        if (existing.length === 0 || stale.length > 0) {
          try {
            const fresh = await source.fetchCatalog(query);
            await store.upsertMany(fresh);
          } catch (err) {
            console.error(`[orbyt] ${source.name} catalog fetch failed:`, err);
          }
        }
      }

      const results = await store.search(query, { framework, style });
      return textResult(results);
    }
  );

  server.tool(
    "get_component",
    "Fetch the full code, dependencies, and files for one component by id (e.g. 'shadcn/button' or 'aceternity/spotlight-card').",
    { id: z.string() },
    async ({ id }) => {
      let component = await store.get(id);

      if (!component) {
        const sourceLib = id.split("/")[0];
        const source = sources.find((s) => s.name === sourceLib);
        if (source) {
          const fetched = await source.fetchComponent(id);
          if (fetched) {
            await store.upsert(fetched);
            component = fetched;
          }
        }
      }

      if (!component) {
        return textResult({ error: `No component found for id "${id}". Try search_components first.` });
      }
      return textResult(component);
    }
  );

  server.tool(
    "install_component",
    "Write a component's files into the target project and report which dependencies still need installing.",
    {
      id: z.string(),
      targetPath: z.string().optional().describe("Defaults to the configured components alias, e.g. '@/components/ui'"),
    },
    async ({ id, targetPath }) => {
      const component = await store.get(id);
      if (!component) {
        return textResult({ error: `"${id}" isn't in the index yet — run get_component first.` });
      }
      if (component.files.length === 0) {
        return textResult({
          error: `"${id}" has no file contents cached (this is common for proxy sources whose own MCP server installs files itself, e.g. shadcn). Use that source's native install command instead: ${component.installCommand ?? "none provided"}.`,
        });
      }

      const baseDir = targetPath ?? config.aliases.components;
      const written: string[] = [];

      for (const file of component.files) {
        // targetPath / alias resolution here is deliberately simple —
        // it assumes a conventional path alias like "@/components/ui"
        // maps to "src/components/ui" or "components/ui" in the actual
        // project. Phase 04 should resolve this against the project's
        // real tsconfig "paths" instead of guessing.
        const resolvedDir = baseDir.replace(/^@\//, "");
        const fullPath = path.join(cwd, resolvedDir, path.basename(file.path));
        await mkdir(path.dirname(fullPath), { recursive: true });
        await writeFile(fullPath, file.content, "utf-8");
        written.push(fullPath);
      }

      const depReport = await mergePackageJsonDeps(cwd, component.dependencies);

      return textResult({
        installed: id,
        filesWritten: written,
        dependenciesAdded: depReport.added,
        dependenciesAlreadyPresent: depReport.alreadyPresent,
        note: depReport.added.length > 0 ? "Run your package manager's install command to pull the new dependencies." : undefined,
      });
    }
  );

  server.tool(
    "get_theme_tokens",
    "Fetch design tokens / CSS variables from a source, where it exposes them, so components pulled from different libraries stay visually consistent.",
    { sourceLib: z.string() },
    async ({ sourceLib }) => {
      // Stub: most sources don't expose tokens through their catalog
      // response today. This tool exists so the schema and call shape
      // are settled before Phase 05 wires up real token extraction per
      // source (shadcn's CSS variables in particular are a good first
      // target since they're already machine-readable).
      return textResult({
        sourceLib,
        tokens: null,
        note: "Token extraction isn't implemented yet for this source — see Phase 05 in the plan.",
      });
    }
  );
}

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

async function mergePackageJsonDeps(cwd: string, deps: string[]) {
  const pkgPath = path.join(cwd, "package.json");
  const added: string[] = [];
  const alreadyPresent: string[] = [];

  if (deps.length === 0) return { added, alreadyPresent };

  try {
    const raw = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(raw);
    pkg.dependencies ??= {};

    for (const dep of deps) {
      if (pkg.dependencies[dep]) {
        alreadyPresent.push(dep);
      } else {
        pkg.dependencies[dep] = "latest"; // Phase 04: resolve a real pinned version instead.
        added.push(dep);
      }
    }

    if (added.length > 0) {
      await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
    }
  } catch (err) {
    console.error("[orbyt] couldn't update package.json:", err);
  }

  return { added, alreadyPresent };
}
