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
      for (const source of sources) {
        const existing = await store.bySource(source.name);
        const stale = await store.stale(source.name, config.cacheTtlMs);
        
        if (existing.length === 0) {
          // Cold cache: fetch synchronously
          try {
            const fresh = await source.fetchCatalog(query);
            await store.upsertMany(fresh);
          } catch (err) {
            console.error(`[orbyt] ${source.name} catalog fetch failed:`, err);
          }
        } else if (stale.length > 0) {
          // Stale cache: refresh in the background
          source.fetchCatalog(query)
            .then((fresh) => store.upsertMany(fresh))
            .catch((err) => console.error(`[orbyt] Background refresh for ${source.name} failed:`, err));
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
      const sourceLib = id.split("/")[0];
      const source = sources.find((s) => s.name === sourceLib);

      if ((!component || component.files.length === 0) && source) {
        try {
          const fetched = await source.fetchComponent(id);
          if (fetched) {
            await store.upsert(fetched);
            component = fetched;
          }
        } catch (err) {
          console.error(`[orbyt] On-demand fetch failed for ${id}:`, err);
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
    "Write a component's files into the target project, merge dependencies into package.json, and report Tailwind config updates. If files are not embedded, returns native CLI command and source URL for execution.",
    {
      id: z.string(),
      targetPath: z.string().optional().describe("Defaults to the configured components alias, e.g. '@/components/ui'"),
      dryRun: z.boolean().optional().describe("If true, only report what would be done without writing to disk"),
      acknowledgeLicense: z.boolean().optional().describe("Acknowledge installation of a component with a non-permissive license"),
    },
    async ({ id, targetPath, dryRun = false, acknowledgeLicense = false }) => {
      let component = await store.get(id);
      const sourceLib = id.split("/")[0];
      const source = sources.find((s) => s.name === sourceLib);

      if ((!component || component.files.length === 0) && source) {
        try {
          const fetched = await source.fetchComponent(id);
          if (fetched) {
            await store.upsert(fetched);
            component = fetched;
          }
        } catch (err) {
          console.error(`[orbyt] On-demand fetch during install failed for ${id}:`, err);
        }
      }

      if (!component) {
        return textResult({ error: `"${id}" isn't in the index yet and could not be fetched automatically.` });
      }

      // Framework mismatch check
      const projectFramework = config.framework;
      const componentFramework = component.framework;
      const isReactLike = (fw: string) => fw === "react" || fw === "next";
      const frameworksMatch =
        componentFramework === "unknown" ||
        componentFramework === projectFramework ||
        (isReactLike(componentFramework) && isReactLike(projectFramework));

      if (!frameworksMatch) {
        return textResult({
          error: `Framework mismatch: The component "${id}" is built for ${componentFramework}, but your project is configured for ${projectFramework}.`,
        });
      }

      // License check
      const permissiveLicenses = ["mit", "apache-2.0", "bsd-2-clause", "bsd-3-clause", "isc", "unlicense", "cc0-1.0"];
      const componentLicense = component.license?.toLowerCase() || "unknown";
      const isPermissive = permissiveLicenses.includes(componentLicense);

      if (!isPermissive && !acknowledgeLicense) {
        return textResult({
          error: `License Warning: The component "${id}" is under a "${component.license || "unknown"}" license. If you wish to proceed, set the "acknowledgeLicense" parameter to true.`,
        });
      }

      if (component.files.length === 0) {
        return textResult({
          componentId: id,
          status: "native_install_required",
          installCommand: component.installCommand ?? `npx shadcn@latest add ${id.split("/")[1]}`,
          sourceUrl: component.sourceUrl,
          dependencies: component.dependencies,
          tailwindConfigAdditions: component.tailwind ?? null,
          message: `"${id}" uses a native CLI installer. Run the installCommand in your terminal or fetch sourceUrl directly.`
        });
      }

      const baseAlias = targetPath ?? config.aliases.components;
      const filesReport: Array<{ path: string; status: "created" | "overwritten"; contentSnippet: string }> = [];

      for (const file of component.files) {
        // Resolve target file path using robust tsconfig alias resolver
        const filename = path.basename(file.path);
        const resolvedBaseDir = await resolvePathAlias(baseAlias, cwd);
        const fullPath = path.join(resolvedBaseDir, filename);

        let status: "created" | "overwritten" = "created";
        try {
          await readFile(fullPath);
          status = "overwritten";
        } catch {
          // File does not exist yet
        }

        filesReport.push({
          path: fullPath,
          status,
          contentSnippet: file.content.substring(0, 150) + "...",
        });

        if (!dryRun) {
          await mkdir(path.dirname(fullPath), { recursive: true });
          await writeFile(fullPath, file.content, "utf-8");
        }
      }

      // Merge dependencies and resolve latest pinned versions from npm registry
      const dependenciesReport = await mergePackageJsonDeps(cwd, component.dependencies, dryRun);

      // Simple Tailwind merge summary/alert if required by the component
      let tailwindConfigUpdate = null;
      if (component.tailwind) {
        tailwindConfigUpdate = component.tailwind;
      }

      return textResult({
        componentId: id,
        dryRun,
        files: filesReport,
        dependencies: dependenciesReport,
        tailwindConfigAdditions: tailwindConfigUpdate,
        message: dryRun
          ? "This is a dry-run. No files or package dependencies were actually written."
          : "Component successfully installed.",
      });
    }
  );

  server.tool(
    "get_theme_tokens",
    "Fetch design tokens / CSS variables from a source, where it exposes them, so components pulled from different libraries stay visually consistent.",
    {
      sourceLib: z.string().describe("The library to get tokens for, e.g. 'shadcn' or 'magicui'"),
      baseColor: z.string().optional().describe("The base color palette, e.g. 'zinc', 'slate', 'neutral'. Defaults to 'zinc'"),
    },
    async ({ sourceLib, baseColor = "zinc" }) => {
      const normalizedLib = sourceLib.toLowerCase();
      if (normalizedLib === "shadcn" || normalizedLib === "magicui") {
        try {
          const res = await fetch(`https://ui.shadcn.com/r/colors/${baseColor}.json`);
          if (res.ok) {
            const data = await res.json();
            return textResult({
              sourceLib,
              baseColor,
              tokens: data,
            });
          }
          return textResult({ error: `Could not fetch colors for base color "${baseColor}".` });
        } catch (err: any) {
          return textResult({ error: `Failed to fetch theme tokens: ${err.message}` });
        }
      }

      return textResult({
        sourceLib,
        tokens: null,
        note: `Token extraction isn't supported/needed for "${sourceLib}". Only 'shadcn' and 'magicui' use standard theme tokens today.`,
      });
    }
  );

  server.tool(
    "refresh_source",
    "Clear cached components for one source (e.g. 'shadcn' or 'aceternity') and force a fresh sync of its catalog.",
    { sourceName: z.string().describe("The name of the source library to refresh, e.g. 'aceternity'") },
    async ({ sourceName }) => {
      const source = sources.find((s) => s.name === sourceName);
      if (!source) {
        return textResult({ error: `Source "${sourceName}" is not registered or enabled in Orbyt configuration.` });
      }

      try {
        await store.clearSource(sourceName);
        const fresh = await source.fetchCatalog();
        await store.upsertMany(fresh);
        return textResult({
          message: `Successfully cleared cache and synchronized catalog for "${sourceName}".`,
          componentsSynced: fresh.length,
        });
      } catch (err: any) {
        console.error(`[orbyt] Forced refresh for ${sourceName} failed:`, err);
        return textResult({ error: `Failed to refresh source "${sourceName}": ${err.message}` });
      }
    }
  );
}

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

async function resolvePathAlias(aliasPath: string, cwd: string): Promise<string> {
  const fallback = aliasPath.replace(/^@\//, "");
  try {
    let configRaw = "";
    try {
      configRaw = await readFile(path.join(cwd, "tsconfig.json"), "utf-8");
    } catch {
      try {
        configRaw = await readFile(path.join(cwd, "jsconfig.json"), "utf-8");
      } catch {
        return path.join(cwd, fallback);
      }
    }

    const cleanJson = configRaw.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, "$1");
    const config = JSON.parse(cleanJson);
    const paths = config?.compilerOptions?.paths;
    if (!paths) {
      return path.join(cwd, fallback);
    }

    for (const [key, value] of Object.entries(paths)) {
      const keyPrefix = key.replace(/\*$/, "");
      if (aliasPath.startsWith(keyPrefix)) {
        const suffix = aliasPath.substring(keyPrefix.length);
        const targetArr = value as string[];
        if (targetArr && targetArr.length > 0) {
          const targetPath = targetArr[0].replace(/\*$/, "");
          return path.join(cwd, targetPath, suffix);
        }
      }
    }
  } catch {
    // Ignore and fallback
  }
  return path.join(cwd, fallback);
}

async function resolveLatestNpmVersion(packageName: string): Promise<string> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${packageName}/latest`);
    if (res.ok) {
      const data = (await res.json()) as { version?: string };
      if (data.version) {
        return `^${data.version}`;
      }
    }
  } catch {
    // Fallback to latest
  }
  return "latest";
}

async function mergePackageJsonDeps(cwd: string, deps: string[], dryRun = false) {
  const pkgPath = path.join(cwd, "package.json");
  const report: Array<{ name: string; version: string; status: "added" | "already_present" }> = [];

  if (deps.length === 0) return report;

  try {
    let pkg: any = {};
    try {
      const raw = await readFile(pkgPath, "utf-8");
      pkg = JSON.parse(raw);
    } catch {
      pkg = {
        name: path.basename(cwd) || "app",
        private: true,
        version: "0.0.0",
        dependencies: {},
      };
    }
    pkg.dependencies ??= {};

    const resolvedDeps = await Promise.all(
      deps.map(async (dep) => {
        const present = !!pkg.dependencies[dep];
        const version = present ? pkg.dependencies[dep] : await resolveLatestNpmVersion(dep);
        return { name: dep, version, present };
      })
    );

    for (const { name, version, present } of resolvedDeps) {
      if (present) {
        report.push({ name, version, status: "already_present" });
      } else {
        report.push({ name, version, status: "added" });
        pkg.dependencies[name] = version;
      }
    }

    if (!dryRun && report.some((r) => r.status === "added")) {
      await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
    }
  } catch (err) {
    console.error("[orbyt] couldn't update package.json:", err);
  }

  return report;
}
