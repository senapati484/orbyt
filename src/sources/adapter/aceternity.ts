import { AdapterSourceConfig } from "../../config.js";
import { OrbytComponent } from "../../schema.js";
import { OrbytSource } from "../types.js";

/**
 * Aceternity UI publishes a registry index at /registry.json and individual
 * component json files containing source code at /registry/[name].json.
 * This adapter fetches these json files directly.
 */
export class AceternityAdapter implements OrbytSource {
  readonly name = "aceternity";
  readonly mode = "adapter" as const;

  constructor(private readonly config: AdapterSourceConfig) {}

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}

  async fetchCatalog(query?: string): Promise<OrbytComponent[]> {
    try {
      const indexUrl = new URL("/registry.json", this.config.baseUrl).toString();
      const res = await fetch(indexUrl);
      if (!res.ok) {
        console.error(`[orbyt] Failed to fetch Aceternity index from ${indexUrl}: ${res.status}`);
        return [];
      }

      const indexData = (await res.json()) as { items?: Array<{ name: string; type: string }> };
      const items = indexData.items ?? [];

      // Filter based on query if provided
      let filteredItems = items;
      if (query) {
        const q = query.toLowerCase();
        filteredItems = items.filter(
          (item) => item.name.toLowerCase().includes(q)
        );
      }

      // Limit concurrency and total fetches to avoid slamming the server/rate limits
      const limit = filteredItems.slice(0, 15);
      const components: OrbytComponent[] = [];

      await Promise.all(
        limit.map(async (item) => {
          try {
            const comp = await this.fetchComponent(`${this.name}/${item.name}`);
            if (comp) {
              components.push(comp);
            }
          } catch (err) {
            console.error(`[orbyt] Failed to fetch Aceternity component details for ${item.name}:`, err);
          }
        })
      );

      return components;
    } catch (err) {
      console.error("[orbyt] Aceternity fetchCatalog failed:", err);
      return [];
    }
  }

  async fetchComponent(id: string): Promise<OrbytComponent | null> {
    const slug = id.split("/").slice(1).join("/");
    const url = new URL(`/registry/${slug}.json`, this.config.baseUrl).toString();
    const sourceUrl = new URL(`/components/${slug}`, this.config.baseUrl).toString();

    const res = await fetch(url);
    if (!res.ok) {
      return null;
    }

    const item = (await res.json()) as {
      name: string;
      title?: string;
      type?: string;
      dependencies?: string[];
      files?: Array<{ path: string; content: string }>;
      registryDependencies?: string[];
      tailwind?: Record<string, any>;
    };

    const files = Array.isArray(item.files)
      ? item.files.map((f) => ({
          path: f.path,
          content: f.content,
        }))
      : [];

    return {
      id,
      name: item.title || item.name,
      sourceLib: this.name,
      category: item.type || "registry:ui",
      tags: ["animated"],
      framework: "react",
      style: "tailwind",
      dependencies: item.dependencies || [],
      files,
      installCommand: `npx shadcn@latest add ${url}`,
      previewImage: ((item as any).image as string) || ((item as any).thumbnail as string) || null,
      license: "MIT",
      sourceUrl,
      tailwind: item.tailwind,
      fetchedAt: new Date().toISOString(),
    };
  }
}
