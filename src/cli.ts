#!/usr/bin/env node
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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

async function writeOrbytConfig() {
  const target = path.join(cwd, "orbyt.config.json");
  const exampleUrl = new URL("../orbyt.config.example.json", import.meta.url);
  const examplePath = fileURLToPath(exampleUrl);

  try {
    await readFile(target, "utf-8");
    console.log("orbyt.config.json already exists — leaving it as is.");
  } catch {
    await copyFile(examplePath, target);
    console.log("Wrote orbyt.config.json (edit this to enable/disable sources).");
  }
}

async function writeClientConfig(client: string) {
  // Mirrors shadcn's own "mcp init --client <name>" ergonomics. Claude
  // Code and VS Code both read a project-scoped .mcp.json / mcp.json;
  // Cursor reads .cursor/mcp.json. Only Claude Code is wired up here —
  // add the other branches the same way once this shape is confirmed
  // to work end to end.
  if (client !== "claude") {
    console.log(`--client ${client} isn't wired up yet in this scaffold — add it in src/cli.ts alongside the "claude" branch.`);
    return;
  }

  const mcpConfigPath = path.join(cwd, ".mcp.json");
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
  console.log("Wrote .mcp.json entry for Claude Code.");
}

main().catch((err) => {
  console.error("[orbyt]", err.message ?? err);
  process.exit(1);
});
