import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ProxySourceConfig } from "../../config.js";
import { OrbytComponent } from "../../schema.js";
import { OrbytSource } from "../types.js";

/**
 * A "mapper" adapts one child MCP server's own tool-call results into
 * Orbyt's normalized OrbytComponent shape. Every proxied source (shadcn,
 * Magic UI, 21st.dev...) gets its own mapper because their tool names
 * and response shapes are all different — this class only handles the
 * plumbing (spawn, connect, call, teardown) that's identical across all
 * of them.
 */
export interface ProxyMapper {
  /** The child server's tool name used for catalog/search calls. */
  searchToolName: string;
  /** Build the arguments object for that tool from a free-text query. */
  buildSearchArgs(query?: string): Record<string, unknown>;
  /** Turn one raw tool-result item into an OrbytComponent. */
  toComponent(sourceLib: string, raw: unknown): OrbytComponent | null;
  /** Optionally parse the raw tool result (e.g. if the server returns plain text instead of structured JSON). */
  parseRawResult?(result: unknown): unknown[];
}

export class McpProxySource implements OrbytSource {
  readonly mode = "proxy" as const;
  private client: Client | null = null;

  constructor(
    readonly name: string,
    private readonly config: ProxySourceConfig,
    private readonly mapper: ProxyMapper
  ) {}

  async connect(): Promise<void> {
    if (this.client) return;

    const transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args,
      env: this.config.env,
    });

    const client = new Client({ name: `orbyt-proxy-${this.name}`, version: "0.1.3" });
    await client.connect(transport);
    this.client = client;

    // Dev note: run `await client.listTools()` here while wiring up a new
    // mapper to confirm the child server's actual tool names — they're
    // not guaranteed to be stable across versions, so don't hardcode
    // blind. This scaffold assumes the mapper was built against a real
    // `listTools()` dump for that source.
  }

  async disconnect(): Promise<void> {
    if (!this.client) return;
    await this.client.close();
    this.client = null;
  }

  async fetchCatalog(query?: string): Promise<OrbytComponent[]> {
    await this.connect();
    if (!this.client) return [];

    const result = await this.client.callTool({
      name: this.mapper.searchToolName,
      arguments: this.mapper.buildSearchArgs(query),
    });

    const items = this.mapper.parseRawResult
      ? this.mapper.parseRawResult(result)
      : extractItems(result);
    return items
      .map((item) => this.mapper.toComponent(this.name, item))
      .filter((c): c is OrbytComponent => c !== null);
  }

  async fetchComponent(id: string): Promise<OrbytComponent | null> {
    // For most catalog-style child servers, fetchCatalog already returns
    // full enough detail. Override this per-source if a given server
    // needs a second "get full detail" call (e.g. separate view/add tools).
    const slug = id.split("/").slice(1).join("/");
    const [match] = await this.fetchCatalog(slug);
    return match ?? null;
  }
}

/** MCP tool results come back as a content-block array; pull structured
 * items out of whichever block actually carries them. */
function extractItems(result: unknown): unknown[] {
  const content = (result as { content?: Array<{ type: string; text?: string }> })?.content ?? [];
  for (const block of content) {
    if (block.type === "text" && block.text) {
      try {
        const parsed = JSON.parse(block.text);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        // Not JSON — some servers return human-readable text instead.
        continue;
      }
    }
  }
  return [];
}
