import { ProxySourceConfig } from "../../config.js";
import { OrbytComponent } from "../../schema.js";
import { McpProxySource, ProxyMapper } from "./mcpProxySource.js";

/**
 * TODO before first real run: confirm these against a live
 * `client.listTools()` dump from `npx shadcn@latest mcp`. shadcn's MCP
 * server exposes registry browse/search/add tools driven by the
 * registries configured in the *target project's* components.json — the
 * exact tool name and argument shape should be pulled from that dump
 * rather than assumed here. This mapper is written to be obviously the
 * one place to fix once that's confirmed.
 */
const shadcnMapper: ProxyMapper = {
  searchToolName: "search_items_in_registries",
  buildSearchArgs(query) {
    return { registries: ["@shadcn"], query: query ?? "" };
  },
  parseRawResult(result: unknown): unknown[] {
    const content = (result as { content?: Array<{ type: string; text?: string }> })?.content ?? [];
    const textBlock = content.find((block) => block.type === "text" && block.text)?.text ?? "";

    const items: Array<Record<string, unknown>> = [];
    // Matches: "- name (registry:type) - Optional description. [@registry]"
    const regex = /-\s+([a-zA-Z0-9_-]+)\s+\(registry:([^)]+)\)(?:\s+-\s+([^\n]+?))?\s+\[@([^\]]+)\]/g;
    let match;
    while ((match = regex.exec(textBlock)) !== null) {
      items.push({
        name: match[1],
        type: match[2],
        description: match[3],
        registry: match[4],
      });
    }
    return items;
  },
  toComponent(sourceLib, raw): OrbytComponent | null {
    const item = raw as Record<string, unknown>;
    if (!item || typeof item.name !== "string") return null;

    const registry = typeof item.registry === "string" ? item.registry : "shadcn";

    return {
      id: `${sourceLib}/${item.name}`,
      name: item.name,
      sourceLib,
      category: typeof item.type === "string" ? item.type : undefined,
      tags: typeof item.description === "string" ? [item.description] : [],
      framework: "react",
      style: "tailwind",
      dependencies: [],
      files: [],
      installCommand: `npx shadcn@latest add @${registry}/${item.name}`,
      previewImage: null,
      license: "MIT",
      sourceUrl: `https://ui.shadcn.com/docs/components/${item.name}`,
      fetchedAt: new Date().toISOString(),
    };
  },
};

export function createShadcnSource(config: ProxySourceConfig) {
  return new McpProxySource("shadcn", config, shadcnMapper);
}
