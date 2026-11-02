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

// Абсолютный адрес playground (для navbar/footer/customFields). Внутри MDX
// используйте компонент src/components/Playground.jsx (useBaseUrl).
const PLAYGROUND_PATH = '/latent/playground/';

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

  // Битые внутренние ссылки — ошибка сборки. Разрыв markdown-ссылок
  // проверяется через markdown.hooks (top-level onBrokenMarkdownLinks
  // deprecated в Docusaurus 3.10).
  onBrokenLinks: 'throw',

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },

  i18n: {
    defaultLocale: 'ru',
    locales: ['ru'],
    localeConfigs: {
      ru: {
        label: 'Русский',
        direction: 'ltr',
        htmlLang: 'ru-RU',
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
