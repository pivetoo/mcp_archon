import { describeMissingSource, SOURCE_FLAGS } from "../config.js"
import { buildFrameworkCatalog } from "./framework.js"
import { buildUiCatalog } from "./ui.js"

/**
 * Monta o catalogo unico a partir das fontes resolvidas. Fonte ausente nao vira catalogo vazio
 * silencioso: fica registrada em `notes` e a mensagem chega ao cliente quando a tool nao tem o que
 * responder.
 */
export const buildCatalog = (config) => {
  const symbols = []
  const sources = []
  const errors = []
  const notes = []

  if (config.frameworkPath) {
    const catalog = buildFrameworkCatalog(config.frameworkPath)
    symbols.push(...catalog.symbols)
    sources.push("archon-framework")
    errors.push(...catalog.errors.map((error) => `archon-framework: ${error}`))
  } else {
    notes.push(describeMissingSource(SOURCE_FLAGS.framework.label, SOURCE_FLAGS.framework.flag, SOURCE_FLAGS.framework.env, config.diagnostics))
  }

  if (config.uiPath) {
    const catalog = buildUiCatalog(config.uiPath)
    symbols.push(...catalog.symbols)
    sources.push("archon-ui")
    errors.push(...catalog.errors.map((error) => `archon-ui: ${error}`))
  } else {
    notes.push(describeMissingSource(SOURCE_FLAGS.ui.label, SOURCE_FLAGS.ui.flag, SOURCE_FLAGS.ui.env, config.diagnostics))
  }

  const unavailableMessage =
    notes.length > 0 ? notes.join("\n\n") : "Nenhum simbolo indexado, apesar das fontes terem sido resolvidas."

  return { symbols, sources, errors, notes, unavailableMessage }
}
