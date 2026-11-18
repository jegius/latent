// Playground.jsx — единый способ ссылаться на браузерную IDE и встраивать её.
//
// Playground публикуется как статический каталог /latent/playground/
// (scripts/sync-playground.mjs копирует web-ide/ в docs/static/playground/
// перед сборкой сайта). Ссылки строятся через useBaseUrl, чтобы работать при
// любом baseUrl.
//
// Использование в MDX:
//
//   import {PlaygroundFrame, PlaygroundLink} from '@site/src/components/Playground';
//
//   <PlaygroundLink>Открыть playground</PlaygroundLink>
//   <PlaygroundFrame height="640px" />
//
// ВАЖНО: PlaygroundLink рендерит обычный <a>, а не <Link>: /playground/ —
// статический каталог, а не route Docusaurus, и onBrokenLinks: 'throw'
// не должен проверять его как внутреннюю ссылку.

import React from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';

/** Путь к playground относительно baseUrl сайта. */
const PLAYGROUND = '/playground/';

/**
 * Встроенная браузерная IDE (iframe).
 *
 * @param {Object} props
 * @param {string} [props.height='640px'] — высота iframe.
 * @param {string} [props.title='Latent playground'] — title (доступность).
 * @param {string} [props.className]
 */
export function PlaygroundFrame({height = '640px', title = 'Latent playground', className}) {
  const src = useBaseUrl(PLAYGROUND);
  return (
    <iframe
      src={src}
      title={title}
      className={className}
      loading="lazy"
      style={{
        width: '100%',
        height,
        border: '1px solid var(--ifm-color-emphasis-300)',
        borderRadius: '8px',
        background: '#16161f',
      }}
    />
  );
}

/**
 * Ссылка «открыть playground в новой вкладке».
 *
 * @param {Object} props
 * @param {React.ReactNode} [props.children='Открыть playground']
 */
export function PlaygroundLink({children = 'Открыть playground', ...props}) {
  const href = useBaseUrl(PLAYGROUND);
  return (
    <a href={href} {...props}>
      {children}
    </a>
  );
}

export default PlaygroundFrame;
