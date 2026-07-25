import { z } from "zod"
import { searchDocSections } from "../catalog/docs.js"
import { truncate } from "../format.js"

const listDocuments = (documents) => {
  const lines = [
    "# Documentacao disponivel",
    "",
    "Narrativa curada do ecossistema: o que cada peca faz, em que ordem sobe, o que quebra se mudar.",
    "Chame de novo com `doc` para o indice de um documento, ou com `query` para ir direto ao trecho.",
    "",
  ]

  for (const document of documents) {
    lines.push(`## ${document.id}`)
    lines.push("")
    lines.push(`${document.title} — ${document.lineCount} linhas, ${document.sections.length} secoes.`)
    lines.push("")
  }

  return lines.join("\n")
}

const outlineOf = (document) => {
  const lines = [`# ${document.title}`, "", `Arquivo: ${document.file}`, "", "## Secoes", ""]

  for (const section of document.sections) {
    if (!section.title) {
      continue
    }

    const indent = "  ".repeat(Math.max(0, section.level - 2))
    const preview = section.body ? ` — ${truncate(section.body.replace(/\s+/g, " "), 100)}` : ""
    lines.push(`${indent}- **${section.title}** (:${section.line})${preview}`)
  }

  lines.push("")
  lines.push("Chame `archon_doc` com `query` para receber o texto completo de uma secao, ou `full: true` para o documento inteiro.")

  return lines.join("\n")
}

export const registerArchonDoc = (server, context) => {
  server.registerTool(
    "archon_doc",
    {
      title: "Documentacao do ecossistema Archon",
      description:
        "Devolve a documentacao curada do ecossistema (archon-framework, archon-ui, IdentityManagement, IntegrationPlatform): decisoes de projeto, ordem de bootstrap, contratos entre sistemas e armadilhas conhecidas. Use quando a duvida for 'por que' ou 'em que ordem', e nao 'qual a assinatura' — para assinatura, use archon_symbol.",
      inputSchema: {
        query: z.string().optional().describe("Assunto procurado, ex.: 'multi-tenant', 'bootstrap', 'armadilhas', 'refresh token'."),
        doc: z.string().optional().describe("Restringe a um documento, ex.: archon-framework, archon-ui, identity-access-management, integration-platform."),
        full: z.boolean().optional().describe("Com `doc`, devolve o documento inteiro em vez do indice. Padrao: false."),
        limit: z.number().int().min(1).max(6).optional().describe("Maximo de secoes retornadas na busca. Padrao: 3."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, doc, full = false, limit = 3 }) => {
      const { documents, unavailableMessage } = context.getDocs()

      if (documents.length === 0) {
        return { content: [{ type: "text", text: unavailableMessage }], isError: true }
      }

      if (doc) {
        const document = documents.find((candidate) => candidate.id === doc)
        if (!document) {
          const available = documents.map((candidate) => candidate.id).join(", ")
          return { content: [{ type: "text", text: `Documento "${doc}" nao existe. Disponiveis: ${available}.` }] }
        }

        if (full && !query) {
          return { content: [{ type: "text", text: document.content }] }
        }

        if (!query) {
          return { content: [{ type: "text", text: outlineOf(document) }] }
        }
      }

      if (!query) {
        return { content: [{ type: "text", text: listDocuments(documents) }] }
      }

      const matches = searchDocSections(documents, { query, doc, limit })

      if (matches.length === 0) {
        const available = documents.map((candidate) => candidate.id).join(", ")
        return {
          content: [
            {
              type: "text",
              text: `Nada encontrado para "${query}" na documentacao${doc ? ` de ${doc}` : ""}.\n\nDocumentos disponiveis: ${available}. Se o assunto existe no codigo mas nao na documentacao, use archon_symbol.`,
            },
          ],
        }
      }

      const sections = matches.map(({ document, section }) =>
        [
          `# ${section.title ?? document.title}`,
          "",
          `Fonte: ${document.file}:${section.line}`,
          "",
          section.body || "(secao sem corpo)",
        ].join("\n")
      )

      return { content: [{ type: "text", text: sections.join("\n\n---\n\n") }] }
    }
  )
}
