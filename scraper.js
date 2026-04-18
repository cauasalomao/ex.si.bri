const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

// ── CLI ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.length < 1) {
  console.log("Uso: node scraper.js <url-do-site> [nome-da-empresa]");
  console.log('Exemplo: node scraper.js https://recantodosponeis.com.br "Recanto dos Pôneis"');
  process.exit(1);
}

const RAW_URL = args[0];
const BASE_URL = RAW_URL.replace(/\/+$/, "");
const SITE_NAME = args[1] || new URL(BASE_URL).hostname.replace(/^www\./, "");

// Nome do arquivo de saída derivado do nome da empresa
const SLUG = SITE_NAME.toLowerCase()
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");
const OUTPUT_FILE = `briefing-${SLUG}.md`;

// ── Material Icons que vazam no innerText ────────────────────────────────────
const ICON_NAMES = new Set([
  "menu", "close", "arrow_back", "arrow_forward", "arrow_back_ios",
  "arrow_forward_ios", "arrow_back_ios_new", "arrow_drop_down",
  "arrow_drop_up", "chevron_left", "chevron_right", "star", "star_border",
  "star_half", "location_on", "camera_alt", "keyboard_arrow_down",
  "keyboard_arrow_up", "east", "west", "north", "south", "search",
  "check_circle", "error", "warning", "info", "add", "remove",
  "expand_more", "expand_less", "more_vert", "more_horiz", "share",
  "favorite", "visibility", "wifi", "pool", "restaurant", "local_parking",
  "child_care", "sports_esports", "ac_unit", "tv", "king_bed",
  "single_bed", "bathtub", "balcony", "landscape", "person", "pets",
  "spa", "fitness_center", "local_cafe", "local_bar", "local_dining",
  "beach_access", "directions_car", "event", "phone", "email", "place",
  "home", "hotel", "apartment", "cottage", "deck", "yard", "grass",
  "forest", "water", "waves", "wb_sunny", "nightlight", "bed",
  "shower", "kitchen", "microwave", "local_laundry_service",
  "meeting_room", "celebration", "cake", "shopping_cart", "credit_card",
  "login", "logout", "account_circle", "settings", "help", "language",
  "translate", "notifications", "calendar_today", "schedule", "access_time",
  "photo_camera", "videocam", "image", "collections", "photo_library",
  "facebook", "instagram", "twitter", "whatsapp", "youtube", "tiktok",
  "send", "chat", "forum", "rate_review", "thumb_up", "thumb_down",
  "navigate_next", "navigate_before", "first_page", "last_page",
  "arrow_upward", "arrow_downward", "arrow_right", "arrow_left",
  "open_in_new", "link", "attachment", "download", "upload",
  "content_copy", "delete", "edit", "done", "clear", "refresh",
  "filter_list", "sort", "view_list", "view_module", "grid_view",
  "map", "my_location", "near_me", "gps_fixed", "public",
]);

// URLs que nunca devem ser visitadas
const SKIP_PATTERNS = [
  /vendas\//i,
  /admin/i,
  /login/i,
  /logout/i,
  /cadastr/i,
  /carrinho/i,
  /checkout/i,
  /pagamento/i,
  /minha.?conta/i,
  /politica/i,
  /privacidade/i,
  /termos/i,
  /lgpd/i,
  /cookie/i,
  /#/,
  /\.(pdf|jpg|jpeg|png|gif|svg|webp|mp4|mp3|zip|doc|xls)$/i,
  /tel:/i,
  /mailto:/i,
  /whatsapp/i,
  /wa\.me/i,
  /javascript:/i,
];

// ── Funções de limpeza ───────────────────────────────────────────────────────

function isIconText(text) {
  const words = text.split(/\s+/);
  if (words.every((w) => ICON_NAMES.has(w.toLowerCase()))) return true;
  if (words.length === 1 && ICON_NAMES.has(text.toLowerCase())) return true;
  return false;
}

function cleanText(text) {
  if (!text) return "";
  let cleaned = text;
  for (const icon of ICON_NAMES) {
    cleaned = cleaned.replace(new RegExp(`\\b${icon}\\b`, "gi"), "");
  }
  cleaned = cleaned.replace(/(star|camera_alt|arrow_\w+|chevron_\w+|keyboard_\w+){2,}/gi, "");
  cleaned = cleaned.replace(/\s{2,}/g, " ").trim();
  return cleaned;
}

function isJunkText(text) {
  if (!text || text.length < 3) return true;
  if (isIconText(text)) return true;
  const junkPatterns = [
    /^(fechar|confirmar datas|carregar mais|ver mais|mais detalhes|acessar|pesquisar)$/i,
    /^(esqueci minha senha|minha conta|minhas buscas|selecione o idioma)$/i,
    /^(alemão|espanhol|francês|inglês|italiano|tradutor|powered by)$/i,
    /^R\$ 0,00$/,
    /^Finalizar$/i,
    /^Cupom$/i,
    /^Ativo \d+$/,
    /^Icones$/i,
    /^\d+ hóspedes?$/i,
    /^\d+ acomodaçã?o$/i,
    /^(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\.$/i,
    /^\d{1,2}\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\.\s+-\s+\d{1,2}\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\.$/i,
    /^🇧🇷/,
    /^Total:/,
    /^0$/,
    /^\d{1,2}\s+\d+,\d{2}(\s+\d)?$/, // linhas de calendário de preço
    /\+\d{1,4}$/,                       // dropdown de código de país
    /^(OBS|OBS:)$/i,
    /^(Como podemos te ajudar\?)$/i,
    /^(Todos os direitos reservados)$/i,
    /^(Copyright|©)/i,
    /^(Desenvolvido por|Criado por|Powered by)/i,
    /^\d{4}\s*[-–]\s*\d{4}$/, // "2020 - 2026"
    /^(Aceitar|Rejeitar|Concordo|Li e aceito)/i,
  ];
  return junkPatterns.some((p) => p.test(text));
}

// Textos de UI que devem ser removidos do documento final
const UI_JUNK = new Set([
  "Criança não paga",
  "Parcelamento",
  "Certificado de Segurança",
  "Compra rápida e fácil",
  "Pague em até 6x nos cartões de crédito.",
  "Faça compras seguras e confiáveis pelo nosso site.",
  "Em apenas poucos cliques, você finaliza a sua compra.",
  "Atendimento via WhatsApp",
  "Clique aqui para dúvidas, sugestões ou reservas.",
  "Área do cliente",
  "Se você já é cliente, acesse o nosso portal para acompanhar reservas.",
  "Nossas fotos",
  "Mande o seu comentário",
  "Pague em até 12x nos cartões de crédito.",
]);

// ── Extração de conteúdo ─────────────────────────────────────────────────────

async function waitForContent(page) {
  try {
    await page.waitForLoadState("networkidle", { timeout: 15000 });
  } catch {}
  await page.waitForTimeout(3000);
}

async function extractLinks(page, baseUrl) {
  return page.evaluate((base) => {
    const links = new Set();
    document.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      if (!href) return;
      try {
        const url = new URL(href, base);
        if (url.origin === new URL(base).origin) {
          links.add(url.pathname);
        }
      } catch {}
    });
    return [...links];
  }, baseUrl);
}

async function extractPageContent(page) {
  const raw = await page.evaluate(() => {
    const removeSelectors = [
      "script", "style", "noscript", "svg", "iframe",
      "[class*='cookie']", "[class*='Cookie']",
      "header", "footer", "nav",
      "[class*='menu']", "[class*='Menu']",
      "[class*='navbar']", "[class*='Navbar']",
      "[class*='sidebar']", "[class*='Sidebar']",
      "[class*='modal']", "[class*='Modal']",
      "[class*='popup']", "[class*='Popup']",
      "[class*='banner-cookie']",
      "[id*='cookie']", "[id*='Cookie']",
    ];

    const clone = document.body.cloneNode(true);
    removeSelectors.forEach((sel) => {
      try {
        clone.querySelectorAll(sel).forEach((el) => el.remove());
      } catch {}
    });

    // Escolhe o candidato com mais conteúdo. Se nenhum tiver ao menos 60% do
    // texto do clone, usa o clone inteiro — evita casos em que um seletor casa
    // com um container pequeno (ex: .uk-container-center) e perde o resto.
    const cloneTextLen = (clone.innerText || "").length;
    const candidateSelectors = [
      "main",
      "[role='main']",
      "article",
      "[class*='content']",
      "[class*='container']",
    ];
    const candidates = candidateSelectors
      .flatMap((sel) => [...clone.querySelectorAll(sel)])
      .map((el) => ({ el, len: (el.innerText || "").length }));
    const best = candidates.sort((a, b) => b.len - a.len)[0];
    const mainContent =
      best && best.len >= cloneTextLen * 0.6 ? best.el : clone;

    const results = [];
    const seen = new Set();

    const walker = document.createTreeWalker(
      mainContent,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          const tag = node.tagName?.toLowerCase();
          if (["script", "style", "noscript", "svg"].includes(tag))
            return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    let node;
    while ((node = walker.nextNode())) {
      const tag = node.tagName?.toLowerCase();
      if (!tag) continue;

      const isHeading = /^h[1-6]$/.test(tag);
      const isBlock = ["p", "li", "blockquote", "figcaption", "td", "th"].includes(tag);

      if (!isHeading && !isBlock) continue;

      let text = isHeading ? node.textContent?.trim() : node.innerText?.trim();
      if (!text || text.length < 3) continue;
      if (seen.has(text)) continue;

      let isParentDupe = false;
      for (const s of seen) {
        if (text.length > s.length * 2 && text.includes(s) && text.startsWith(s)) {
          isParentDupe = true;
          break;
        }
      }

      seen.add(text);
      if (isParentDupe) continue;

      results.push({
        type: isHeading ? "heading" : "text",
        level: isHeading ? parseInt(tag[1]) : 0,
        text,
      });
    }

    return results;
  });

  return raw
    .map((item) => ({ ...item, text: cleanText(item.text) }))
    .filter((item) => !isJunkText(item.text))
    .filter((item) => !UI_JUNK.has(item.text));
}

// ── Deduplicação ─────────────────────────────────────────────────────────────

function deduplicateAcrossPages(allPages) {
  const textCount = new Map();
  for (const page of allPages) {
    const pageTexts = new Set(page.content.map((c) => c.text));
    for (const t of pageTexts) {
      textCount.set(t, (textCount.get(t) || 0) + 1);
    }
  }

  const threshold = Math.max(3, Math.floor(allPages.length * 0.3));
  const commonTexts = new Set();
  for (const [text, count] of textCount) {
    if (count >= threshold) commonTexts.add(text);
  }

  console.log(`   ${commonTexts.size} textos comuns removidos (aparecem em ${threshold}+ páginas)`);

  return allPages.map((page) => ({
    ...page,
    content: page.content.filter((item) => !commonTexts.has(item.text)),
  }));
}

// ── Categorização automática de páginas ──────────────────────────────────────

const SECTION_RULES = [
  {
    title: "Sobre",
    match: (p) => /^\/(sobre|quem.?somos|a.?pousada|o.?hotel|historia|institucional|nossa.?historia)\/?$/i.test(p) || p === "/",
    priority: 1,
  },
  {
    title: "Acomodações",
    match: (p) => /\/(acomoda|suite|quarto|chale|cabana|apart|room|hospedagem|unidade)/i.test(p),
    priority: 2,
  },
  {
    title: "Funcionamento",
    match: (p) => /\/(funcionamento|regulamento|regras|normas|como.?funciona)/i.test(p),
    priority: 3,
  },
  {
    title: "Pet Friendly",
    match: (p) => /\/(pet|animal|cachorro|cao)/i.test(p),
    priority: 4,
  },
  {
    title: "Gastronomia",
    match: (p) => /\/(gastronomia|restaurante|cardapio|culinaria|menu|cafe|bar|cozinha|buffet|refeic|galponeiro|fratelli|chateau|montes)/i.test(p),
    priority: 5,
  },
  {
    title: "Eventos e Pacotes",
    match: (p) => /\/(evento|pacote|promocao|oferta|especial|casamento|corporativo|grupo|celebrac|pascoa|romantico|aniversario)/i.test(p),
    priority: 6,
  },
  {
    title: "Pontos Turísticos",
    match: (p) => /\/(ponto.?turistico|atrac|turismo|regiao|arredores|o.?que.?fazer|categoria|destino|cachoeira|cascata|morro|serra|pedra.?furada)/i.test(p),
    priority: 7,
  },
  {
    title: "Lazer e Experiências",
    match: (p) => /\/(lazer|atividade|experiencia|passeio|aventura|conteudo|tour|programa|entretenimento|recreacao|pescaria|quadriciclo|colheita|bicicleta|pic.?nic|cavalo)/i.test(p),
    priority: 8,
  },
  {
    title: "Localização",
    match: (p) => /\/(localizacao|como.?chegar|mapa|endereco|acesso|location)/i.test(p),
    priority: 9,
  },
  {
    title: "Depoimentos",
    match: (p) => /\/(depoimento|avaliac|review|opiniao|testemunho|comentario)/i.test(p),
    priority: 10,
  },
  {
    title: "Contato",
    match: (p) => /\/(contato|fale.?conosco|contact|atendimento|reserv)/i.test(p),
    priority: 11,
  },
  {
    title: "Galeria",
    match: (p) => /\/(galeria|foto|imagem|album|midia|video|gallery|photo)/i.test(p),
    priority: 12,
  },
  {
    title: "Blog",
    match: (p) => /\/(blog|noticia|artigo|post|novidade|dica)/i.test(p),
    priority: 13,
  },
];

function categorizePage(pagePath) {
  for (const rule of SECTION_RULES) {
    if (rule.match(pagePath)) return rule.title;
  }
  return null;
}

// ── Geração do Markdown ─────────────────────────────────────────────────────

function friendlyPageName(pagePath) {
  const segments = pagePath.split("/").filter(Boolean);
  const last = segments[segments.length - 1] || pagePath;
  // Ignora IDs numéricos
  if (/^\d+$/.test(last) && segments.length > 1) {
    return segments[segments.length - 2];
  }
  return decodeURIComponent(last)
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildMarkdown(pages) {
  let md = `# ${SITE_NAME} - Briefing Completo\n\n`;
  md += `> Documento gerado automaticamente em ${new Date().toLocaleDateString("pt-BR")}\n`;
  md += `> Fonte: ${BASE_URL}\n\n`;
  md += "---\n\n";

  // Agrupar páginas por seção
  const sectionMap = new Map();
  const uncategorized = [];
  const used = new Set();

  for (const page of pages) {
    if (page.content.length === 0) continue;
    const category = categorizePage(page.path);
    if (category) {
      if (!sectionMap.has(category)) sectionMap.set(category, []);
      sectionMap.get(category).push(page);
      used.add(page.path);
    }
  }

  // Ordenar seções pela prioridade definida nas regras
  const orderedSections = [...sectionMap.entries()].sort((a, b) => {
    const prioA = SECTION_RULES.find((r) => r.title === a[0])?.priority || 99;
    const prioB = SECTION_RULES.find((r) => r.title === b[0])?.priority || 99;
    return prioA - prioB;
  });

  for (const [sectionTitle, sectionPages] of orderedSections) {
    md += `## ${sectionTitle}\n\n`;

    // Deduplicar textos dentro da mesma seção (páginas diferentes com conteúdo igual)
    const sectionSeen = new Set();

    for (const page of sectionPages) {
      if (sectionPages.length > 1 && page.path !== "/") {
        const pageName = friendlyPageName(page.path);
        md += `### ${pageName}\n\n`;
      }

      for (const item of page.content) {
        if (sectionSeen.has(item.text)) continue;
        sectionSeen.add(item.text);

        if (item.type === "heading") {
          const prefix = "#".repeat(Math.min(item.level + 2, 6));
          md += `${prefix} ${item.text}\n\n`;
        } else {
          md += `${item.text}\n\n`;
        }
      }
      md += "\n";
    }

    md += "---\n\n";
  }

  // Páginas não categorizadas com conteúdo
  const remaining = pages.filter((p) => !used.has(p.path) && p.content.length > 0);
  if (remaining.length > 0) {
    md += "## Outras Páginas\n\n";
    for (const page of remaining) {
      const pageName = friendlyPageName(page.path);
      md += `### ${pageName}\n\n`;
      for (const item of page.content) {
        if (item.type === "heading") {
          const prefix = "#".repeat(Math.min(item.level + 2, 6));
          md += `${prefix} ${item.text}\n\n`;
        } else {
          md += `${item.text}\n\n`;
        }
      }
      md += "\n";
    }
    md += "---\n\n";
  }

  return md;
}

// ── Scraper principal ────────────────────────────────────────────────────────

function shouldSkipPath(link) {
  return SKIP_PATTERNS.some((p) => p.test(link));
}

async function main() {
  console.log(`Iniciando scraper genérico — ${SITE_NAME}`);
  console.log(`URL: ${BASE_URL}`);
  console.log("================================================\n");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 720 },
  });

  const page = await context.newPage();
  const pageContents = [];

  // Começa pela home e descobre o resto
  const allPaths = ["/"];
  const visited = new Set();

  // Limita a quantidade máxima de páginas pra não ficar infinito
  const MAX_PAGES = 50;

  for (let i = 0; i < allPaths.length && visited.size < MAX_PAGES; i++) {
    const pagePath = allPaths[i];
    if (visited.has(pagePath)) continue;
    visited.add(pagePath);

    const url = `${BASE_URL}${pagePath}`;
    console.log(`  [${visited.size}/${allPaths.length}] Extraindo: ${pagePath}`);

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      await waitForContent(page);

      const content = await extractPageContent(page);
      const links = await extractLinks(page, BASE_URL);

      pageContents.push({ path: pagePath, url, content });
      console.log(`      ${content.length} elementos extraídos`);

      // Descobrir novos links internos
      for (const link of links) {
        if (!visited.has(link) && !allPaths.includes(link) && !shouldSkipPath(link)) {
          allPaths.push(link);
          console.log(`      + Descoberta: ${link}`);
        }
      }
    } catch (err) {
      console.log(`      ERRO: ${err.message}`);
    }
  }

  if (visited.size >= MAX_PAGES) {
    console.log(`\n⚠ Limite de ${MAX_PAGES} páginas atingido. Páginas restantes ignoradas.`);
  }

  await browser.close();

  // Deduplicar
  console.log("\nRemovendo conteúdo duplicado...");
  const cleaned = deduplicateAcrossPages(pageContents);

  // Gerar markdown
  console.log("Gerando documento Markdown...\n");
  const markdown = buildMarkdown(cleaned);

  const outputDir = path.join(__dirname, "briefings md");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, OUTPUT_FILE);
  fs.writeFileSync(outputPath, markdown, "utf-8");

  const totalElements = cleaned.reduce((sum, p) => sum + p.content.length, 0);
  const lines = markdown.split("\n").length;
  console.log("================================================");
  console.log("Extração concluída!");
  console.log(`   Páginas visitadas: ${pageContents.length}`);
  console.log(`   Elementos únicos: ${totalElements}`);
  console.log(`   Linhas no documento: ${lines}`);
  console.log(`   Arquivo: ${outputPath}`);
}

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});
