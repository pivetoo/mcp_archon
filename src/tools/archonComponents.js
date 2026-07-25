import { z } from "zod"
import { describeSymbol, searchSymbols } from "../catalog/search.js"
import { formatSymbol, formatSymbolLine } from "../format.js"

const KINDS = ["component", "hook", "function", "const", "type", "class", "enum"]

const GROUPS = [
  { title: "Componentes", kinds: ["component"] },
  { title: "Hooks", kinds: ["hook"] },
  { title: "Funcoes, services e objetos", kinds: ["function", "const", "class"] },
  { title: "Tipos", kinds: ["type", "enum"] },
]

const listCatalog = (symbols, kind) => {
  const wanted = symbols.filter((symbol) => symbol.isPublicApi && (!kind || symbol.kind === kind))

  if (wanted.length === 0) {
    return `Nenhum simbolo publico do archon-ui${kind ? ` do tipo "${kind}"` : ""}.`
  }

  const lines = [
    "# Catalogo publico do archon-ui",
    "",
    "Tudo abaixo e importavel de `archon-ui`. Para assinatura, props e local exato, chame `archon_components` com `query`, ou `archon_symbol`.",
    "",
  ]

  for (const group of GROUPS) {
    const names = [...new Set(wanted.filter((symbol) => group.kinds.includes(symbol.kind)).map((symbol) => symbol.name))].sort()
    if (names.length === 0) {
      continue
    }

    lines.push(`## ${group.title} (${names.length})`)
    lines.push("")
    lines.push(names.join(", "))
    lines.push("")
  }

  return lines.join("\n")
}

export const registerArchonComponents = (server, context) => {
  server.registerTool(
    "archon_components",
    {
      title: "Catalogo do archon-ui",
      description:
        "Lista ou detalha o que o archon-ui exporta: componentes, hooks, services, contexts, tipos e utilitarios. Sem `query`, devolve o catalogo agrupado por tipo — use para descobrir se algo ja existe antes de escrever componente ou hook novo. Com `query`, devolve assinatura, props e arquivo:linha.",
      inputSchema: {
        query: z.string().optional().describe("Nome (ou parte) do componente, hook ou service. Sem isso, lista o catalogo inteiro."),
        kind: z.enum(KINDS).optional().describe("Restringe ao tipo de simbolo."),
        includeInternal: z.boolean().optional().describe("Inclui simbolos que existem no fonte mas nao sao exportados de 'archon-ui'. Padrao: false."),
        limit: z.number().int().min(1).max(30).optional().describe("Maximo de resultados quando ha query. Padrao: 8."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, kind, includeInternal = false, limit = 8 }) => {
      const catalog = context.getCatalog()
      const uiSymbols = catalog.symbols.filter((symbol) => symbol.source === "archon-ui")

      if (uiSymbols.length === 0) {
        return { content: [{ type: "text", text: catalog.unavailableMessage }], isError: true }
      }

      if (!query) {
        return { content: [{ type: "text", text: listCatalog(uiSymbols, kind) }] }
      }

      const pool = includeInternal ? uiSymbols : uiSymbols.filter((symbol) => symbol.isPublicApi)
      const matches = searchSymbols(pool, { query, kind, limit })

      if (matches.length === 0) {
        const scope = includeInternal ? "no fonte do archon-ui" : "na API publica do archon-ui"
        return {
          content: [
            {
              type: "text",
              text: `Nada encontrado para "${query}" ${scope}.\n\nSe voce esperava que existisse, pode ser simbolo interno — repita com includeInternal: true. Se nem assim aparecer, nao existe no archon-ui e precisa ser escrito no sistema consumidor.`,
            },
          ],
        }
      }

      const [best, ...rest] = matches
      const sections = [formatSymbol(best, describeSymbol(catalog.symbols, best))]

      if (rest.length > 0) {
        sections.push("")
        sections.push(`### Outros ${rest.length} resultado(s)`)
        sections.push("")
        sections.push(rest.map(formatSymbolLine).join("\n"))
      }

      return { content: [{ type: "text", text: sections.join("\n") }] }
    }
  )
}
