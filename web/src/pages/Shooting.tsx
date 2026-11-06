import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth';
import {
  api,
  formatShootingDate,
  imageUrl,
  originalUrl,
  VERSION_LABELS,
  VERSIONS,
  type GalleryImage,
  type ShootingDetail,
  type Version,
  isDownloadable,
} from '../api';
import { DownloadDialog } from '../components/DownloadDialog';
import { Lightbox } from '../components/Lightbox';
import { FadeImage } from '../components/FadeImage';
import { Heart } from '../components/Heart';
import { canShareFiles, triggerDownload, type DownloadItem } from '../downloads';

export function ShootingPage() {
  const id = Number(useParams().id);
  const { user } = useAuth();
  const [data, setData] = useState<ShootingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState<Version>('original');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [downloadItems, setDownloadItems] = useState<DownloadItem[] | null>(null);
  const [likes, setLikes] = useState<Set<number>>(new Set());
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  useEffect(() => {
    setData(null);
    setError(null);
    api
      .get<ShootingDetail>(`/api/shootings/${id}`)
      .then((d) => {
        setData(d);
        setLikes(new Set(d.myLikes));
      })
      .catch((err) => setError(err.message));
  }, [id]);

  // L'admin voit les likes des modèles (badges), les modèles aiment elles-mêmes (cœurs).
  const isAdmin = !!user?.isAdmin;
  const likedBy = data?.likedBy ?? {};
  const isFavorite = useCallback(
    (n: number) => (isAdmin ? (likedBy[n]?.length ?? 0) > 0 : likes.has(n)),
    [isAdmin, likedBy, likes],
  );

  // Images visibles : celles qui existent dans la version choisie (et aimées, si le filtre est actif).
  const versionImages = useMemo(() => data?.images.filter((i) => i.versions[version]) ?? [], [data, version]);
  const favoriteCount = versionImages.filter((i) => isFavorite(i.number)).length;
  const images = useMemo(
    () => (favoritesOnly ? versionImages.filter((i) => isFavorite(i.number)) : versionImages),
    [versionImages, favoritesOnly, isFavorite],
  );

  async function toggleLike(number: number) {
    const liked = likes.has(number);
    const apply = (on: boolean) =>
      setLikes((prev) => {
        const next = new Set(prev);
        if (on) next.add(number);
        else next.delete(number);
        return next;
      });
    apply(!liked); // tout de suite à l'écran, annulé si le serveur refuse
    try {
      if (liked) await api.del(`/api/shootings/${id}/images/${number}/like`);
      else await api.put(`/api/shootings/${id}/images/${number}/like`, {});
    } catch {
      apply(liked);
    }
  }
  const counts = useMemo(() => {
    const c = { original: 0, carre: 0, story: 0, raw: 0 } as Record<Version, number>;
    for (const img of data?.images ?? []) for (const v of VERSIONS) if (img.versions[v]) c[v]++;
    return c;
  }, [data]);

  // Si la version affichée n'a aucune photo (ex. shooting avec seulement des RAW), on passe à la première disponible.
  useEffect(() => {
    if (data && counts[version] === 0) {
      const first = VERSIONS.find((v) => counts[v] > 0);
      if (first) setVersion(first);
    }
  }, [data, counts, version]);

  function changeVersion(v: Version) {
    setVersion(v);
    setSelected(new Set());
    setOpenIndex(null);
    if (!isDownloadable(v)) setSelecting(false);
  }

  const [savingRaws, setSavingRaws] = useState(false);
  async function toggleRawsShared(shared: boolean) {
    if (!data) return;
    setSavingRaws(true);
    try {
      await api.patch(`/api/admin/shootings/${id}`, { rawsShared: shared });
      setData({ ...data, shooting: { ...data.shooting, rawsShared: shared } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSavingRaws(false);
    }
  }

  const toItem = useCallback(
    (img: GalleryImage, v: Version, batch: boolean): DownloadItem => {
      const info = img.versions[v]!;
      return { url: originalUrl(id, img.number, v, batch), name: info.name, size: info.size };
    },
    [id],
  );

  function downloadOne(img: GalleryImage, v: Version) {
    if (!isDownloadable(v)) return; // les RAW ne se téléchargent jamais
    const item = toItem(img, v, false);
    // Téléphone : menu Partager pour enregistrer dans la galerie. Ordinateur : téléchargement direct.
    if (canShareFiles()) setDownloadItems([item]);
    else triggerDownload(item.url);
  }

  function downloadMany(list: GalleryImage[]) {
    if (list.length === 0 || !isDownloadable(version)) return;
    if (list.length === 1) return downloadOne(list[0], version);
    setDownloadItems(list.map((img) => toItem(img, version, true)));
  }

  function toggle(number: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(number)) next.delete(number);
      else next.add(number);
      return next;
    });
  }

  function stopSelecting() {
    setSelecting(false);
    setSelected(new Set());
  }

  if (error) {
    return (
      <>
        <BackLink />
        <p className="error">{error}</p>
      </>
    );
  }
  if (!data) return <GallerySkeleton />;

  const allSelected = images.length > 0 && selected.size === images.length;
  const isRaw = version === 'raw';
  // L'onglet RAW n'apparaît que s'il y a des RAW (l'admin les voit toujours, les modèles seulement si partagés).
  const shownVersions = VERSIONS.filter((v) => v !== 'raw' || counts.raw > 0);

  return (
    <>
      <BackLink />
      <div className="gallery-header">
        <div>
          <h1>{data.shooting.title}</h1>
          <p className="muted">
            {formatShootingDate(data.shooting)} · {counts.original} photo{counts.original > 1 ? 's' : ''}
            {counts.raw > 0 && ` · ${counts.raw} RAW`}
          </p>
        </div>
        {user?.isAdmin && (
          <div className="gallery-admin">
            {counts.raw > 0 && (
              <label className="switch" title="Les modèles qui ont accès à ce shooting pourront voir les RAW (jamais les télécharger)">
                <input
                  type="checkbox"
                  checked={data.shooting.rawsShared}
                  disabled={savingRaws}
                  onChange={(e) => toggleRawsShared(e.target.checked)}
                />
                <span className="switch-track" aria-hidden />
                Partager les RAW
              </label>
            )}
            <Link to={`/admin/shootings?open=${id}`} className="btn btn-ghost">
              Gérer l’accès
            </Link>
          </div>
        )}
      </div>

      {data.duplicates && data.duplicates.length > 0 && (
        <details className="admin-note">
          <summary>
            {data.duplicates.length} fichier{data.duplicates.length > 1 ? 's' : ''} ignoré
            {data.duplicates.length > 1 ? 's' : ''} : numéro déjà utilisé (visible seulement par toi)
          </summary>
          <ul>
            {data.duplicates.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="gallery-toolbar">
        <div className="segmented" role="tablist" aria-label="Version des photos">
          {shownVersions.map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={v === version}
              className={v === version ? 'active' : ''}
              disabled={counts[v] === 0}
              onClick={() => changeVersion(v)}
            >
              {VERSION_LABELS[v]} <span className="count">{counts[v]}</span>
            </button>
          ))}
        </div>
        <div className="toolbar-actions">
          {(favoriteCount > 0 || favoritesOnly) && (
            <button
              className={`btn btn-ghost btn-fav ${favoritesOnly ? 'is-active' : ''}`}
              onClick={() => setFavoritesOnly(!favoritesOnly)}
              aria-pressed={favoritesOnly}
              title={isAdmin ? 'Afficher seulement les photos aimées par les modèles' : 'Afficher seulement mes favoris'}
            >
              ♥ {isAdmin ? 'Aimées' : 'Mes favoris'} ({favoriteCount})
            </button>
          )}
          {isRaw ? (
            <span className="raw-note">🔒 Aperçus protégés · les RAW ne se téléchargent pas</span>
          ) : selecting ? (
            <>
              <button className="btn btn-ghost" onClick={() => setSelected(allSelected ? new Set() : new Set(images.map((i) => i.number)))}>
                {allSelected ? 'Tout désélectionner' : 'Tout sélectionner'}
              </button>
              <button className="btn btn-ghost" onClick={stopSelecting}>
                Annuler
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-ghost" onClick={() => setSelecting(true)} disabled={images.length === 0}>
                Sélectionner
              </button>
              <button className="btn btn-primary" onClick={() => downloadMany(images)} disabled={images.length === 0}>
                Tout télécharger
              </button>
            </>
          )}
        </div>
      </div>

      <div className={`justified ${version === 'story' ? 'justified-tall' : ''}`}>
        {images.map((img, i) => {
          const info = img.versions[version]!;
          const ratio = info.width / info.height;
          const isSelected = selected.has(img.number);
          const liked = likes.has(img.number);
          const fans = likedBy[img.number] ?? [];
          return (
            <div
              key={img.number}
              className={`tile ${selecting ? 'is-selecting' : ''} ${isSelected ? 'is-selected' : ''} ${isRaw ? 'protected' : ''}`}
              onContextMenu={isRaw ? (e) => e.preventDefault() : undefined}
              style={{ flexGrow: ratio, flexBasis: `calc(var(--row-h) * ${ratio})` }}
            >
              <button
                className="tile-open"
                onClick={() => (selecting ? toggle(img.number) : setOpenIndex(i))}
                aria-pressed={selecting ? isSelected : undefined}
                aria-label={`Photo ${img.number}`}
              >
                <FadeImage
                  src={imageUrl(id, img.number, version, 'thumb', info.token)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  style={{ aspectRatio: `${info.width} / ${info.height}` }}
                  draggable={!isRaw}
                />
              </button>
              {selecting && <span className="check" aria-hidden />}
              {isAdmin ? (
                fans.length > 0 && (
                  <span className="like-badge" title={`Aimée par ${fans.join(', ')}`}>
                    ♥ {fans.length}
                  </span>
                )
              ) : (
                <button
                  className={`like-btn ${liked ? 'is-liked' : ''}`}
                  onClick={() => toggleLike(img.number)}
                  aria-pressed={liked}
                  aria-label={liked ? `Retirer la photo ${img.number} des favoris` : `Ajouter la photo ${img.number} aux favoris`}
                >
                  <Heart filled={liked} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {selecting && (
        <div className="selection-bar">
          <span>
            {selected.size} sélectionnée{selected.size > 1 ? 's' : ''}
          </span>
          <button
            className="btn btn-primary"
            disabled={selected.size === 0}
            onClick={() => downloadMany(images.filter((i) => selected.has(i.number)))}
          >
            Valider la sélection
          </button>
        </div>
      )}

      {openIndex !== null && images[openIndex] && (
        <Lightbox
          shootingId={id}
          images={images}
          index={openIndex}
          version={version}
          onIndexChange={setOpenIndex}
          onClose={() => setOpenIndex(null)}
          onDownload={downloadOne}
          liked={(n) => likes.has(n)}
          onToggleLike={isAdmin ? undefined : toggleLike}
          likedBy={isAdmin ? likedBy : undefined}
        />
      )}

      {downloadItems && <DownloadDialog items={downloadItems} onClose={() => setDownloadItems(null)} />}
    </>
  );
}

/** Galerie « fantôme » affichée pendant le chargement. */
function GallerySkeleton() {
  // Proportions variées (photos horizontales et verticales) pour imiter une vraie galerie.
  const ratios = [1.5, 0.67, 1.5, 1.5, 0.67, 0.67, 1.5, 1, 1.5, 0.67, 1.5, 1.5, 0.67, 1.5, 0.67, 1.5];
  return (
    <div aria-busy="true">
      <BackLink />
      <div className="gallery-header">
        <div style={{ width: '100%' }}>
          <div className="skeleton skeleton-line skeleton-title" style={{ width: 'min(340px, 70%)' }} />
          <div className="skeleton skeleton-line skeleton-line-small" style={{ width: 160 }} />
        </div>
      </div>
      <div className="gallery-toolbar">
        <div className="skeleton skeleton-pill" style={{ width: 260 }} />
        <div className="skeleton skeleton-pill" style={{ width: 200 }} />
      </div>
      <div className="justified">
        {ratios.map((ratio, i) => (
          <div
            key={i}
            className="tile skeleton"
            style={{ flexGrow: ratio, flexBasis: `calc(var(--row-h) * ${ratio})`, aspectRatio: ratio }}
          />
        ))}
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/" className="back-link">
      ← Tous les shootings
    </Link>
  );
}
