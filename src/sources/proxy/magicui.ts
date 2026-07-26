import { ProxySourceConfig } from "../../config.js";
import { OrbytComponent } from "../../schema.js";
import { McpProxySource, ProxyMapper } from "./mcpProxySource.js";

const magicuiMapper: ProxyMapper = {
  searchToolName: "searchRegistryItems",
  buildSearchArgs(query) {
    return { query: query ?? "", limit: 100 };
  },
  parseRawResult(result: unknown): unknown[] {
    const content = (result as { content?: Array<{ type: string; text?: string }> })?.content ?? [];
    const textBlock = content.find((block) => block.type === "text" && block.text)?.text ?? "";
    try {
      const parsed = JSON.parse(textBlock);
      if (parsed && Array.isArray(parsed.items)) return parsed.items;
      if (Array.isArray(parsed)) return parsed;
      return [parsed];
    } catch {
      return [];
    }
  },
  toComponent(sourceLib, raw): OrbytComponent | null {
    const item = raw as Record<string, any>;
    if (!item || typeof item.name !== "string") return null;

    // Extract code block by stripping context header if present
    let code = item.source || "";
    const marker = "// File:";
    const markerIndex = code.indexOf(marker);
    if (markerIndex !== -1) {
      const endOfLine = code.indexOf("\n", markerIndex);
      if (endOfLine !== -1) {
        code = code.substring(endOfLine + 1);
      }
    }

    const files = code
      ? [{ path: `components/magicui/${item.name}.tsx`, content: code }]
      : [];

    const installCommand = item.install?.command || `npx shadcn@latest add "https://magicui.design/r/${item.name}.json"`;

    return {
      id: `${sourceLib}/${item.name}`,
      name: item.title || item.name,
      sourceLib,
      category: item.kind || item.registryType,
      tags: item.description ? [item.description] : [],
      framework: "react",
      style: "tailwind",
      dependencies: Array.isArray(item.dependencies) ? item.dependencies : [],
      files,
      installCommand,
      previewImage: (item.image as string) || (item.thumbnail as string) || null,
      license: "MIT",
      sourceUrl: item.install?.registryUrl || `https://magicui.design/r/${item.name}.json`,
      tailwind: item.tailwind,
      fetchedAt: new Date().toISOString(),
    };
  },
};

export class MagicUiSource extends McpProxySource {
  constructor(config: ProxySourceConfig) {
    super("magicui", config, magicuiMapper);
  }

  override async fetchComponent(id: string): Promise<OrbytComponent | null> {
    const slug = id.split("/").slice(1).join("/");

    // 1. Try MCP Proxy client tool call if connected
    try {
      await this.connect();
      // @ts-ignore
      if (this.client) {
        // @ts-ignore
        const result = await this.client.callTool({
          name: "getRegistryItem",
          arguments: {
            name: slug,
            includeSource: true,
            includeExamples: false,
            includeRelated: false,
          },
        });

        const parsedItems = magicuiMapper.parseRawResult?.(result) ?? [];
        if (parsedItems.length > 0 && parsedItems[0]) {
          const comp = magicuiMapper.toComponent(this.name, parsedItems[0]);
          if (comp && comp.files.length > 0) {
            return comp;
          }
        }
      }
    } catch (err) {
      console.warn(`[orbyt] magicui proxy fetch failed for ${id}, attempting HTTP fallback:`, err);
    }

    // 2. HTTP Fallback directly to Magic UI registry
    try {
      const res = await fetch(`https://magicui.design/r/${slug}.json`);
      if (res.ok) {
        const item = (await res.json()) as any;
        const files = Array.isArray(item.files)
          ? item.files.map((f: any) => ({
              path: f.path || `components/magicui/${slug}.tsx`,
              content: f.content,
            }))
          : [];

        return {
          id,
          name: item.title || item.name || slug,
          sourceLib: this.name,
          category: item.type || "registry:ui",
          tags: ["animated", "magicui", slug],
          framework: "react",
          style: "tailwind",
          dependencies: item.dependencies || [],
          files,
          installCommand: `npx shadcn@latest add https://magicui.design/r/${slug}.json`,
          previewImage: item.image || item.thumbnail || null,
          license: "MIT",
          sourceUrl: `https://magicui.design/r/${slug}.json`,
          tailwind: item.tailwind,
          fetchedAt: new Date().toISOString(),
        };
      }
    } catch (err) {
      console.error(`[orbyt] magicui HTTP fallback failed for ${id}:`, err);
    }

    return null;
  }
}

export function createMagicUiSource(config: ProxySourceConfig) {
  return new MagicUiSource(config);
}
