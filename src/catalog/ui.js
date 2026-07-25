import { existsSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { parseTypeScriptFile } from "../parsers/typescript.js"
import { walkFiles } from "./walk.js"

const CANDIDATE_SUFFIXES = [".ts", ".tsx", "/index.ts", "/index.tsx", ".js"]

/** Resolve o especificador relativo de um `export ... from` para um arquivo real do repositorio. */
const resolveModule = ({ specifier, fromFile, root }) => {
  if (!specifier.startsWith(".")) {
    return null
  }

  const base = resolve(dirname(join(root, fromFile)), specifier)

  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = `${base}${suffix}`
    if (existsSync(candidate)) {
      return relative(root, candidate)
    }
  }

  return null
}

const categoryOf = (relativePath) => {
  if (relativePath.startsWith("src/components/ui")) return "componente"
  if (relativePath.startsWith("src/components/routing")) return "roteamento"
  if (relativePath.startsWith("src/components")) return "componente"
  if (relativePath.startsWith("src/hooks")) return "hook"
  if (relativePath.startsWith("src/services")) return "service"
  if (relativePath.startsWith("src/contexts")) return "context"
  if (relativePath.startsWith("src/i18n")) return "i18n"
  if (relativePath.startsWith("src/types")) return "type"
  if (relativePath.startsWith("src/lib")) return "util"
  if (relativePath.startsWith("src/examples")) return "exemplo"
  return "outro"
}

/**
 * Le o fonte do `archon-ui` e devolve o catalogo de simbolos, marcando quais sao de fato importaveis
 * de `archon-ui` — a partir do grafo de reexportacao que sai de `src/index.ts`. Sem isso, o catalogo
 * afirmaria que qualquer coisa do `src/` esta disponivel para o consumidor, o que nao e verdade.
 */
export const buildUiCatalog = (uiPath) => {
  const files = walkFiles({ root: uiPath, extensions: [".ts", ".tsx"] }).filter(
    (file) => file.relativePath.startsWith("src/") && !file.relativePath.endsWith(".d.ts")
  )

  const parsedByFile = new Map()
  const errors = []

  for (const file of files) {
    try {
      parsedByFile.set(file.relativePath, parseTypeScriptFile(file))
    } catch (error) {
      errors.push(`${file.relativePath}: ${error.message}`)
    }
  }

  const publicFiles = new Set()
  const entryPoint = "src/index.ts"
  const pending = parsedByFile.has(entryPoint) ? [entryPoint] : []

  while (pending.length > 0) {
    const current = pending.pop()
    if (publicFiles.has(current)) {
      continue
    }

    publicFiles.add(current)
    const parsed = parsedByFile.get(current)
    if (!parsed) {
      continue
    }

    for (const specifier of parsed.reExports) {
      const target = resolveModule({ specifier, fromFile: current, root: uiPath })
      if (target && parsedByFile.has(target)) {
        pending.push(target)
      }
    }
  }

  const symbols = []

  for (const [relativePath, parsed] of parsedByFile) {
    const isPublic = publicFiles.has(relativePath)
    const category = categoryOf(relativePath)

    for (const symbol of parsed.symbols) {
      symbols.push({
        ...symbol,
        source: "archon-ui",
        project: category,
        module: isPublic ? "archon-ui" : `(interno) ${relativePath}`,
        isPublicApi: isPublic,
        isTest: category === "exemplo",
        visibility: "public",
        attributes: [],
        baseTypes: [],
        declaringType: null,
      })
    }
  }

  return { source: "archon-ui", root: uiPath, fileCount: files.length, symbols, errors, publicFileCount: publicFiles.size }
}
