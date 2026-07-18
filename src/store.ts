import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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
   * v1 search: naive substring + tag scoring across name/category/tags.
   * Good enough to prove the schema out. Swap for fuse.js in Phase 03
   * without changing this method's signature.
   */
  async search(query: string, opts: { framework?: string; style?: string } = {}): Promise<OrbytSearchResult[]> {
    await this.ensureLoaded();
    const q = query.toLowerCase();

    const results = [...this.cache.values()]
      .filter((c) => (opts.framework ? c.framework === opts.framework : true))
      .filter((c) => (opts.style ? c.style === opts.style : true))
      .map((c) => {
        let score = 0;
        if (c.name.toLowerCase().includes(q)) score += 3;
        if (c.category?.toLowerCase().includes(q)) score += 2;
        if (c.tags.some((t) => t.toLowerCase().includes(q))) score += 2;
        if (c.sourceLib.toLowerCase().includes(q)) score += 1;
        return { component: c, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);

    return results.map(({ component, score }) => ({
      id: component.id,
      name: component.name,
      sourceLib: component.sourceLib,
      category: component.category,
      tags: component.tags,
      framework: component.framework,
      score,
    }));
  }

  /** Components older than maxAgeMs since fetchedAt — candidates for refresh_source. */
  async stale(sourceLib: string, maxAgeMs: number): Promise<OrbytComponent[]> {
    const all = await this.bySource(sourceLib);
    const now = Date.now();
    return all.filter((c) => now - new Date(c.fetchedAt).getTime() > maxAgeMs);
  }
}
