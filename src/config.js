import { existsSync, statSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { fileURLToPath } from "node:url"

const FRAMEWORK_MARKER = join("frameworks", "archon-framework")
const UI_MARKER = join("frameworks", "archon-ui")
const DOCS_MARKER = join(".playbook", "system-docs")

const isDirectory = (candidate) => {
  try {
    return statSync(candidate).isDirectory()
  } catch {
    return false
  }
}

const toAbsolute = (candidate) => (isAbsolute(candidate) ? candidate : resolve(process.cwd(), candidate))

/**
 * Sobe a arvore de diretorios procurando a raiz do monorepo. A marca e a existencia de
 * `frameworks/archon-framework`, nao um `.git` — a raiz do monorepo nao e um repositorio git.
 */
const findMonorepoRoot = (startDirectory) => {
  let current = toAbsolute(startDirectory)

  while (true) {
    if (isDirectory(join(current, FRAMEWORK_MARKER))) {
      return current
    }

    const parent = dirname(current)
    if (parent === current) {
      return null
    }

    current = parent
  }
}

const resolvePath = ({ explicit, envValue, root, marker, label, diagnostics }) => {
  if (explicit) {
    const path = toAbsolute(explicit)
    if (!isDirectory(path)) {
      diagnostics.push(`${label}: caminho informado por argumento nao existe (${path})`)
      return null
    }
    diagnostics.push(`${label}: ${path} (argumento de linha de comando)`)
    return path
  }

  if (envValue) {
    const path = toAbsolute(envValue)
    if (!isDirectory(path)) {
      diagnostics.push(`${label}: caminho informado por variavel de ambiente nao existe (${path})`)
      return null
    }
    diagnostics.push(`${label}: ${path} (variavel de ambiente)`)
    return path
  }

  if (root) {
    const path = join(root, marker)
    if (isDirectory(path)) {
      diagnostics.push(`${label}: ${path} (derivado da raiz do monorepo)`)
      return path
    }
    diagnostics.push(`${label}: nao encontrado em ${path}`)
    return null
  }

  diagnostics.push(`${label}: nao resolvido — raiz do monorepo desconhecida`)
  return null
}

export const loadConfig = (argv = process.argv.slice(2)) => {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      root: { type: "string" },
      framework: { type: "string" },
      ui: { type: "string" },
      docs: { type: "string" },
    },
  })

  const diagnostics = []
  const explicitRoot = values.root ?? process.env.ARCHON_MONOREPO_ROOT

  let monorepoRoot = null
  if (explicitRoot) {
    const path = toAbsolute(explicitRoot)
    monorepoRoot = isDirectory(path) ? path : null
    diagnostics.push(
      monorepoRoot
        ? `raiz do monorepo: ${monorepoRoot} (informada)`
        : `raiz do monorepo: caminho informado nao existe (${path})`
    )
  } else {
    const here = dirname(fileURLToPath(import.meta.url))
    monorepoRoot = findMonorepoRoot(process.cwd()) ?? findMonorepoRoot(here)
    diagnostics.push(
      monorepoRoot
        ? `raiz do monorepo: ${monorepoRoot} (detectada)`
        : "raiz do monorepo: nao detectada a partir do diretorio atual"
    )
  }

  const frameworkPath = resolvePath({
    explicit: values.framework,
    envValue: process.env.ARCHON_FRAMEWORK_PATH,
    root: monorepoRoot,
    marker: FRAMEWORK_MARKER,
    label: "archon-framework",
    diagnostics,
  })

  const uiPath = resolvePath({
    explicit: values.ui,
    envValue: process.env.ARCHON_UI_PATH,
    root: monorepoRoot,
    marker: UI_MARKER,
    label: "archon-ui",
    diagnostics,
  })

  const docsPath = resolvePath({
    explicit: values.docs,
    envValue: process.env.ARCHON_DOCS_PATH,
    root: monorepoRoot,
    marker: DOCS_MARKER,
    label: "system-docs",
    diagnostics,
  })

  return { monorepoRoot, frameworkPath, uiPath, docsPath, diagnostics }
}

/**
 * Mensagem de erro para tool que depende de uma fonte que nao foi resolvida. Nao ha fallback
 * silencioso: sem o fonte, a tool diz o que faltou e como configurar.
 */
export const describeMissingSource = (label, flag, envVariable, diagnostics) =>
  [
    `Fonte "${label}" nao foi encontrada, entao nao ha o que responder.`,
    "",
    "Como configurar, em ordem de precedencia:",
    `  1. argumento de linha de comando: --${flag} /caminho/para/${label}`,
    `  2. variavel de ambiente: ${envVariable}=/caminho/para/${label}`,
    "  3. rodar o servidor com o cwd dentro do monorepo (a deteccao sobe a arvore procurando frameworks/archon-framework)",
    "",
    "Diagnostico da resolucao de caminhos:",
    ...diagnostics.map((line) => `  - ${line}`),
  ].join("\n")

export const SOURCE_FLAGS = {
  framework: { flag: "framework", env: "ARCHON_FRAMEWORK_PATH", label: "archon-framework" },
  ui: { flag: "ui", env: "ARCHON_UI_PATH", label: "archon-ui" },
  docs: { flag: "docs", env: "ARCHON_DOCS_PATH", label: "system-docs" },
}

export const fileExists = (candidate) => existsSync(candidate)
