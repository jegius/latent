// @ts-check
// Конфигурация Docusaurus для документации языка Latent.
//
// Сайт публикуется как project pages GitHub:
//   https://jegius.github.io/latent/
// поэтому baseUrl = '/latent/'. Все внутренние ссылки в markdown —
// относительные на .md/.mdx (Docusaurus сам добавит baseUrl), статика и
// playground — через useBaseUrl (/latent/playground/).
//
// Режим docs-only: единственный раздел сайта — документация (routeBasePath
// '/'), плюс статический playground, который копируется в docs/static/
// playground/ скриптом scripts/sync-playground.mjs (владелец — Lead) перед
// сборкой. Сборка обязана проходить и БЕЗ скопированного playground: iframe
// просто ведёт на /latent/playground/.

const {themes: prismThemes} = require('prism-react-renderer');
const fs = require('node:fs');
const path = require('node:path');

// Абсолютный адрес playground (для navbar/footer/customFields). Внутри MDX
// используйте компонент src/components/Playground.jsx (useBaseUrl).
const PLAYGROUND_PATH = '/latent/playground/';

// --- Проверка полноты i18n-переводов ---------------------------------------
// Переводы контента живут в i18n/en/docusaurus-plugin-content-docs/current/.
// Пока они неполные, относительные markdown-ссылки в переведённых файлах
// могут указывать на ещё не переведённые страницы — такие ссылки не
// резолвятся внутри en-плагина. Чтобы сборка обоих языков не падала во время
// параллельного перевода, onBrokenMarkdownLinks становится 'warn', пока
// перевод неполный; как только переведены все страницы — 'throw'.
// Принудительно: DOCS_STRICT_LINKS=1 (throw) / DOCS_STRICT_LINKS=0 (warn).
function listMarkdown(dir) {
  /** @type {string[]} */
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) out.push(...listMarkdown(full));
    else if (/\.mdx?$/i.test(entry)) out.push(path.relative(dir, full).replace(/\\/g, '/'));
  }
  return out;
}

const ruDocsDir = path.join(__dirname, 'docs');
const enDocsDir = path.join(
  __dirname,
  'i18n',
  'en',
  'docusaurus-plugin-content-docs',
  'current',
);
const ruDocs = listMarkdown(ruDocsDir);
const enDocs = listMarkdown(enDocsDir);
// Переводов ещё нет — fallback на ru, ссылки резолвятся, throw безопасен.
// Есть и покрывают все ru-страницы — тоже throw.
const translationsComplete =
  enDocs.length === 0 || ruDocs.every((rel) => enDocs.includes(rel));
const strictLinksEnv = process.env.DOCS_STRICT_LINKS;
const strictLinks =
  strictLinksEnv === '1'
    ? true
    : strictLinksEnv === '0'
      ? false
      : translationsComplete;
// Пока перевод неполный, относительные markdown-ссылки в переведённых файлах
// могут указывать на ещё не переведённые страницы: такие ссылки не
// резолвятся, и сборка с 'throw' падает. На время параллельного перевода
// ставим 'warn' для обоих чекеров; когда переводы полные — 'throw'.
const brokenLinksMode = strictLinks ? 'throw' : 'warn';


/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Latent',
  tagline: 'AI-native язык программирования, компилируемый в WebAssembly',
  favicon: 'img/favicon.svg',

  url: 'https://jegius.github.io',
  baseUrl: '/latent/',

  organizationName: 'jegius',
  projectName: 'latent',
  trailingSlash: false,

  // Битые внутренние ссылки: 'throw', когда i18n-переводы полные (или их
  // нет); 'warn', пока переводы неполные — иначе параллельный перевод не
  // даёт собрать сайт. Принудительно: DOCS_STRICT_LINKS=1|0.
  onBrokenLinks: brokenLinksMode,

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: brokenLinksMode,
    },
  },

  i18n: {
    defaultLocale: 'ru',
    locales: ['ru', 'en'],
    localeConfigs: {
      ru: {
        label: 'Русский',
        direction: 'ltr',
        htmlLang: 'ru-RU',
      },
      en: {
        label: 'English',
        direction: 'ltr',
        htmlLang: 'en',
      },
    },
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          routeBasePath: '/',
          sidebarPath: require.resolve('./sidebars.js'),
          // Сохраняем числовые префиксы в id и URL: tutorial/10-capstone.md →
          // /tutorial/10-capstone (иначе Docusaurus срезает «10-»).
          numberPrefixParser: false,
          editUrl: 'https://github.com/jegius/latent/tree/part10-toolchain/docs/',
          breadcrumbs: true,
          showLastUpdateAuthor: false,
          showLastUpdateTime: false,
        },
        // Блога нет: сайт посвящён только документации.
        blog: false,
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/logo.svg',
      colorMode: {
        defaultMode: 'dark',
        disableSwitch: false,
        respectPrefersColorScheme: true,
      },
      navbar: {
        title: 'Latent',
        logo: {
          alt: 'Latent',
          src: 'img/logo.svg',
        },
        items: [
          {
            to: '/',
            label: 'Docs',
            position: 'left',
            activeBaseRegex: '^/$',
          },
          {
            // Playground — статический каталог, а не route Docusaurus, поэтому
            // onBrokenLinks не должен его проверять. Кастомный HTML-пункт
            // (href) не участвует в проверке внутренних ссылок; baseUrl
            // зафиксирован ('/latent/').
            type: 'html',
            value:
              '<a class="navbar__item navbar__link" href="/latent/playground/">Playground</a>',
            position: 'left',
          },
          {
            href: 'https://github.com/jegius/latent',
            label: 'GitHub',
            position: 'right',
          },
          {
            // Переключатель языков: ru (по умолчанию) / en.
            // Переводы метки задаются в i18n/<locale>/docusaurus-theme-classic.
            type: 'localeDropdown',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Документация',
            items: [
              {label: 'Введение', to: '/intro/why-latent'},
              {label: 'Начало работы', to: '/getting-started/install'},
              {label: 'Туториал', to: '/tutorial/'},
              {label: 'Руководство', to: '/guide/'},
            ],
          },
          {
            title: 'Инструменты',
            items: [
              // Абсолютные URL: статические артефакты (playground, llms.txt)
              // не являются routes Docusaurus, и onBrokenLinks проверять их
              // не должен. Домен совпадает с url сайта.
              {
                label: 'Playground',
                href: 'https://jegius.github.io/latent/playground/',
              },
              {
                label: 'llms.txt',
                href: 'https://jegius.github.io/latent/llms.txt',
              },
              {label: 'GitHub', href: 'https://github.com/jegius/latent'},
              // Ссылка на англоязычную версию сайта. Абсолютный URL — чтобы
              // не зависеть от onBrokenLinks, пока en-переводы неполные.
              {
                label: 'English docs',
                href: 'https://jegius.github.io/latent/en/',
              },
            ],
          },
        ],
        copyright: `Latent ${new Date().getFullYear()}`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
        // Язык `latent` не входит в Prism; блоки ```latent рендерятся как
        // обычный текст. Это осознанно: подсветка не должна влиять на сборку.
        additionalLanguages: ['bash', 'json', 'rust', 'javascript'],
      },
      tableOfContents: {
        minHeadingLevel: 2,
        maxHeadingLevel: 4,
      },
    }),

  customFields: {
    // URL браузерной IDE. Каталог docs/static/playground/ наполняется
    // scripts/sync-playground.mjs (копия web-ide/).
    webIdeUrl: PLAYGROUND_PATH,
    repoUrl: 'https://github.com/jegius/latent',
    compilerAbi: 'latent_alloc/latent_compile (src/lib.rs)',
  },

  headTags: [
    {
      tagName: 'link',
      attributes: {
        rel: 'alternate',
        type: 'text/plain',
        href: '/latent/llms.txt',
        title: 'llms.txt — индекс документации для LLM',
      },
    },
  ],
};

module.exports = config;
