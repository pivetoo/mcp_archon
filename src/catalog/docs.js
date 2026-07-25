import { readFileSync } from "node:fs"
import { walkFiles } from "./walk.js"

/** Busca em pt-BR sem acento: "convencoes" tem que achar "Convenções". */
export const normalize = (text) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()

const splitSections = (content) => {
  const lines = content.split(/\r?\n/)
  const sections = []
  let current = { title: null, level: 0, line: 1, body: [] }

  for (let index = 0; index < lines.length; index += 1) {
    const headingMatch = lines[index].match(/^(?<hashes>#{2,4})\s+(?<title>.+)$/)

    if (headingMatch) {
      if (current.title || current.body.some((line) => line.trim())) {
        sections.push(current)
      }

      current = {
        title: headingMatch.groups.title.trim(),
        level: headingMatch.groups.hashes.length,
        line: index + 1,
        body: [],
      }
      continue
    }

    current.body.push(lines[index])
  }

  if (current.title || current.body.some((line) => line.trim())) {
    sections.push(current)
  }

  return sections.map((section) => ({
    ...section,
    body: section.body.join("\n").trim(),
  }))
}

/**
 * Carrega a narrativa curada de `.playbook/system-docs`, seccionada por titulo. Esta parte da
 * documentacao e escrita a mao de proposito: ela responde "por que" e "em que ordem", que nao se
 * extrai do fonte. O catalogo de simbolos, esse sim, vem do codigo.
 */
export const buildDocsCatalog = (docsPath) => {
  const files = walkFiles({ root: docsPath, extensions: [".md"] })
  const documents = []
  const errors = []

  for (const file of files) {
    try {
      const content = readFileSync(file.absolutePath, "utf8")
      const titleMatch = content.match(/^#\s+(?<title>.+)$/m)

      documents.push({
        id: file.relativePath.replace(/\.md$/, ""),
        title: titleMatch?.groups.title.trim() ?? file.relativePath,
        file: file.relativePath,
        lineCount: content.split(/\r?\n/).length,
        content,
        sections: splitSections(content),
      })
    } catch (error) {
      errors.push(`${file.relativePath}: ${error.message}`)
    }
  }

  return { root: docsPath, documents, errors }
}

const scoreSection = (section, documentId, normalizedQuery) => {
  const title = normalize(section.title ?? "")
  const body = normalize(section.body)

  let score = 0

  if (title === normalizedQuery) score += 100
  else if (title.includes(normalizedQuery)) score += 60
  if (normalize(documentId).includes(normalizedQuery)) score += 25

  const occurrences = body.split(normalizedQuery).length - 1
  score += Math.min(occurrences * 8, 40)

  return score
}

export const searchDocSections = (documents, { query, doc, limit = 3 }) => {
  const normalizedQuery = normalize(query)
  const results = []

  for (const document of documents) {
    if (doc && document.id !== doc) {
      continue
    }

    for (const section of document.sections) {
      const score = scoreSection(section, document.id, normalizedQuery)
      if (score > 0) {
        results.push({ document, section, score })
      }
    }
  }

  return results.sort((left, right) => right.score - left.score).slice(0, limit)
}
