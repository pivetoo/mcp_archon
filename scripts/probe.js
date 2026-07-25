#!/usr/bin/env node
/**
 * Cliente MCP de linha de comando para exercitar o servidor do jeito que um cliente real exercita:
 * handshake, tools/list e tools/call sobre stdio. Nao faz parte do pacote publicado.
 *
 *   node scripts/probe.js                                   lista as tools
 *   node scripts/probe.js archon_symbol '{"query":"Entity"}' chama uma tool
 */
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

const serverPath = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "index.js")
const [toolName, rawArguments] = process.argv.slice(2)

const client = new Client({ name: "mcp-archon-probe", version: "0.1.0" })
const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath], stderr: "inherit" })

await client.connect(transport)

if (!toolName) {
  const { tools } = await client.listTools()
  console.log(`tools disponiveis: ${tools.length}\n`)
  for (const tool of tools) {
    console.log(`- ${tool.name}: ${tool.description}`)
    console.log(`  parametros: ${Object.keys(tool.inputSchema?.properties ?? {}).join(", ")}\n`)
  }
} else {
  const result = await client.callTool({ name: toolName, arguments: rawArguments ? JSON.parse(rawArguments) : {} })
  if (result.isError) {
    console.log("[tool retornou isError]")
  }
  for (const item of result.content ?? []) {
    console.log(item.type === "text" ? item.text : JSON.stringify(item))
  }
}

await client.close()
