import { z } from "zod";

/**
 * Every source — whether it's proxied from a real MCP server or scraped
 * through an adapter — gets normalized into this one shape before it's
 * written into the index. This is the piece that makes a shadcn result
 * and an Aceternity result comparable in the same search_components call.
 */
export const OrbytComponentSchema = z.object({
  id: z.string(), // "<sourceLib>/<slug>", e.g. "aceternity/spotlight-card"
  name: z.string(),
  sourceLib: z.string(),
  category: z.string().optional(),
  tags: z.array(z.string()).default([]),
  framework: z.enum(["react", "vue", "svelte", "solid", "react-native", "unknown"]).default("react"),
  style: z.enum(["tailwind", "css-modules", "styled-components", "plain-css", "unknown"]).default("unknown"),
  dependencies: z.array(z.string()).default([]),
  files: z
    .array(
      z.object({
        path: z.string(),
        content: z.string(),
      })
    )
    .default([]),
  installCommand: z.string().nullable().default(null),
  previewImage: z.string().nullable().default(null),
  license: z.string().nullable().default(null),
  sourceUrl: z.string().nullable().default(null),
  tailwind: z.record(z.any()).optional(), // Store tailwind config updates
  fetchedAt: z.string(), // ISO timestamp, drives TTL refresh
});

export type OrbytComponent = z.infer<typeof OrbytComponentSchema>;

/** Loose search-result shape — deliberately smaller than the full component,
 * since search_components should be cheap to scan and get_component is
 * where the full file contents get pulled. */
export interface OrbytSearchResult {
  id: string;
  name: string;
  sourceLib: string;
  category?: string;
  tags: string[];
  framework: string;
  score: number;
}
