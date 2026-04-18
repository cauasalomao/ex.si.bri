# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Projeto

Scraper de sites de hotéis/pousadas usado pela **Komplexa Hotéis** (agência de marketing hoteleiro) para gerar briefings em Markdown a partir do site oficial de cada cliente/prospect. O briefing é usado internamente para onboarding, comunicação, inteligência de mercado e alimentação de IA.

## Contexto técnico crítico

- Sites de hotéis geralmente são **SPAs (Single Page Application)** — conteúdo renderizado via JavaScript.
- Ferramentas como `fetch`, `curl` ou `WebFetch` retornam HTML vazio ou apenas CSS de fontes.
- **É obrigatório usar Playwright (navegador headless)** para renderizar as páginas antes da extração.
- Motores de reserva ficam em domínios separados e devem ser ignorados (já cobertos pelos `SKIP_PATTERNS`).

## Setup

```bash
npm install
npx playwright install chromium
```

## Uso

```bash
node scraper.js <url-do-site> [nome-da-empresa]
```

Se o nome da empresa não for passado, o scraper usa o hostname como fallback. O arquivo final sai em `briefings md/briefing-<slug>.md`.

## Arquitetura (scraper.js)

Pipeline em uma única passada:

1. **CLI** — recebe URL e nome da empresa, deriva slug do arquivo de saída.
2. **Descoberta** — parte de `/`, extrai links internos e alimenta uma fila, respeitando `SKIP_PATTERNS` (admin, checkout, PDFs, mailto, etc.) e o limite `MAX_PAGES = 50`.
3. **Extração por página** (`extractPageContent`) — clona o `<body>`, remove `header/footer/nav/menu/modal/cookie`, prioriza `main`/`article`/`[class*='content']` e faz `TreeWalker` capturando apenas headings e blocos (`p`, `li`, `blockquote`, `figcaption`, `td`, `th`).
4. **Limpeza de ruído** — `ICON_NAMES` (nomes de Material Icons que vazam no innerText), `UI_JUNK` (textos fixos tipo "Pague em até 6x..."), `isJunkText` (regex para lixo de calendário, cookies, copyright).
5. **Deduplicação entre páginas** (`deduplicateAcrossPages`) — qualquer texto que apareça em ≥30% das páginas (mínimo 3) é considerado chrome do site e removido.
6. **Categorização** (`SECTION_RULES`) — ordena as páginas em seções fixas (Sobre, Acomodações, Gastronomia, Lazer, Contato, etc.) por regex no path da URL, com prioridade definida.
7. **Montagem do Markdown** (`buildMarkdown`) — agrupa por seção, deduplica dentro da seção e rebaixa os níveis de heading (`h1` da página vira `h3` no doc final).

Quando precisar evoluir o scraper para um site novo que "não encaixou":

- Ruído novo de UI → adicionar em `UI_JUNK` ou em `isJunkText`.
- Ícone que vazou → adicionar em `ICON_NAMES`.
- URL que não deve ser visitada → `SKIP_PATTERNS`.
- Categoria nova ou match errado → `SECTION_RULES` (a ordem importa: a primeira regra que casar vence).

## Diretrizes para Claude Code

- **Nada de conteúdo genérico.** O scraper existe para alimentar uma operação real de marketing hoteleiro — antes de mexer na heurística de limpeza ou categorização, olhar briefings já gerados para entender o que está funcionando/ruim.
- Toda documentação e output do scraper é em **português brasileiro**.
- **Não commitar briefings gerados.** A pasta `briefings md/` contém dados de clientes (nomes, preços, endereços, depoimentos). Está no `.gitignore` — manter assim.
- Ao adicionar um site novo, rodar o scraper e revisar o `.md` gerado antes de considerar a tarefa pronta. Ajustar `UI_JUNK`/`ICON_NAMES`/`SKIP_PATTERNS` até o output estar limpo.
