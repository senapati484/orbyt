import * as cheerio from "cheerio";
import { AdapterSourceConfig } from "../../config.js";
import { OrbytComponent } from "../../schema.js";
import { OrbytSource } from "../types.js";

/**
 * Aceternity UI has no public registry.json or MCP server, so this
 * adapter scrapes its docs pages instead. This is intentionally a thin
 * stub: `componentSlugs` is a hand-maintained seed list rather than a
 * live crawl, because Aceternity's docs nav isn't a stable machine-
 * readable index. Growing this list (or replacing it with a real crawl
 * of the sitemap) is exactly the kind of thing to do once Phase 02
 * proves the normalized schema holds for scraped sources at all —
 * don't over-invest here before that's confirmed.
 */
const SEED_SLUGS = ["spotlight-card", "3d-card-effect", "background-beams", "sparkles"];

export class AceternityAdapter implements OrbytSource {
  readonly name = "aceternity";
  readonly mode = "adapter" as const;

  constructor(private readonly config: AdapterSourceConfig) {}

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}

  async fetchCatalog(): Promise<OrbytComponent[]> {
    const components: OrbytComponent[] = [];
    for (const slug of SEED_SLUGS) {
      const component = await this.fetchComponent(`${this.name}/${slug}`);
      if (component) components.push(component);
    }
    return components;
  }

  async fetchComponent(id: string): Promise<OrbytComponent | null> {
    const slug = id.split("/").slice(1).join("/");
    const url = new URL(`/components/${slug}`, this.config.baseUrl).toString();

    const res = await fetch(url);
    if (!res.ok) return null;

    const html = await res.text();
    const $ = cheerio.load(html);

    // TODO: this selector needs to be confirmed against the live docs
    // page structure — Aceternity's docs are built on Nextra/Fumadocs-
    // style rendering and the exact code-block container class will
    // need a real inspection pass rather than guessing here.
    const codeBlock = $("pre code").first().text();
    const title = $("h1").first().text().trim() || slug;

    if (!codeBlock) return null;

    return {
      id,
      name: title,
      sourceLib: this.name,
      category: "effect",
      tags: ["animated"],
      framework: "react",
      style: "tailwind",
      dependencies: ["framer-motion"],
      files: [
        {
          path: `components/ui/${slug}.tsx`,
          content: codeBlock,
        },
      ],
      installCommand: null,
      previewImage: null,
      license: "MIT",
      sourceUrl: url,
      fetchedAt: new Date().toISOString(),
    };
  }
}
