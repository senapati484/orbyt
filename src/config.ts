import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const ProxySourceSchema = z.object({
  mode: z.literal("proxy"),
  enabled: z.boolean().default(true),
  command: z.string(), // e.g. "npx"
  args: z.array(z.string()).default([]), // e.g. ["shadcn@latest", "mcp"]
  env: z.record(z.string()).optional(),
});

const AdapterSourceSchema = z.object({
  mode: z.literal("adapter"),
  enabled: z.boolean().default(true),
  baseUrl: z.string(),
  registryJsonPath: z.string().optional(), // e.g. "/r/{name}.json" if the site follows shadcn's registry shape
});

const SourceConfigSchema = z.discriminatedUnion("mode", [ProxySourceSchema, AdapterSourceSchema]);

export const OrbytConfigSchema = z.object({
  framework: z.enum(["next", "react", "vue", "svelte", "react-native"]).default("react"),
  styling: z.enum(["tailwind", "css-modules", "styled-components", "plain-css"]).default("tailwind"),
  aliases: z
    .object({
      components: z.string().default("@/components/ui"),
    })
    .default({ components: "@/components/ui" }),
  sources: z.record(SourceConfigSchema),
});

export type OrbytConfig = z.infer<typeof OrbytConfigSchema>;
export type ProxySourceConfig = z.infer<typeof ProxySourceSchema>;
export type AdapterSourceConfig = z.infer<typeof AdapterSourceSchema>;

const DEFAULT_CONFIG_FILENAME = "orbyt.config.json";

export async function loadConfig(cwd = process.cwd()): Promise<OrbytConfig> {
  const configPath = path.join(cwd, DEFAULT_CONFIG_FILENAME);

  let raw: string;
  try {
    raw = await readFile(configPath, "utf-8");
  } catch {
    throw new Error(
      `No ${DEFAULT_CONFIG_FILENAME} found in ${cwd}.\n` +
        `Run "npx orbyt init --client claude" first, or copy orbyt.config.example.json.`
    );
  }

  const parsed = OrbytConfigSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`Invalid ${DEFAULT_CONFIG_FILENAME}:\n${parsed.error.toString()}`);
  }

  return parsed.data;
}

export function enabledSources(config: OrbytConfig) {
  return Object.entries(config.sources).filter(([, source]) => source.enabled);
}
