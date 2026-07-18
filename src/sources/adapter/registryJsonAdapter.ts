import { AdapterSourceConfig } from "../../config.js";
import { OrbytComponent } from "../../schema.js";
import { OrbytSource } from "../types.js";

/**
 * Many free component sites now publish a public registry.json that
 * follows the same shape shadcn's CLI expects (a growing de-facto
 * standard). Where that exists, this is the cheapest possible adapter:
 * fetch it, normalize it, done — no scraping needed.
 */
export class RegistryJsonAdapter implements OrbytSource {
  readonly mode = "adapter" as const;

  constructor(readonly name: string, private readonly config: AdapterSourceConfig) {}

  async connect(): Promise<void> {
    // Nothing to keep open — every call is a plain HTTP fetch.
  }

  async disconnect(): Promise<void> {
    // No-op, same reason.
  }

  async fetchCatalog(): Promise<OrbytComponent[]> {
    const indexUrl = new URL(this.config.registryJsonPath ?? "/registry.json", this.config.baseUrl).toString();

    const res = await fetch(indexUrl);
    if (!res.ok) {
      throw new Error(`${this.name}: failed to fetch ${indexUrl} (${res.status})`);
    }

    const registry = (await res.json()) as { items?: unknown[] };
    const items = registry.items ?? [];

    return items
      .map((item) => this.toComponent(item))
      .filter((c): c is OrbytComponent => c !== null);
  }

  async fetchComponent(id: string): Promise<OrbytComponent | null> {
    const all = await this.fetchCatalog();
    return all.find((c) => c.id === id) ?? null;
  }

  private toComponent(raw: unknown): OrbytComponent | null {
    const item = raw as Record<string, unknown>;
    if (!item || typeof item.name !== "string") return null;

    const files = Array.isArray(item.files)
      ? (item.files as Array<Record<string, unknown>>)
          .filter((f) => typeof f.path === "string" && typeof f.content === "string")
          .map((f) => ({ path: f.path as string, content: f.content as string }))
      : [];

    return {
      id: `${this.name}/${item.name}`,
      name: item.name,
      sourceLib: this.name,
      category: typeof item.type === "string" ? item.type : undefined,
      tags: Array.isArray(item.tags) ? (item.tags as string[]) : [],
      framework: "react",
      style: "tailwind",
      dependencies: Array.isArray(item.dependencies) ? (item.dependencies as string[]) : [],
      files,
      installCommand: null,
      previewImage: typeof item.previewImage === "string" ? item.previewImage : null,
      license: typeof item.license === "string" ? item.license : null,
      sourceUrl: this.config.baseUrl,
      fetchedAt: new Date().toISOString(),
    };
  }
}
