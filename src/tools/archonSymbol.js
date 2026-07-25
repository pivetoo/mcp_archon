import { z } from "zod"
import { describeSymbol, searchSymbols } from "../catalog/search.js"
import { formatSymbol, formatSymbolLine } from "../format.js"

const KINDS = ["class", "interface", "record", "struct", "enum", "method", "property", "field", "constructor", "enum-member", "component", "hook", "function", "type", "const"]

export const registerArchonSymbol = (server, context) => {
  server.registerTool(
    "archon_symbol",
    {
      title: "Buscar simbolo do Archon",
      description:
        "Busca um simbolo (classe, interface, metodo, propriedade, hook, componente) no fonte do archon-framework e do archon-ui, e devolve assinatura exata, arquivo:linha, doc do proprio codigo e membros. O catalogo e extraido do fonte no startup, entao nao envelhece. Use quando precisar da assinatura ou do local exato de algo do Archon, em vez de adivinhar ou reimplementar.",
      inputSchema: {
        query: z.string().describe("Nome do simbolo. Aceita nome exato, parcial, sigla ('UATR') ou 'Tipo.Membro'."),
        source: z.enum(["archon-framework", "archon-ui"]).optional().describe("Restringe a um dos frameworks."),
        kind: z.enum(KINDS).optional().describe("Restringe ao tipo de simbolo."),
        project: z.string().optional().describe("Restringe ao projeto, ex.: Archon.Api, Archon.Core."),
        includeTests: z.boolean().optional().describe("Inclui simbolos de projeto de teste. Padrao: false."),
        limit: z.number().int().min(1).max(50).optional().describe("Maximo de resultados. Padrao: 10."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, source, kind, project, includeTests = false, limit = 10 }) => {
      const catalog = context.getCatalog()

      if (catalog.symbols.length === 0) {
        return { content: [{ type: "text", text: catalog.unavailableMessage }], isError: true }
      }

      const matches = searchSymbols(catalog.symbols, { query, kind, project, source, includeTests, limit })

      if (matches.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `Nenhum simbolo encontrado para "${query}".\n\nO catalogo tem ${catalog.symbols.length} simbolos de ${catalog.sources.join(" e ")}. Se o nome estiver certo, o simbolo pode nao existir no Archon — verifique se e do sistema consumidor, e nao do framework.`,
            },
          ],
        }
      }

      const [best, ...rest] = matches
      const sections = [formatSymbol(best, describeSymbol(catalog.symbols, best))]

      // Membro do proprio resultado principal ja aparece na secao de membros; repetir so ocupa contexto.
      const others = rest.filter((symbol) => symbol.declaringType !== best.name)

      if (others.length > 0) {
        sections.push("")
        sections.push(`### Outros ${others.length} resultado(s)`)
        sections.push("")
        sections.push(others.map(formatSymbolLine).join("\n"))
      }

      return { content: [{ type: "text", text: sections.join("\n") }] }
    }
  )
}
