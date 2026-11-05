import { useCallback, useEffect, useRef, useState } from 'react';
import { imageUrl, VERSION_LABELS, VERSIONS, type GalleryImage, type Version } from '../api';

interface Props {
  shootingId: number;
  images: GalleryImage[];
  index: number;
  version: Version;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onDownload: (image: GalleryImage, version: Version) => void;
}

/** Vue en grand d'une photo : navigation, choix de la version, téléchargement. */
export function Lightbox({ shootingId, images, index, version: galleryVersion, onIndexChange, onClose, onDownload }: Props) {
  const image = images[index];
  const [chosenVersion, setChosenVersion] = useState<Version>(galleryVersion);
  // Si la photo n'existe pas dans la version choisie, on montre l'originale.
  const version: Version = image.versions[chosenVersion] ? chosenVersion : 'original';
  const info = image.versions[version]!;
  const [loaded, setLoaded] = useState(false);

  const previewSrc = imageUrl(shootingId, image.number, version, 'preview', info.token);
  const thumbSrc = imageUrl(shootingId, image.number, version, 'thumb', info.token);

  useEffect(() => setLoaded(false), [previewSrc]);

  const go = useCallback(
    (delta: number) => {
      const next = index + delta;
      if (next >= 0 && next < images.length) onIndexChange(next);
    },
    [index, images.length, onIndexChange],
  );

  // Clavier : flèches et Échap.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  // Bloque le défilement de la page derrière.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Précharge les photos voisines pour une navigation fluide.
  useEffect(() => {
    for (const neighbor of [images[index + 1], images[index - 1]]) {
      const v = neighbor?.versions[version] ? version : 'original';
      const n = neighbor?.versions[v];
      if (neighbor && n) new Image().src = imageUrl(shootingId, neighbor.number, v, 'preview', n.token);
    }
  }, [images, index, version, shootingId]);

  // Glisser du doigt pour changer de photo.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length !== 1) {
      touchStart.current = null;
      return;
    }
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
    else if (dy > 100 && Math.abs(dy) > Math.abs(dx) * 1.5) onClose();
  }

  return (
    <div className="lightbox" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="lightbox-top">
        <span className="lightbox-counter">
          {index + 1} / {images.length}
        </span>
        <div className="segmented segmented-dark">
          {VERSIONS.map((v) => (
            <button
              key={v}
              className={v === version ? 'active' : ''}
              disabled={!image.versions[v]}
              onClick={() => setChosenVersion(v)}
            >
              {VERSION_LABELS[v]}
            </button>
          ))}
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Fermer">
          ✕
        </button>
      </div>

      <div className="lightbox-stage" onClick={(e) => e.target === e.currentTarget && onClose()}>
        {index > 0 && (
          <button className="nav-btn nav-prev" onClick={() => go(-1)} aria-label="Photo précédente">
            ‹
          </button>
        )}
        <div
          className="lightbox-image"
          style={{
            aspectRatio: `${info.width} / ${info.height}`,
            // Aussi grande que possible sans dépasser ni en largeur ni en hauteur.
            width: `min(100%, calc(var(--stage-h) * ${info.width / info.height}))`,
          }}
        >
          {/* La miniature s'affiche tout de suite, l'aperçu net la remplace dès qu'il est chargé. */}
          <img src={thumbSrc} alt="" className="lightbox-placeholder" draggable={false} />
          <img
            key={previewSrc}
            src={previewSrc}
            alt={`Photo ${image.number}`}
            className={`lightbox-preview ${loaded ? 'is-loaded' : ''}`}
            onLoad={() => setLoaded(true)}
            draggable={false}
          />
        </div>
        {index < images.length - 1 && (
          <button className="nav-btn nav-next" onClick={() => go(1)} aria-label="Photo suivante">
            ›
          </button>
        )}
      </div>

      <div className="lightbox-bottom">
        <button className="btn btn-primary" onClick={() => onDownload(image, version)}>
          Télécharger
        </button>
      </div>
    </div>
  );
}
