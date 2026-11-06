import { useCallback, useEffect, useRef, useState } from 'react';
import { api, imageUrl, isDownloadable, VERSION_LABELS, VERSIONS, type GalleryImage, type Version } from '../api';
import { Heart } from './Heart';

interface Props {
  shootingId: number;
  images: GalleryImage[];
  index: number;
  version: Version;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onDownload: (image: GalleryImage, version: Version) => void;
  /** La photo est-elle dans mes favoris ? */
  liked: (number: number) => boolean;
  /** Absent pour l'admin (il voit les likes des modèles, il n'aime pas lui-même). */
  onToggleLike?: (number: number) => void;
  /** Admin : numéro → prénoms des modèles qui ont aimé. */
  likedBy?: Record<string, string[]>;
}

function firstVersion(image: GalleryImage): Version {
  return VERSIONS.find((v) => image.versions[v]) ?? 'original';
}

/** Vue en grand d'une photo : navigation, choix de la version, téléchargement. */
export function Lightbox({
  shootingId,
  images,
  index,
  version: galleryVersion,
  onIndexChange,
  onClose,
  onDownload,
  liked,
  onToggleLike,
  likedBy,
}: Props) {
  const image = images[index];
  const [chosenVersion, setChosenVersion] = useState<Version>(galleryVersion);
  // Si la photo n'existe pas dans la version choisie, on montre l'originale (ou, à défaut, le RAW).
  const version: Version = image.versions[chosenVersion] ? chosenVersion : firstVersion(image);
  const info = image.versions[version]!;
  const [loaded, setLoaded] = useState(false);

  const isRaw = version === 'raw';
  const previewSrc = imageUrl(shootingId, image.number, version, 'preview', info.token);
  const thumbSrc = imageUrl(shootingId, image.number, version, 'thumb', info.token);

  useEffect(() => setLoaded(false), [previewSrc]);

  // Double-tap / double-clic sur la photo : l'ajoute aux favoris (avec un cœur qui apparaît).
  const isLiked = liked(image.number);
  const [burst, setBurst] = useState(0);
  function likeFromDoubleTap() {
    if (!onToggleLike) return;
    if (!isLiked) onToggleLike(image.number);
    setBurst((b) => b + 1);
  }
  const lastTap = useRef(0);

  // Enregistre la vue quand la photo reste affichée au moins une seconde (pas en faisant défiler vite).
  useEffect(() => {
    const timer = setTimeout(() => {
      void api.post(`/api/shootings/${shootingId}/images/${image.number}/${version}/view`).catch(() => {});
    }, 1000);
    return () => clearTimeout(timer);
  }, [shootingId, image.number, version]);

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
      const v = neighbor?.versions[version] ? version : neighbor ? firstVersion(neighbor) : version;
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
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && (e.target as HTMLElement).closest('.lightbox-image')) {
      const now = Date.now();
      if (now - lastTap.current < 300) {
        lastTap.current = 0;
        likeFromDoubleTap();
      } else lastTap.current = now;
      return;
    }
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
          {VERSIONS.filter((v) => v !== 'raw' || image.versions.raw).map((v) => (
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
          className={`lightbox-image ${isRaw ? 'protected' : ''}`}
          onContextMenu={isRaw ? (e) => e.preventDefault() : undefined}
          onDoubleClick={likeFromDoubleTap}
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
          {/* RAW : un calque transparent par-dessus empêche « Enregistrer l'image » (clic droit, appui long). */}
          {isRaw && <div className="protect-layer" aria-hidden />}
          {burst > 0 && (
            <span key={burst} className="like-burst" aria-hidden>
              <Heart filled />
            </span>
          )}
        </div>
        {index < images.length - 1 && (
          <button className="nav-btn nav-next" onClick={() => go(1)} aria-label="Photo suivante">
            ›
          </button>
        )}
      </div>

      <div className="lightbox-bottom">
        {onToggleLike ? (
          <button
            className={`btn btn-ghost btn-like ${isLiked ? 'is-liked' : ''}`}
            onClick={() => onToggleLike(image.number)}
            aria-pressed={isLiked}
          >
            <Heart filled={isLiked} /> {isLiked ? 'Dans mes favoris' : 'J’aime'}
          </button>
        ) : (
          likedBy?.[image.number]?.length ? (
            <span className="like-badge-inline">♥ {likedBy[image.number].join(', ')}</span>
          ) : null
        )}
        {isDownloadable(version) ? (
          <button className="btn btn-primary" onClick={() => onDownload(image, version)}>
            Télécharger
          </button>
        ) : (
          <span className="raw-note">🔒 Fichier RAW · aperçu uniquement, téléchargement impossible</span>
        )}
      </div>
    </div>
  );
}
