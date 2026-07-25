import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { buildCatalog } from "./catalog/index.js"
import { buildDocsCatalog } from "./catalog/docs.js"
import { describeMissingSource, SOURCE_FLAGS } from "./config.js"
import { registerArchonComponents } from "./tools/archonComponents.js"
import { registerArchonDoc } from "./tools/archonDoc.js"
import { registerArchonSymbol } from "./tools/archonSymbol.js"

const packageJson = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"))

export const createServer = (config) => {
  const started = Date.now()
  const catalog = buildCatalog(config)
  const docs = config.docsPath
    ? buildDocsCatalog(config.docsPath)
    : {
        documents: [],
        errors: [],
        unavailableMessage: describeMissingSource(SOURCE_FLAGS.docs.label, SOURCE_FLAGS.docs.flag, SOURCE_FLAGS.docs.env, config.diagnostics),
      }
  const elapsed = Date.now() - started

  // stdout e o canal do protocolo: todo log vai para stderr.
  console.error(`[mcp-archon] ${catalog.symbols.length} simbolos de ${catalog.sources.join(", ") || "nenhuma fonte"} e ${docs.documents.length} documentos em ${elapsed}ms`)
  config.diagnostics.forEach((line) => console.error(`[mcp-archon] ${line}`))
  catalog.errors.slice(0, 5).forEach((line) => console.error(`[mcp-archon] erro de parse: ${line}`))

  const server = new McpServer(
    { name: "mcp-archon", version: packageJson.version },
    { capabilities: { tools: {} }, instructions: "Catalogo de simbolos e documentacao dos frameworks Archon (archon-framework em .NET e archon-ui em React). Consulte antes de escrever codigo que consome o Archon." }
  )

  const context = { config, getCatalog: () => catalog, getDocs: () => docs }

  registerArchonSymbol(server, context)
  registerArchonComponents(server, context)
  registerArchonDoc(server, context)

  return { server, catalog, docs }
}
