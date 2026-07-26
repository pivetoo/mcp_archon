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

// Palavras curtas de ligacao nao ajudam a distinguir secao nenhuma em pt-BR.
const STOP_WORDS = new Set([
  "a", "o", "as", "os", "de", "da", "do", "das", "dos", "e", "em", "no", "na", "nos", "nas",
  "um", "uma", "por", "que", "com", "para", "ao", "aos", "the", "of", "to", "is",
])

const tokenize = (text) =>
  normalize(text)
    .split(/[^a-z0-9_.-]+/)
    .filter((term) => term.length > 2 && !STOP_WORDS.has(term))

const countOccurrences = (haystack, needle) => (needle ? haystack.split(needle).length - 1 : 0)

/**
 * Pontua por TERMO, e nao pela consulta inteira como substring literal. A versao anterior so achava
 * quando a frase aparecia identica no texto — ou seja, falhava em qualquer pergunta escrita em
 * linguagem natural, que e exatamente para o que esta tool existe.
 *
 * A frase exata continua valendo mais: quem acerta o titulo da secao deve receber ela em primeiro.
 */
const scoreSection = (section, documentId, normalizedQuery, terms) => {
  const title = normalize(section.title ?? "")
  const body = normalize(section.body)
  const identifier = normalize(documentId)

  let score = 0

  if (title === normalizedQuery) score += 100
  else if (normalizedQuery && title.includes(normalizedQuery)) score += 60
  if (normalizedQuery && identifier.includes(normalizedQuery)) score += 25
  score += Math.min(countOccurrences(body, normalizedQuery) * 8, 40)

  let matchedTerms = 0
  for (const term of terms) {
    let termScore = 0

    if (title.includes(term)) {
      termScore += 30
    }

    if (identifier.includes(term)) {
      termScore += 10
    }

    const occurrences = countOccurrences(body, term)
    if (occurrences > 0) {
      termScore += Math.min(4 + occurrences * 2, 20)
    }

    if (termScore > 0) {
      matchedTerms += 1
      score += termScore
    }
  }

  // Secao que casa com mais termos da pergunta ganha da que casa com um so, muitas vezes.
  if (terms.length > 1 && matchedTerms > 1) {
    score += matchedTerms * 15
  }

  return score
}

export const searchDocSections = (documents, { query, doc, limit = 3 }) => {
  const normalizedQuery = normalize(query)
  const terms = tokenize(query)
  const results = []

  for (const document of documents) {
    if (doc && document.id !== doc) {
      continue
    }

    for (const section of document.sections) {
      const score = scoreSection(section, document.id, normalizedQuery, terms)
      if (score > 0) {
        results.push({ document, section, score })
      }
    }
  }

  return results.sort((left, right) => right.score - left.score).slice(0, limit)
}
