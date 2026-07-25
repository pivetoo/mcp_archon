import { readdirSync } from "node:fs"
import { join, relative } from "node:path"

const DEFAULT_IGNORED = new Set([
  "bin", "obj", "node_modules", ".git", ".vs", ".idea", "dist", "coverage", "TestResults",
])

/** Lista arquivos recursivamente filtrando por extensao, pulando diretorios de build e dependencia. */
export const walkFiles = ({ root, extensions, ignoredDirectories = DEFAULT_IGNORED }) => {
  const results = []
  const pending = [root]

  while (pending.length > 0) {
    const directory = pending.pop()
    let entries

    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      const absolutePath = join(directory, entry.name)

      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          pending.push(absolutePath)
        }
        continue
      }

      if (extensions.some((extension) => entry.name.endsWith(extension))) {
        results.push({ absolutePath, relativePath: relative(root, absolutePath) })
      }
    }
  }

  return results.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}
