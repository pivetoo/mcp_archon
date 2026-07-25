import { parseCSharpFile } from "../parsers/csharp.js"
import { walkFiles } from "./walk.js"

const PROJECT_RE = /(?:^|[\\/])(Archon\.[A-Za-z]+)(?:[\\/]|$)/

const projectOf = (relativePath) => relativePath.match(PROJECT_RE)?.[1] ?? "Archon"

const isTestFile = (relativePath) =>
  relativePath.includes("Archon.Testing") &&
  (/Tests?\.cs$/.test(relativePath) || /[\\/]Fixtures?[\\/]/.test(relativePath))

/**
 * Le o fonte do `archon-framework` e devolve o catalogo de simbolos. Roda no startup do servidor:
 * o catalogo nasce do codigo, e nao de uma lista escrita a mao — foi lista a mao que deixou a
 * documentacao quatro meses defasada.
 */
export const buildFrameworkCatalog = (frameworkPath) => {
  const files = walkFiles({ root: frameworkPath, extensions: [".cs"] })
  const symbols = []
  const errors = []

  for (const file of files) {
    if (file.relativePath.endsWith(".AssemblyInfo.cs") || file.relativePath.endsWith(".GlobalUsings.g.cs")) {
      continue
    }

    try {
      const parsed = parseCSharpFile({
        absolutePath: file.absolutePath,
        relativePath: file.relativePath,
        project: projectOf(file.relativePath),
      })

      const isTest = isTestFile(file.relativePath)
      for (const symbol of parsed) {
        symbols.push({ ...symbol, source: "archon-framework", isTest })
      }
    } catch (error) {
      errors.push(`${file.relativePath}: ${error.message}`)
    }
  }

  return { source: "archon-framework", root: frameworkPath, fileCount: files.length, symbols, errors }
}
