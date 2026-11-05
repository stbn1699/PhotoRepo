import { useState, type ImgHTMLAttributes } from 'react';

/**
 * Image qui apparaît en fondu une fois chargée. En attendant, son conteneur
 * affiche l'effet de chargement (classe .skeleton). Disparaît si elle est introuvable.
 */
export function FadeImage(props: ImgHTMLAttributes<HTMLImageElement>) {
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading');
  if (state === 'error') return null;
  return (
    <>
      {state === 'loading' && <span className="skeleton skeleton-fill" aria-hidden />}
      <img
        {...props}
        className={`fade-image ${state === 'loaded' ? 'is-loaded' : ''} ${props.className ?? ''}`}
        onLoad={(e) => {
          setState('loaded');
          props.onLoad?.(e);
        }}
        onError={(e) => {
          setState('error');
          props.onError?.(e);
        }}
      />
    </>
  );
}
