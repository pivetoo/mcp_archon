const MEMBER_ORDER = ["constructor", "property", "method", "field", "enum-member"]

const sortMembers = (members) =>
  [...members].sort((left, right) => {
    const leftIndex = MEMBER_ORDER.indexOf(left.kind)
    const rightIndex = MEMBER_ORDER.indexOf(right.kind)
    return leftIndex - rightIndex || left.line - right.line
  })

export const formatSymbol = (symbol, { members = [], implementations = [], verbose = true } = {}) => {
  const lines = []
  const qualifier = symbol.declaringType ? `${symbol.declaringType}.` : ""

  lines.push(`## ${qualifier}${symbol.displayName ?? symbol.name}`)
  lines.push("")
  lines.push(`- tipo: ${symbol.kind}${symbol.isExtension ? ` (extension method sobre ${symbol.extendsType})` : ""}`)
  lines.push(`- origem: ${symbol.source}${symbol.project ? ` / ${symbol.project}` : ""}`)
  if (symbol.namespace) lines.push(`- namespace: ${symbol.namespace}`)
  if (symbol.module) lines.push(`- import: ${symbol.module}`)
  lines.push(`- local: ${symbol.file}:${symbol.line}`)
  if (symbol.isTest) lines.push("- ATENCAO: simbolo de projeto de teste, nao faz parte da API publica")

  if (symbol.signature) {
    lines.push("")
    lines.push("```" + (symbol.source === "archon-ui" ? "ts" : "csharp"))
    lines.push(symbol.signature)
    lines.push("```")
  }

  if (symbol.summary) {
    lines.push("")
    lines.push(symbol.summary)
  }

  if (symbol.attributes?.length) {
    lines.push("")
    lines.push(`Atributos: ${symbol.attributes.map((attribute) => `[${attribute}]`).join(" ")}`)
  }

  if (symbol.baseTypes?.length) {
    lines.push("")
    lines.push(`Herda de / implementa: ${symbol.baseTypes.join(", ")}`)
  }

  if (verbose && members.length > 0) {
    lines.push("")
    lines.push(`### Membros (${members.length})`)
    lines.push("")
    for (const member of sortMembers(members)) {
      const summary = member.summary ? ` — ${truncate(member.summary, 140)}` : ""
      lines.push(`- \`${member.signature}\` (:${member.line})${summary}`)
    }
  }

  if (verbose && implementations.length > 0) {
    lines.push("")
    lines.push(`### Implementacoes / heranca (${implementations.length})`)
    lines.push("")
    for (const implementation of implementations) {
      lines.push(`- ${implementation.name} — ${implementation.file}:${implementation.line}`)
    }
  }

  return lines.join("\n")
}

export const formatSymbolLine = (symbol) => {
  const qualifier = symbol.declaringType ? `${symbol.declaringType}.` : ""
  const summary = symbol.summary ? ` — ${truncate(symbol.summary, 110)}` : ""
  return `- **${qualifier}${symbol.displayName ?? symbol.name}** \`${symbol.kind}\` ${symbol.file}:${symbol.line}${summary}`
}

export const truncate = (text, maxLength) =>
  text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}...`
