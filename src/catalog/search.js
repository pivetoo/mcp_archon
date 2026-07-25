const TYPE_KINDS = new Set(["class", "interface", "record", "struct", "enum"])

/** Subsequencia: "UATR" casa com "UseArchonTenantResolution". Serve para sigla e nome parcial. */
const isSubsequence = (needle, haystack) => {
  let cursor = 0

  for (const character of haystack) {
    if (character === needle[cursor]) {
      cursor += 1
      if (cursor === needle.length) {
        return true
      }
    }
  }

  return cursor === needle.length
}

const scoreSymbol = (symbol, query) => {
  const name = symbol.name
  const lowerName = name.toLowerCase()
  const lowerQuery = query.toLowerCase()

  let score = 0

  if (name === query) {
    score = 100
  } else if (lowerName === lowerQuery) {
    score = 90
  } else if (lowerName.startsWith(lowerQuery)) {
    score = 70
  } else if (lowerName.includes(lowerQuery)) {
    score = 50
  } else if (symbol.declaringType && symbol.declaringType.toLowerCase().includes(lowerQuery)) {
    score = 35
  } else if (symbol.signature && symbol.signature.toLowerCase().includes(lowerQuery)) {
    score = 25
  } else if (isSubsequence(lowerQuery, lowerName)) {
    score = 15
  } else {
    return 0
  }

  if (symbol.visibility === "public") score += 6
  if (!symbol.isTest) score += 8
  if (TYPE_KINDS.has(symbol.kind)) score += 4
  if (symbol.summary) score += 2
  if (symbol.isExtension) score += 2

  return score
}

/** Aceita `Tipo.Membro` alem do nome solto, porque e assim que a duvida costuma chegar. */
const splitQualifiedQuery = (query) => {
  const parts = query.split(".")
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null
  }

  return { declaringType: parts[0], member: parts[1] }
}

export const searchSymbols = (symbols, { query, kind, project, source, includeTests = false, limit = 20 }) => {
  const pool = symbols.filter((symbol) => {
    if (!includeTests && symbol.isTest) return false
    if (kind && symbol.kind !== kind) return false
    if (project && symbol.project !== project) return false
    if (source && symbol.source !== source) return false
    return true
  })

  if (!query) {
    return pool.slice(0, limit)
  }

  const qualified = splitQualifiedQuery(query)
  if (qualified) {
    const matches = pool
      .filter(
        (symbol) =>
          symbol.declaringType?.toLowerCase() === qualified.declaringType.toLowerCase() &&
          symbol.name.toLowerCase().includes(qualified.member.toLowerCase())
      )
      .sort((left, right) => right.name.length - left.name.length)

    if (matches.length > 0) {
      return matches.slice(0, limit)
    }
  }

  return pool
    .map((symbol) => ({ symbol, score: scoreSymbol(symbol, query) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.symbol.name.length - right.symbol.name.length)
    .slice(0, limit)
    .map((entry) => entry.symbol)
}

/**
 * Detalhe do simbolo conforme a fonte. No `archon-ui`, o que interessa em um componente sao as props
 * — que ficam numa interface `XProps` do mesmo arquivo, nao no componente.
 */
export const describeSymbol = (symbols, symbol) => {
  if (symbol.source === "archon-ui") {
    if (symbol.members?.length > 0) {
      return { members: symbol.members, implementations: [] }
    }

    const props = symbols.find((candidate) => candidate.name === `${symbol.name}Props` && candidate.file === symbol.file)
    return { members: props?.members ?? [], implementations: [], propsType: props?.name ?? null }
  }

  return { members: findMembersOf(symbols, symbol.name), implementations: findImplementations(symbols, symbol.name) }
}

export const findMembersOf = (symbols, typeName) =>
  symbols.filter((symbol) => symbol.declaringType === typeName && symbol.kind !== "class" && symbol.kind !== "interface")

export const findImplementations = (symbols, typeName) =>
  symbols.filter((symbol) => TYPE_KINDS.has(symbol.kind) && symbol.baseTypes?.some((base) => base.replace(/<.*/, "") === typeName))
