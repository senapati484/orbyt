import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, findConfigDir } from "./config.js";
import { buildSources } from "./sources/registry.js";
import { OrbytStore } from "./store.js";
import { registerTools } from "./tools/registerTools.js";

export async function runServer(cwd = process.cwd()) {
  const resolvedCwd = (await findConfigDir(cwd)) || cwd;
  const config = await loadConfig(resolvedCwd);
  const sources = buildSources(config);
  const store = new OrbytStore(resolvedCwd);

  const server = new McpServer({ name: "orbyt", version: "0.1.22" });

  registerTools(server, { config, store, sources, cwd: resolvedCwd });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on("SIGINT", async () => {
    await Promise.all(sources.map((s) => s.disconnect()));
    process.exit(0);
  });
}

