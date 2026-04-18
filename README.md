# Komplexa Scraper

Scraper para extrair conteúdo de sites de hotéis/pousadas e gerar um briefing consolidado em Markdown. Uso interno da Komplexa Hotéis.

## Pré-requisitos

- [Node.js](https://nodejs.org/) 18 ou superior
- [Git](https://git-scm.com/)

## Instalação

```bash
git clone https://github.com/cauasalomao/ex.si.bri.git
cd ex.si.bri
npm install
npx playwright install chromium
```

> O `npx playwright install chromium` baixa o navegador headless usado pelo scraper. É obrigatório rodar uma vez após o `npm install`.

## Uso

```bash
node scraper.js <url-do-site> "Nome da Empresa"
```

### Exemplos

```bash
node scraper.js https://www.pousadasolardonadora.com.br "Solar Dona Dora"
node scraper.js https://recantodosponeis.com.br "Recanto dos Pôneis"
```

O briefing gerado sai em `briefings md/briefing-<slug>.md`. Se o nome da empresa não for passado, o scraper usa o hostname do site como fallback.

## O que o scraper faz

1. Parte da home e descobre automaticamente os links internos do site (até 50 páginas).
2. Renderiza cada página com Playwright (necessário porque a maioria dos sites de hotel são SPAs).
3. Extrai apenas conteúdo textual relevante — remove headers, footers, menus, modais, cookies, ícones do Material Design e ruído de UI.
4. Deduplica textos que aparecem em muitas páginas (chrome do site).
5. Categoriza as páginas por seção (Sobre, Acomodações, Gastronomia, Lazer, Contato, etc.) e monta um Markdown estruturado.

## Notas importantes

- **Briefings gerados não são versionados.** A pasta `briefings md/` está no `.gitignore` porque contém dados de clientes. Cada colaborador gera os próprios localmente.
- Motores de reserva e páginas administrativas (checkout, login, PDF, etc.) já são ignorados automaticamente.
- Para ajustar heurística de limpeza/categorização ao entrar num site novo, ver `CLAUDE.md`.

## Estrutura

```
.
├── scraper.js         # scraper (arquivo único)
├── package.json
├── briefings md/      # output — ignorado pelo Git
├── CLAUDE.md          # guia técnico para o Claude Code
└── README.md
```
