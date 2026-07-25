#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { loadConfig } from "./config.js"
import { createServer } from "./server.js"

const HELP = `mcp-archon — servidor MCP com o catalogo de simbolos e a documentacao dos frameworks Archon.

Uso:
  mcp-archon [opcoes]

Opcoes:
  --root <caminho>       raiz do monorepo (deriva as tres fontes abaixo)
  --framework <caminho>  caminho do archon-framework
  --ui <caminho>         caminho do archon-ui
  --docs <caminho>       caminho de .playbook/system-docs
  --help                 mostra esta ajuda

Variaveis de ambiente equivalentes: ARCHON_MONOREPO_ROOT, ARCHON_FRAMEWORK_PATH,
ARCHON_UI_PATH, ARCHON_DOCS_PATH.

Sem nenhuma opcao, o servidor sobe a arvore de diretorios a partir do cwd procurando
frameworks/archon-framework.`

const main = async () => {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(HELP)
    return
  }

  const config = loadConfig()
  const { server } = createServer(config)

  await server.connect(new StdioServerTransport())
}

main().catch((error) => {
  console.error(`[mcp-archon] falha ao iniciar: ${error.stack ?? error.message}`)
  process.exit(1)
})
