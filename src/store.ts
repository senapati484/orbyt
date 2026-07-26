import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import Fuse from "fuse.js";
import { OrbytComponent, OrbytSearchResult } from "./schema.js";

/**
 * v1 index: a flat JSON file on disk, keyed by component id.
 * This is intentionally the simplest thing that works — the interface
 * below (search / get / upsert / bySource) is the contract Phase 03
 * needs to preserve when this gets swapped for better-sqlite3 + fuse.js.
 * Nothing outside this file should know it's JSON under the hood.
 */
export class OrbytStore {
  private filePath: string;
  private cache: Map<string, OrbytComponent> = new Map();
  private loaded = false;

  constructor(cwd = process.cwd()) {
    this.filePath = path.join(cwd, ".orbyt", "index.json");
  }

  private async ensureLoaded() {
    if (this.loaded) return;
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const entries: OrbytComponent[] = JSON.parse(raw);
      for (const entry of entries) this.cache.set(entry.id, entry);
    } catch {
      // No index yet — fine, starts empty.
    }
    this.loaded = true;
  }

  private async persist() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify([...this.cache.values()], null, 2), "utf-8");
  }

  async upsert(component: OrbytComponent) {
    await this.ensureLoaded();
    this.cache.set(component.id, component);
    await this.persist();
  }

  async upsertMany(components: OrbytComponent[]) {
    await this.ensureLoaded();
    for (const c of components) this.cache.set(c.id, c);
    await this.persist();
  }

  async get(id: string): Promise<OrbytComponent | undefined> {
    await this.ensureLoaded();
    return this.cache.get(id);
  }

  async bySource(sourceLib: string): Promise<OrbytComponent[]> {
    await this.ensureLoaded();
    return [...this.cache.values()].filter((c) => c.sourceLib === sourceLib);
  }

  /**
   * Fuzzy search across name/category/tags using fuse.js.
   */
  async search(query: string, opts: { framework?: string; style?: string } = {}): Promise<OrbytSearchResult[]> {
    await this.ensureLoaded();
    const q = query.trim();

    let components = [...this.cache.values()];

    if (opts.framework) {
      components = components.filter((c) => c.framework === opts.framework);
    }
    if (opts.style) {
      components = components.filter((c) => c.style === opts.style);
    }

    if (!q) {
      return components.map((c) => ({
        id: c.id,
        name: c.name,
        sourceLib: c.sourceLib,
        category: c.category,
        tags: c.tags,
        framework: c.framework,
        score: 1,
      }));
    }

    const fuse = new Fuse(components, {
      keys: [
        { name: "id", weight: 4 },
        { name: "name", weight: 3 },
        { name: "category", weight: 2 },
        { name: "tags", weight: 2 },
        { name: "sourceLib", weight: 1 },
      ],
      threshold: 0.6,
      ignoreLocation: true,
      includeScore: true,
    });

    const fuseResults = fuse.search(q);

    return fuseResults.map((res) => {
      const c = res.item;
      const score = res.score !== undefined ? (1 - res.score) * 5 : 1;
      return {
        id: c.id,
        name: c.name,
        sourceLib: c.sourceLib,
        category: c.category,
        tags: c.tags,
        framework: c.framework,
        score,
      };
    });
  }

  async clearSource(sourceLib: string) {
    await this.ensureLoaded();
    for (const [id, c] of this.cache.entries()) {
      if (c.sourceLib === sourceLib) {
        this.cache.delete(id);
      }
    }
    await this.persist();
  }

  /** Components older than maxAgeMs since fetchedAt — candidates for refresh_source. */
  async stale(sourceLib: string, maxAgeMs: number): Promise<OrbytComponent[]> {
    const all = await this.bySource(sourceLib);
    const now = Date.now();
    return all.filter((c) => now - new Date(c.fetchedAt).getTime() > maxAgeMs);
  }
}
