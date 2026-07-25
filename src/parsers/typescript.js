import { readFileSync } from "node:fs"

const DECLARATION_RE =
  /^(?<export>export\s+)?(?<mods>(?:default\s+|declare\s+|abstract\s+|async\s+)*)(?<kind>function|const|let|var|class|interface|type|enum)\s+(?<name>[A-Za-z_$][\w$]*)/

const FORWARD_REF_RE =
  /^(?:export\s+)?(?:const|let|var)\s+(?<name>[\w$]+)\s*(?::[^=]+)?=\s*(?:React\.)?forwardRef\s*(?<generics><[^(]*>)?\s*\(/

const NAMED_EXPORT_RE = /^export\s*\{(?<body>[^}]*)\}(?<from>\s*from\s*['"](?<module>[^'"]+)['"])?/

const STAR_EXPORT_RE = /^export\s+\*(?:\s+as\s+[\w$]+)?\s+from\s*['"](?<module>[^'"]+)['"]/

const INTERFACE_MEMBER_RE = /^(?<name>[A-Za-z_$][\w$]*)(?<optional>\?)?\s*(?<separator>[:(])/

const HOOK_RE = /^use[A-Z]/

const COMPONENT_NAME_RE = /^[A-Z]/

const stripComment = (line) => line.replace(/\/\/.*$/, "").trim()

const countBraces = (line) => {
  let delta = 0
  for (const character of line) {
    if (character === "{") delta += 1
    if (character === "}") delta -= 1
  }
  return delta
}

const formatJsDoc = (docLines) => {
  if (docLines.length === 0) {
    return null
  }

  return (
    docLines
      .join("\n")
      .replace(/^\s*\/\*\*?/, "")
      .replace(/\*\/\s*$/, "")
      .split("\n")
      .map((line) => line.replace(/^\s*\*\s?/, "").trim())
      .filter((line) => line && !line.startsWith("@"))
      .join(" ")
      .trim() || null
  )
}

const balanced = (text, open, close) => {
  let depth = 0
  for (const character of text) {
    if (character === open) depth += 1
    if (character === close) depth -= 1
  }
  return depth <= 0
}

const joinUntilBalanced = (lines, startIndex, open, close, maxLines = 12) => {
  let text = lines[startIndex].trim()
  let index = startIndex

  while (!balanced(text, open, close) && index - startIndex < maxLines && index + 1 < lines.length) {
    index += 1
    text += ` ${lines[index].trim()}`
  }

  return text.replace(/\s+/g, " ").trim()
}

/** Assinatura util sem arrastar o corpo da funcao para dentro do catalogo. */
const signatureFor = (lines, index, kind) => {
  const raw = lines[index].trim()

  if (kind === "function") {
    return joinUntilBalanced(lines, index, "(", ")")
      .replace(/\s*\{\s*$/, "")
      .trim()
  }

  if (kind === "interface" || kind === "class" || kind === "enum") {
    // A lista de `extends` costuma quebrar em varias linhas antes da chave de abertura.
    let text = raw
    let cursor = index

    while (!text.includes("{") && cursor - index < 6 && cursor + 1 < lines.length) {
      cursor += 1
      text += ` ${lines[cursor].trim()}`
    }

    return text.replace(/\s*\{.*$/, "").replace(/\s+/g, " ").trim()
  }

  if (kind === "type") {
    const joined = joinUntilBalanced(lines, index, "{", "}", 4)
    return joined.length > 220 ? `${raw.replace(/\s*=\s*$/, "")} = ...` : joined.replace(/;?\s*$/, "")
  }

  // `forwardRef<HTMLButtonElement, ButtonProps>` diz o tipo das props, que e o que interessa; o corpo
  // do componente tem dezenas de linhas e nao cabe numa assinatura.
  const forwardRefMatch = FORWARD_REF_RE.exec(raw)
  if (forwardRefMatch) {
    return `const ${forwardRefMatch.groups.name} = forwardRef${forwardRefMatch.groups.generics ?? ""}(...)`
  }

  const arrowMatch = raw.match(/^(?:export\s+)?(?:const|let|var)\s+[\w$]+(?::\s*[^=]+)?\s*=\s*(?<tail>.*)$/)
  if (!arrowMatch) {
    return raw.replace(/\s*\{\s*$/, "").trim()
  }

  let signature = raw
  if (arrowMatch.groups.tail.startsWith("(") && !balanced(raw, "(", ")")) {
    signature = joinUntilBalanced(lines, index, "(", ")", 6)
  }

  signature = signature
    .replace(/\s*=>\s*\{?\s*$/, " => ...")
    .replace(/\s*\{\s*$/, "")
    .trim()

  return signature.length > 220 ? `${signature.slice(0, 217)}...` : signature
}

const kindFor = ({ declaredKind, name, signature, relativePath }) => {
  if (declaredKind === "interface" || declaredKind === "type") {
    return "type"
  }

  if (declaredKind === "enum") {
    return "enum"
  }

  if (declaredKind === "class") {
    return "class"
  }

  if (HOOK_RE.test(name)) {
    return "hook"
  }

  const looksLikeComponent =
    COMPONENT_NAME_RE.test(name) &&
    (relativePath.includes("components") || /forwardRef|React\.FC|JSX\.Element|ReactNode/.test(signature))

  if (looksLikeComponent) {
    return "component"
  }

  if (declaredKind === "function") {
    return "function"
  }

  return "const"
}

/**
 * Extrai os simbolos exportados de um arquivo `.ts`/`.tsx`. Cobre as formas usadas pelo archon-ui
 * (declaracao exportada, lista `export { ... }`, barril `export * from`) e registra as arestas de
 * reexportacao para que o catalogo saiba o que e realmente importavel da raiz do pacote.
 */
export const parseTypeScriptFile = ({ absolutePath, relativePath }) => {
  const content = readFileSync(absolutePath, "utf8")
  const lines = content.split(/\r?\n/)

  const symbols = []
  const reExports = []
  const namedExports = []

  let depth = 0
  let pendingDoc = []
  let inBlockComment = false
  let currentInterface = null

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]
    const trimmed = rawLine.trim()

    if (inBlockComment) {
      pendingDoc.push(trimmed)
      if (trimmed.includes("*/")) {
        inBlockComment = false
      }
      continue
    }

    if (trimmed.startsWith("/**")) {
      pendingDoc = [trimmed]
      if (!trimmed.includes("*/")) {
        inBlockComment = true
      }
      continue
    }

    if (trimmed === "" || trimmed.startsWith("//")) {
      continue
    }

    if (currentInterface?.bodyOpened && depth === currentInterface.depth + 1) {
      const memberMatch = INTERFACE_MEMBER_RE.exec(stripComment(trimmed))
      if (memberMatch) {
        currentInterface.symbol.members.push({
          name: memberMatch.groups.name,
          optional: Boolean(memberMatch.groups.optional),
          kind: memberMatch.groups.separator === "(" ? "method" : "property",
          signature: stripComment(trimmed).replace(/[;,]\s*$/, ""),
          line: index + 1,
        })
      }
    }

    const starMatch = STAR_EXPORT_RE.exec(trimmed)
    if (starMatch) {
      reExports.push(starMatch.groups.module)
      depth += countBraces(trimmed)
      pendingDoc = []
      continue
    }

    const namedMatch = NAMED_EXPORT_RE.exec(trimmed)
    if (namedMatch && depth === 0) {
      const body = namedMatch.groups.module ? joinUntilBalanced(lines, index, "{", "}") : joinUntilBalanced(lines, index, "{", "}")
      const inner = body.slice(body.indexOf("{") + 1, body.lastIndexOf("}"))

      for (const entry of inner.split(",")) {
        const name = entry.trim().split(/\s+as\s+/).pop()?.trim().replace(/^type\s+/, "")
        if (name) {
          namedExports.push(name)
        }
      }

      if (namedMatch.groups.module) {
        reExports.push(namedMatch.groups.module)
      }

      depth += countBraces(trimmed)
      pendingDoc = []
      continue
    }

    const declarationMatch = DECLARATION_RE.exec(trimmed)
    if (declarationMatch && depth === 0) {
      const declaredKind = declarationMatch.groups.kind
      const name = declarationMatch.groups.name
      const signature = signatureFor(lines, index, declaredKind)

      const symbol = {
        name,
        displayName: name,
        kind: kindFor({ declaredKind, name, signature, relativePath }),
        declaredKind,
        file: relativePath,
        line: index + 1,
        signature,
        summary: formatJsDoc(pendingDoc),
        exportedInline: Boolean(declarationMatch.groups.export),
        members: [],
      }

      symbols.push(symbol)

      if (declaredKind === "interface") {
        currentInterface = { symbol, depth, bodyOpened: trimmed.includes("{") }
      }

      depth += countBraces(trimmed)
      pendingDoc = []
      continue
    }

    depth += countBraces(trimmed)

    if (currentInterface && !currentInterface.bodyOpened && depth > currentInterface.depth) {
      currentInterface.bodyOpened = true
    }

    if (currentInterface?.bodyOpened && depth <= currentInterface.depth) {
      currentInterface = null
    }

    pendingDoc = []
  }

  // `const Button = ...` seguido de `export { Button }` no fim do arquivo e o padrao dos componentes.
  // So entra no catalogo o que sai do arquivo — declaracao interna nao e API.
  const exportedNames = new Set(namedExports)
  const exportedSymbols = symbols.filter((symbol) => symbol.exportedInline || exportedNames.has(symbol.name))

  return { symbols: exportedSymbols, reExports, namedExports: [...exportedNames] }
}
