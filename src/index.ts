import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { buildSources } from "./sources/registry.js";
import { OrbytStore } from "./store.js";
import { registerTools } from "./tools/registerTools.js";

export async function runServer(cwd = process.cwd()) {
  const config = await loadConfig(cwd);
  const sources = buildSources(config);
  const store = new OrbytStore(cwd);

  const server = new McpServer({ name: "orbyt", version: "0.1.0" });

  registerTools(server, { config, store, sources, cwd });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on("SIGINT", async () => {
    await Promise.all(sources.map((s) => s.disconnect()));
    process.exit(0);
  });
}
