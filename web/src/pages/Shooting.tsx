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
} from '../api';
import { DownloadDialog } from '../components/DownloadDialog';
import { Lightbox } from '../components/Lightbox';
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

  useEffect(() => {
    setData(null);
    setError(null);
    api
      .get<ShootingDetail>(`/api/shootings/${id}`)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [id]);

  // Images visibles : celles qui existent dans la version choisie.
  const images = useMemo(() => data?.images.filter((i) => i.versions[version]) ?? [], [data, version]);
  const counts = useMemo(() => {
    const c = { original: 0, carre: 0, story: 0 } as Record<Version, number>;
    for (const img of data?.images ?? []) for (const v of VERSIONS) if (img.versions[v]) c[v]++;
    return c;
  }, [data]);

  function changeVersion(v: Version) {
    setVersion(v);
    setSelected(new Set());
  }

  const toItem = useCallback(
    (img: GalleryImage, v: Version, batch: boolean): DownloadItem => {
      const info = img.versions[v]!;
      return { url: originalUrl(id, img.number, v, batch), name: info.name, size: info.size };
    },
    [id],
  );

  function downloadOne(img: GalleryImage, v: Version) {
    const item = toItem(img, v, false);
    // Téléphone : menu Partager pour enregistrer dans la galerie. Ordinateur : téléchargement direct.
    if (canShareFiles()) setDownloadItems([item]);
    else triggerDownload(item.url);
  }

  function downloadMany(list: GalleryImage[]) {
    if (list.length === 0) return;
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
  if (!data) return <p className="muted">Chargement…</p>;

  const allSelected = images.length > 0 && selected.size === images.length;

  return (
    <>
      <BackLink />
      <div className="gallery-header">
        <div>
          <h1>{data.shooting.title}</h1>
          <p className="muted">
            {formatShootingDate(data.shooting)} · {data.images.length} photo{data.images.length > 1 ? 's' : ''}
          </p>
        </div>
        {user?.isAdmin && (
          <Link to={`/admin/shootings?open=${id}`} className="btn btn-ghost">
            Gérer l’accès
          </Link>
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
          {VERSIONS.map((v) => (
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
          {selecting ? (
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
          return (
            <button
              key={img.number}
              className={`tile ${selecting ? 'is-selecting' : ''} ${isSelected ? 'is-selected' : ''}`}
              style={{ flexGrow: ratio, flexBasis: `calc(var(--row-h) * ${ratio})` }}
              onClick={() => (selecting ? toggle(img.number) : setOpenIndex(i))}
              aria-pressed={selecting ? isSelected : undefined}
              aria-label={`Photo ${img.number}`}
            >
              <img
                src={imageUrl(id, img.number, version, 'thumb', info.token)}
                alt=""
                loading="lazy"
                decoding="async"
                style={{ aspectRatio: `${info.width} / ${info.height}` }}
              />
              {selecting && <span className="check" aria-hidden />}
            </button>
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
        />
      )}

      {downloadItems && <DownloadDialog items={downloadItems} onClose={() => setDownloadItems(null)} />}
    </>
  );
}

function BackLink() {
  return (
    <Link to="/" className="back-link">
      ← Tous les shootings
    </Link>
  );
}
