#!/usr/bin/env node
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { runServer } from "./index.js";

const args = process.argv.slice(2);
const cwd = process.cwd();

async function main() {
  if (args[0] === "init") {
    const clientIndex = args.indexOf("--client");
    const client = clientIndex !== -1 ? args[clientIndex + 1] : "claude";
    await init(client);
    return;
  }

  await runServer(cwd);
}

async function init(client: string) {
  await writeOrbytConfig();
  await writeClientConfig(client);
  console.log(`\nOrbyt is set up for ${client}. Restart your editor, then try:\n  "search for an animated pricing card"\n`);
}

async function prompt(question: string, defaultValue: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${question} [${defaultValue}]: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

async function promptYesNo(question: string, defaultValue: boolean): Promise<boolean> {
  const defaultStr = defaultValue ? "Y/n" : "y/N";
  const ans = await prompt(`${question} (${defaultStr})`, "");
  if (ans === "") return defaultValue;
  return ans.toLowerCase().startsWith("y");
}

async function writeOrbytConfig() {
  const target = path.join(cwd, "orbyt.config.json");
  const exampleUrl = new URL("../orbyt.config.example.json", import.meta.url);
  const examplePath = fileURLToPath(exampleUrl);

  try {
    await readFile(target, "utf-8");
    console.log("orbyt.config.json already exists — leaving it as is.");
  } catch {
    // Check if stdin/stdout are TTY to support interactive prompt
    if (process.stdout.isTTY && process.stdin.isTTY) {
      console.log("\nInitializing Orbyt configuration (orbyt.config.json)...");
      const framework = await prompt("Enter your project framework (react/vue/svelte/solid/react-native)", "react");
      const styling = await prompt("Enter your styling approach (tailwind/css-modules/styled-components/plain-css)", "tailwind");
      const componentsAlias = await prompt("Enter components import alias path", "@/components/ui");
      
      const enableShadcn = await promptYesNo("Enable shadcn/ui source?", true);
      const enableMagicUi = await promptYesNo("Enable Magic UI source?", true);
      const enableAceternity = await promptYesNo("Enable Aceternity UI source?", true);

      const configObj = {
        $schema: "./node_modules/orbyt/schema/config.schema.json",
        aliases: {
          components: componentsAlias,
          utils: "@/lib/utils",
        },
        cacheTtlMs: 86400000,
        sources: {
          proxy: {
            shadcn: {
              enabled: enableShadcn,
              command: "npx shadcn@latest mcp",
            },
            magicui: {
              enabled: enableMagicUi,
              command: "npx @magicuidesign/mcp@latest",
            },
          },
          adapter: {
            aceternity: {
              enabled: enableAceternity,
              baseUrl: "https://ui.aceternity.com",
            },
          },
        },
      };

      await writeFile(target, JSON.stringify(configObj, null, 2) + "\n", "utf-8");
      console.log("Wrote customized orbyt.config.json successfully.");
    } else {
      await copyFile(examplePath, target);
      console.log("Wrote default orbyt.config.json (non-interactive environment).");
    }
  }
}

async function writeClientConfig(client: string) {
  const normalized = client.toLowerCase();
  
  let configFilename = ".mcp.json";
  let relativePath = ".mcp.json";

  if (normalized === "cursor") {
    configFilename = ".cursor/mcp.json";
    relativePath = path.join(".cursor", "mcp.json");
  } else if (normalized === "vscode") {
    configFilename = ".vscode/mcp.json";
    relativePath = path.join(".vscode", "mcp.json");
  } else if (normalized === "windsurf") {
    configFilename = ".windsurf/mcp.json";
    relativePath = path.join(".windsurf", "mcp.json");
  } else if (normalized !== "claude") {
    console.log(`--client ${client} is not natively supported. Defaulting to Claude Code configuration.`);
  }

  const mcpConfigPath = path.join(cwd, relativePath);
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await readFile(mcpConfigPath, "utf-8"));
  } catch {
    // No file yet — start fresh.
  }

  const mcpServers = (existing.mcpServers as Record<string, unknown>) ?? {};
  mcpServers.orbyt = {
    type: "stdio",
    command: "npx",
    args: ["orbyt"],
  };

  await mkdir(path.dirname(mcpConfigPath), { recursive: true });
  await writeFile(mcpConfigPath, JSON.stringify({ ...existing, mcpServers }, null, 2) + "\n", "utf-8");
  console.log(`Wrote ${configFilename} entry for ${client}.`);
}

main().catch((err) => {
  console.error("[orbyt]", err.message ?? err);
  process.exit(1);
});
