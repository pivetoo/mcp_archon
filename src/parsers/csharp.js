import { readFileSync } from "node:fs"

const TYPE_KINDS = "record\\s+class|record\\s+struct|record|class|interface|struct|enum"

const TYPE_MODIFIERS = "public|internal|private|protected|static|abstract|sealed|partial|readonly|file|new"

const MEMBER_MODIFIERS =
  "public|protected|internal|private|static|virtual|override|abstract|sealed|async|readonly|const|extern|unsafe|new|partial|required|volatile"

const TYPE_RE = new RegExp(
  `^\\s*(?<mods>(?:(?:${TYPE_MODIFIERS})\\s+)*)(?<kind>${TYPE_KINDS})\\s+(?<name>[A-Za-z_]\\w*)(?<generics><[^{;]*?>)?(?<rest>[^{]*)`
)

const MEMBER_RE = new RegExp(
  `^\\s*(?<mods>(?:(?:${MEMBER_MODIFIERS})\\s+)*)(?<returnType>[A-Za-z_][\\w.]*(?:<[^()]*>)?(?:\\[\\])?\\??)\\s+(?<name>[A-Za-z_]\\w*)(?<generics><[^(){}]*>)?\\s*(?<tail>[({=;])`
)

const CONSTRUCTOR_RE = new RegExp(`^\\s*(?<mods>(?:(?:${MEMBER_MODIFIERS})\\s+)*)(?<name>[A-Za-z_]\\w*)\\s*\\(`)

const NAMESPACE_RE = /^\s*namespace\s+(?<name>[A-Za-z_][\w.]*)\s*(?<terminator>[;{])?/

const ATTRIBUTE_LINE_RE = /^\s*\[(?<body>.+)\]\s*$/

const VISIBILITY_KEYWORDS = ["public", "protected", "internal", "private"]

const NON_MEMBER_KEYWORDS = new Set([
  "if", "for", "foreach", "while", "switch", "return", "using", "lock", "catch", "try", "else",
  "do", "throw", "yield", "await", "namespace", "where", "get", "set", "init", "add", "remove",
  "case", "default", "when", "in", "is", "as", "new",
])

/**
 * Remove comentarios de linha, literais de string e de char antes de contar chaves. Sem isso, um
 * `"{"` dentro de string desalinha a contagem de profundidade e o parser passa a atribuir membros
 * ao tipo errado.
 */
const stripNoise = (line) => {
  let output = ""
  let index = 0

  while (index < line.length) {
    const character = line[index]

    if (character === "/" && line[index + 1] === "/") {
      break
    }

    if (character === '"') {
      const isVerbatim = index > 0 && (line[index - 1] === "@" || line[index - 1] === "$")
      index += 1
      while (index < line.length) {
        if (line[index] === "\\" && !isVerbatim) {
          index += 2
          continue
        }
        if (line[index] === '"') {
          index += 1
          break
        }
        index += 1
      }
      output += '""'
      continue
    }

    if (character === "'") {
      index += 1
      while (index < line.length) {
        if (line[index] === "\\") {
          index += 2
          continue
        }
        if (line[index] === "'") {
          index += 1
          break
        }
        index += 1
      }
      output += "''"
      continue
    }

    output += character
    index += 1
  }

  return output
}

const countBraces = (line) => {
  const clean = stripNoise(line)
  let delta = 0

  for (const character of clean) {
    if (character === "{") delta += 1
    if (character === "}") delta -= 1
  }

  return delta
}

/** Converte o bloco `///` em texto corrido, preservando o conteudo de `<summary>` quando existir. */
const formatDocComment = (docLines) => {
  if (docLines.length === 0) {
    return null
  }

  const raw = docLines.map((line) => line.replace(/^\s*\/\/\/\s?/, "")).join("\n")
  const summaryMatch = raw.match(/<summary>(?<body>[\s\S]*?)<\/summary>/)
  const body = summaryMatch ? summaryMatch.groups.body : raw

  return body
    .replace(/<\/?(?:c|para|see cref=|paramref name=|typeparamref name=)[^>]*>/g, "")
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .trim() || null
}

const balancedParens = (text) => {
  const clean = stripNoise(text)
  let depth = 0

  for (const character of clean) {
    if (character === "(") depth += 1
    if (character === ")") depth -= 1
  }

  return depth <= 0
}

/**
 * Assinaturas quebradas em varias linhas sao comuns no framework. Junta linhas ate fechar os
 * parenteses, para nao publicar assinatura truncada no catalogo.
 */
const joinDeclaration = (lines, startIndex, maxLines = 15) => {
  let raw = lines[startIndex].trim()
  let index = startIndex

  while (!balancedParens(raw) && index - startIndex < maxLines && index + 1 < lines.length) {
    index += 1
    raw += ` ${lines[index].trim()}`
  }

  const signature = raw
    .replace(/\s*\{\s*$/, "")
    .replace(/\s*=>\s*$/, "")
    .replace(/;\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()

  return { signature, raw, endsWithSemicolon: /;\s*$/.test(raw) }
}

const joinSignature = (lines, startIndex) => joinDeclaration(lines, startIndex).signature

const visibilityOf = (modifiers, fallback) => {
  const found = VISIBILITY_KEYWORDS.find((keyword) => modifiers.includes(keyword))
  return found ?? fallback
}

const parseBaseTypes = (rest) => {
  if (!rest) {
    return []
  }

  const withoutConstraints = rest.split(/\bwhere\b/)[0]
  const colonIndex = withoutConstraints.indexOf(":")
  if (colonIndex === -1) {
    return []
  }

  return splitTopLevel(withoutConstraints.slice(colonIndex + 1))
    .map((entry) => entry.trim())
    .filter(Boolean)
}

/** Divide por virgula ignorando as que estao dentro de generics, para nao quebrar `IService<A, B>`. */
const splitTopLevel = (text) => {
  const parts = []
  let depth = 0
  let current = ""

  for (const character of text) {
    if (character === "<" || character === "(") depth += 1
    if (character === ">" || character === ")") depth -= 1

    if (character === "," && depth === 0) {
      parts.push(current)
      current = ""
      continue
    }

    current += character
  }

  if (current.trim()) {
    parts.push(current)
  }

  return parts
}

const memberKindFor = (tail, signature) => {
  if (tail === "(") {
    return "method"
  }

  if (tail === "{" || (tail === "=>" && !signature.includes("("))) {
    return "property"
  }

  if (tail === "=" || tail === ";") {
    return "field"
  }

  return "property"
}

/**
 * Extrai os simbolos de um arquivo `.cs`. E um parser heuristico, nao um compilador: cobre as formas
 * usadas pelo framework (tipos, membros publicos, atributos, extension methods e doc XML) e ignora
 * o que nao encaixar, em vez de adivinhar.
 */
export const parseCSharpFile = ({ absolutePath, relativePath, project }) => {
  const content = readFileSync(absolutePath, "utf8")
  const lines = content.split(/\r?\n/)
  const symbols = []

  let namespaceName = null
  let depth = 0
  let inBlockComment = false
  let pendingDoc = []
  let pendingAttributes = []
  const typeStack = []

  const currentType = () => (typeStack.length > 0 ? typeStack[typeStack.length - 1] : null)

  /**
   * Fecha o escopo APOS contar as chaves da linha. O corpo do tipo vive em `bodyDepth`; enquanto a
   * chave de abertura ainda nao chegou (estilo Allman, o do framework), a profundidade e menor e o
   * tipo nao pode ser desempilhado.
   */
  const advance = (line) => {
    depth += countBraces(line)

    const top = currentType()
    if (top && !top.bodyOpened && depth >= top.bodyDepth) {
      top.bodyOpened = true
    }

    while (typeStack.length > 0 && currentType().bodyOpened && depth < currentType().bodyDepth) {
      typeStack.pop()
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const trimmed = line.trim()

    if (inBlockComment) {
      if (trimmed.includes("*/")) {
        inBlockComment = false
      }
      continue
    }

    if (trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/")) {
        inBlockComment = true
      }
      continue
    }

    if (trimmed.startsWith("///")) {
      pendingDoc.push(line)
      continue
    }

    if (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("#")) {
      continue
    }

    const attributeMatch = trimmed.match(ATTRIBUTE_LINE_RE)
    if (attributeMatch) {
      pendingAttributes.push(attributeMatch.groups.body.trim())
      continue
    }

    const namespaceMatch = trimmed.match(NAMESPACE_RE)
    if (namespaceMatch) {
      namespaceName = namespaceMatch.groups.name
      advance(line)
      pendingDoc = []
      pendingAttributes = []
      continue
    }

    const owner = currentType()
    const typeMatch = trimmed.match(TYPE_RE)

    if (typeMatch && !NON_MEMBER_KEYWORDS.has(typeMatch.groups.name)) {
      const modifiers = typeMatch.groups.mods.trim().split(/\s+/).filter(Boolean)
      const kind = typeMatch.groups.kind.replace(/\s+/g, " ")
      const generics = typeMatch.groups.generics ?? ""
      const declaration = joinDeclaration(lines, index)
      const signature = declaration.signature

      const symbol = {
        name: typeMatch.groups.name,
        displayName: `${typeMatch.groups.name}${generics}`,
        kind: kind.startsWith("record") ? "record" : kind,
        visibility: visibilityOf(modifiers, "internal"),
        modifiers,
        project,
        namespace: namespaceName,
        file: relativePath,
        line: index + 1,
        signature,
        summary: formatDocComment(pendingDoc),
        attributes: pendingAttributes,
        baseTypes: parseBaseTypes(typeMatch.groups.rest),
        declaringType: owner ? owner.name : null,
        members: [],
      }

      symbols.push(symbol)
      if (owner) {
        owner.symbol.members.push({ name: symbol.name, kind: symbol.kind, line: symbol.line })
      }

      if (!declaration.endsWithSemicolon) {
        typeStack.push({ name: symbol.name, kind: symbol.kind, bodyDepth: depth + 1, bodyOpened: false, symbol })
      }

      advance(line)
      pendingDoc = []
      pendingAttributes = []
      continue
    }

    if (owner) {
      const member = parseMember({ lines, index, trimmed, owner, namespaceName, project, relativePath, pendingDoc, pendingAttributes })
      if (member) {
        symbols.push(member)
        owner.symbol.members.push({ name: member.name, kind: member.kind, line: member.line })
        pendingDoc = []
        pendingAttributes = []
        advance(line)
        continue
      }
    }

    advance(line)
    if (trimmed.length > 0) {
      pendingDoc = []
      pendingAttributes = []
    }
  }

  return symbols
}

const parseMember = ({ lines, index, trimmed, owner, namespaceName, project, relativePath, pendingDoc, pendingAttributes }) => {
  const isInterface = owner.kind === "interface"

  if (owner.kind === "enum") {
    const enumMatch = trimmed.match(/^(?<name>[A-Za-z_]\w*)\s*(?:=\s*(?<value>[^,]+))?,?$/)
    if (!enumMatch) {
      return null
    }

    return {
      name: enumMatch.groups.name,
      displayName: enumMatch.groups.name,
      kind: "enum-member",
      visibility: "public",
      modifiers: [],
      project,
      namespace: namespaceName,
      file: relativePath,
      line: index + 1,
      signature: trimmed.replace(/,$/, ""),
      summary: formatDocComment(pendingDoc),
      attributes: pendingAttributes,
      declaringType: owner.name,
    }
  }

  const constructorMatch = trimmed.match(CONSTRUCTOR_RE)
  if (constructorMatch && constructorMatch.groups.name === owner.name) {
    const modifiers = constructorMatch.groups.mods.trim().split(/\s+/).filter(Boolean)
    if (visibilityOf(modifiers, null) === null) {
      return null
    }

    return {
      name: owner.name,
      displayName: `${owner.name}(...)`,
      kind: "constructor",
      visibility: visibilityOf(modifiers, "private"),
      modifiers,
      project,
      namespace: namespaceName,
      file: relativePath,
      line: index + 1,
      signature: joinSignature(lines, index),
      summary: formatDocComment(pendingDoc),
      attributes: pendingAttributes,
      declaringType: owner.name,
    }
  }

  const memberMatch = trimmed.match(MEMBER_RE)
  if (!memberMatch) {
    return null
  }

  const modifiers = memberMatch.groups.mods.trim().split(/\s+/).filter(Boolean)
  const visibility = visibilityOf(modifiers, isInterface ? "public" : null)

  if (visibility === null || visibility === "private") {
    return null
  }

  const { name, returnType, tail } = memberMatch.groups
  if (NON_MEMBER_KEYWORDS.has(name) || NON_MEMBER_KEYWORDS.has(returnType)) {
    return null
  }

  const signature = joinSignature(lines, index)
  const kind = memberKindFor(tail === "=" ? ";" : tail, signature)
  const isExtension = kind === "method" && /\(\s*this\s+/.test(signature)
  const extendsType = isExtension ? signature.match(/\(\s*this\s+(?<target>[\w.<>\[\]]+)/)?.groups.target ?? null : null

  return {
    name,
    displayName: kind === "method" ? `${name}(...)` : name,
    kind,
    visibility,
    modifiers,
    project,
    namespace: namespaceName,
    file: relativePath,
    line: index + 1,
    signature,
    summary: formatDocComment(pendingDoc),
    attributes: pendingAttributes,
    declaringType: owner.name,
    returnType,
    isExtension,
    extendsType,
  }
}
