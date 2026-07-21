#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
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
        framework,
        styling,
        aliases: {
          components: componentsAlias,
        },
        cacheTtlMs: 86400000,
        sources: {
          shadcn: {
            mode: "proxy",
            enabled: enableShadcn,
            command: "npx",
            args: ["shadcn@latest", "mcp"],
          },
          magicui: {
            mode: "proxy",
            enabled: enableMagicUi,
            command: "npx",
            args: ["@magicuidesign/mcp"],
          },
          aceternity: {
            mode: "adapter",
            enabled: enableAceternity,
            baseUrl: "https://ui.aceternity.com",
          },
        },
      };

      await writeFile(target, JSON.stringify(configObj, null, 2) + "\n", "utf-8");
      console.log("Wrote customized orbyt.config.json successfully.");
    } else {
      const defaultConfigObj = {
        $schema: "./node_modules/orbyt/schema/config.schema.json",
        framework: "next",
        styling: "tailwind",
        aliases: {
          components: "@/components/ui",
        },
        cacheTtlMs: 86400000,
        sources: {
          shadcn: {
            mode: "proxy",
            enabled: true,
            command: "npx",
            args: ["shadcn@latest", "mcp"],
          },
          magicui: {
            mode: "proxy",
            enabled: true,
            command: "npx",
            args: ["@magicuidesign/mcp"],
          },
          aceternity: {
            mode: "adapter",
            enabled: true,
            baseUrl: "https://ui.aceternity.com",
          },
        },
      };
      await writeFile(target, JSON.stringify(defaultConfigObj, null, 2) + "\n", "utf-8");
      console.log("Wrote default orbyt.config.json (non-interactive environment).");
    }
  }
}

async function writeSingleClientConfig(relativePath: string, clientName: string) {
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
  console.log(`Wrote ${relativePath} entry for ${clientName}.`);
}

async function writeClientConfig(client: string) {
  const normalized = client.toLowerCase();
  
  if (normalized === "all") {
    await writeSingleClientConfig(".mcp.json", "Claude/General");
    await writeSingleClientConfig(".vscode/mcp.json", "VS Code");
    await writeSingleClientConfig(".cursor/mcp.json", "Cursor");
    await writeSingleClientConfig(".windsurf/mcp.json", "Windsurf");
    return;
  }

  let relativePath = ".mcp.json";
  let name = "Claude/General";

  if (normalized === "cursor") {
    relativePath = path.join(".cursor", "mcp.json");
    name = "Cursor";
  } else if (normalized === "vscode") {
    relativePath = path.join(".vscode", "mcp.json");
    name = "VS Code";
  } else if (normalized === "windsurf") {
    relativePath = path.join(".windsurf", "mcp.json");
    name = "Windsurf";
  } else if (normalized !== "claude") {
    console.log(`--client ${client} is not natively supported. Defaulting to Claude Code configuration.`);
  }

  await writeSingleClientConfig(relativePath, name);
}

main().catch((err) => {
  console.error("[orbyt]", err.message ?? err);
  process.exit(1);
});
