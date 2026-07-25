#!/usr/bin/env node
import { loadConfig } from "../config.js"
import { buildFrameworkCatalog } from "../catalog/framework.js"

const config = loadConfig()

if (!config.frameworkPath) {
  console.error("archon-framework nao resolvido.")
  config.diagnostics.forEach((line) => console.error(`  - ${line}`))
  process.exit(1)
}

const started = Date.now()
const catalog = buildFrameworkCatalog(config.frameworkPath)
const elapsed = Date.now() - started

const byKind = Object.create(null)
const byProject = Object.create(null)

for (const symbol of catalog.symbols) {
  byKind[symbol.kind] = (byKind[symbol.kind] ?? 0) + 1
  byProject[symbol.project] = (byProject[symbol.project] ?? 0) + 1
}

console.log(`arquivos: ${catalog.fileCount}`)
console.log(`simbolos: ${catalog.symbols.length} (${elapsed}ms)`)
console.log(`de teste: ${catalog.symbols.filter((symbol) => symbol.isTest).length}`)
console.log("\npor tipo:")
Object.entries(byKind).sort((a, b) => b[1] - a[1]).forEach(([kind, count]) => console.log(`  ${kind.padEnd(14)} ${count}`))
console.log("\npor projeto:")
Object.entries(byProject).sort((a, b) => b[1] - a[1]).forEach(([project, count]) => console.log(`  ${project.padEnd(22)} ${count}`))

if (catalog.errors.length > 0) {
  console.log(`\nerros de parse: ${catalog.errors.length}`)
  catalog.errors.slice(0, 10).forEach((line) => console.log(`  ${line}`))
}

const filter = process.argv.find((argument) => argument.startsWith("--grep="))
if (filter) {
  const term = filter.slice("--grep=".length).toLowerCase()
  console.log(`\nsimbolos contendo "${term}":`)
  catalog.symbols
    .filter((symbol) => symbol.name.toLowerCase().includes(term))
    .slice(0, 40)
    .forEach((symbol) => console.log(`  [${symbol.kind}] ${symbol.declaringType ? `${symbol.declaringType}.` : ""}${symbol.name} — ${symbol.file}:${symbol.line}\n      ${symbol.signature}`))
}
