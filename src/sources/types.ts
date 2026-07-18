import { OrbytComponent } from "../schema.js";

/**
 * Both ingestion lanes (proxy = wraps a real MCP server, adapter = scrapes
 * or reads a registry.json) implement this one interface. The rest of the
 * server never needs to know which lane a given source came from.
 */
export interface OrbytSource {
  /** Machine name used as the sourceLib field and in tool-facing ids, e.g. "shadcn". */
  readonly name: string;

  /** "proxy" (has a real MCP server) or "adapter" (scraped / registry.json). */
  readonly mode: "proxy" | "adapter";

  /** Open any underlying connection (spawn child MCP process, etc). Idempotent. */
  connect(): Promise<void>;

  /** Close any underlying connection. Safe to call even if never connected. */
  disconnect(): Promise<void>;

  /**
   * Pull the current catalog (or a query-scoped slice of it, if the
   * upstream source supports server-side search) and return it already
   * normalized to OrbytComponent. Orbyt writes the result into the shared
   * index — this method should not touch the store directly.
   */
  fetchCatalog(query?: string): Promise<OrbytComponent[]>;

  /** Full detail for one component id, if the catalog fetch only returned summaries. */
  fetchComponent(id: string): Promise<OrbytComponent | null>;
}
