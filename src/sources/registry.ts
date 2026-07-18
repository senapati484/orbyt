import { enabledSources, OrbytConfig } from "../config.js";
import { AceternityAdapter } from "./adapter/aceternity.js";
import { RegistryJsonAdapter } from "./adapter/registryJsonAdapter.js";
import { createShadcnSource } from "./proxy/shadcn.js";
import { OrbytSource } from "./types.js";

/**
 * Maps a source's config-file name to how it should be constructed.
 * Sources not listed here but present in orbyt.config.json with
 * mode: "adapter" and a registryJsonPath fall back to the generic
 * RegistryJsonAdapter — most new adapter sources shouldn't need a
 * bespoke file at all, only the ones that need real scraping (like
 * Aceternity) do.
 */
export function buildSources(config: OrbytConfig): OrbytSource[] {
  const sources: OrbytSource[] = [];

  for (const [name, sourceConfig] of enabledSources(config)) {
    if (sourceConfig.mode === "proxy") {
      switch (name) {
        case "shadcn":
          sources.push(createShadcnSource(sourceConfig));
          break;
        default:
          console.error(
            `[orbyt] "${name}" is configured as a proxy source but has no mapper yet — ` +
              `add one in src/sources/proxy/${name}.ts (see shadcn.ts for the pattern). Skipping.`
          );
      }
      continue;
    }

    // mode === "adapter"
    if (name === "aceternity") {
      sources.push(new AceternityAdapter(sourceConfig));
    } else {
      sources.push(new RegistryJsonAdapter(name, sourceConfig));
    }
  }

  return sources;
}
