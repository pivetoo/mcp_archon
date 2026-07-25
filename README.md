# mcp_archon

Servidor MCP que serve o catalogo de simbolos e a documentacao dos frameworks Archon
(`archon-framework`, em .NET, e `archon-ui`, em React) para qualquer cliente MCP: Claude Code,
Kimi Code, Codex, Cursor.

O catalogo **e extraido do fonte no startup**. Nao ha lista de simbolos escrita a mao, e por isso ele
nao envelhece: o que o servidor responde e o que esta no codigo naquele momento.

## Por que existe

Um agente que vai escrever codigo consumindo o Archon precisa de duas coisas diferentes:

| Pergunta | De onde vem a resposta |
|---|---|
| "qual a assinatura de `AddArchonPersistence`?" | do fonte, parseado no startup (`archon_symbol`) |
| "o `archon-ui` ja tem um componente de tabela?" | do fonte, parseado no startup (`archon_components`) |
| "em que ordem os middlewares tem que subir?" | da narrativa curada em `.playbook/system-docs` (`archon_doc`) |

Assinatura e catalogo se extraem. "Por que" e "em que ordem" nao — isso continua escrito a mao.
Misturar os dois foi o que deixou a documentacao do `archon-ui` quatro meses defasada, listando
metodos que ja tinham sido removidos.

Nao usa RAG de proposito: o corpo de conhecimento e pequeno e tem estrutura forte (simbolo,
assinatura, atributo, secao). Busca semantica devolveria trecho aproximado onde se quer a assinatura
exata.

## Instalacao

Nao precisa clonar nem instalar: os clientes rodam via `npx`.

### Claude Code

`.mcp.json` na raiz do monorepo (ou `~/.claude.json` para valer em qualquer projeto):

```json
{
  "mcpServers": {
    "archon": {
      "command": "npx",
      "args": ["-y", "github:pivetoo/mcp_archon"]
    }
  }
}
```

Tambem da para registrar pela CLI:

```bash
claude mcp add archon -- npx -y github:pivetoo/mcp_archon
```

### Codex

`~/.codex/config.toml`:

```toml
[mcp_servers.archon]
command = "npx"
args = ["-y", "github:pivetoo/mcp_archon"]
```

### Kimi Code, Cursor e outros clientes MCP

Mesmo formato do Claude Code — `command` + `args`, transporte stdio.

### Rodando do repositorio clonado

```bash
npm install
npm start
```

## Resolucao de caminhos

O servidor precisa saber onde estao o `archon-framework`, o `archon-ui` e o `.playbook/system-docs`.
A ordem de precedencia e:

1. argumento de linha de comando: `--framework`, `--ui`, `--docs`, ou `--root` (deriva os tres)
2. variavel de ambiente: `ARCHON_FRAMEWORK_PATH`, `ARCHON_UI_PATH`, `ARCHON_DOCS_PATH`, `ARCHON_MONOREPO_ROOT`
3. deteccao automatica: sobe a arvore de diretorios a partir do cwd procurando `frameworks/archon-framework`

Rodando com o cwd dentro do monorepo, nada precisa ser configurado.

Quando uma fonte nao e encontrada, a tool correspondente **diz o que faltou e como configurar**, com
o diagnostico completo da resolucao. Nao ha fallback silencioso nem catalogo vazio se passando por
resposta valida.

Para configurar explicitamente:

```json
{
  "mcpServers": {
    "archon": {
      "command": "npx",
      "args": ["-y", "github:pivetoo/mcp_archon", "--root", "/home/wsl/dev/web-projects"]
    }
  }
}
```

## Tools

### `archon_symbol`

Busca um simbolo nos dois frameworks e devolve assinatura exata, `arquivo:linha`, doc do proprio
codigo, membros, atributos e heranca.

| Parametro | Uso |
|---|---|
| `query` | nome exato, parcial, sigla (`UATR` acha `UseArchonTenantResolution`) ou `Tipo.Membro` |
| `source` | `archon-framework` ou `archon-ui` |
| `kind` | `class`, `interface`, `method`, `property`, `component`, `hook`, `type`, ... |
| `project` | `Archon.Api`, `Archon.Core`, `Archon.Infrastructure`, ... |
| `includeTests` | inclui simbolos do projeto de teste (padrao: `false`) |

### `archon_components`

Catalogo do `archon-ui`. Sem `query`, lista tudo que e importavel de `archon-ui`, agrupado por tipo —
serve para descobrir se algo ja existe antes de escrever componente ou hook novo. Com `query`,
detalha assinatura, props e local.

O que aparece por padrao e so o que sai de fato de `src/index.ts`: o catalogo segue o grafo de
reexportacao. `includeInternal: true` mostra tambem o que existe no fonte mas nao e exportado.

### `archon_doc`

Narrativa curada de `.playbook/system-docs`: `archon-framework`, `archon-ui`,
`identity-access-management`, `integration-platform`. Sem argumento, lista os documentos; com `doc`,
devolve o indice; com `query`, devolve o texto completo das secoes que casam.

A busca ignora acento — `convencoes` acha `Convenções`.

## Limites conhecidos

- Os parsers sao **heuristicos, nao compiladores**. Cobrem as formas usadas por estes dois
  repositorios (declaracao, membro publico, atributo, extension method, doc XML/JSDoc, barril de
  reexportacao) e ignoram o que nao encaixa, em vez de adivinhar.
- O catalogo e lido uma vez, no startup. Mudou o fonte, reinicie o servidor (no Claude Code,
  `/mcp` reconecta).
- `archon_doc` so enxerga o que esta em `.playbook/system-docs`. O backlog de defeitos
  (`backlog/frameworks/`) nao e servido.

## Desenvolvimento

```bash
npm run catalog                 # estatisticas do catalogo do framework
npm run catalog -- --grep=Crud  # inspeciona simbolos por nome

node scripts/probe.js                                     # lista as tools por um cliente MCP real
node scripts/probe.js archon_symbol '{"query":"Entity"}'  # chama uma tool
```

`scripts/probe.js` e um cliente MCP de linha de comando: faz handshake, `tools/list` e `tools/call`
sobre stdio, exatamente como um cliente de verdade. Use ele para conferir o formato da resposta antes
de mexer no servidor.
