import { useEffect, useRef, useState } from 'react';
import { formatBytes, triggerDownload, wait, type DownloadItem } from '../downloads';

interface Props {
  items: DownloadItem[];
  onClose: () => void;
}

/**
 * Téléchargement de plusieurs photos : elles sont téléchargées directement, l'une après l'autre.
 * Le navigateur peut demander une fois l'autorisation de télécharger plusieurs fichiers.
 */
export function DownloadDialog({ items, onClose }: Props) {
  const [done, setDone] = useState(0);
  const cancelled = useRef(false);
  const started = useRef(false);
  const totalBytes = items.reduce((sum, i) => sum + i.size, 0);
  const finished = done >= items.length;

  useEffect(() => {
    cancelled.current = false;
    if (started.current) return; // en dev, React lance les effets deux fois
    started.current = true;
    void (async () => {
      for (const item of items) {
        if (cancelled.current) return;
        triggerDownload(item.url);
        setDone((d) => d + 1);
        await wait(800); // laisse le navigateur démarrer chaque téléchargement
      }
    })();
    return () => {
      cancelled.current = true;
    };
  }, [items]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h2>
          Téléchargement de {items.length} photo{items.length > 1 ? 's' : ''}
        </h2>
        <p className="muted">{formatBytes(totalBytes)} au total, en qualité d’origine.</p>
        {finished ? (
          <p>Terminé ! Les photos sont dans tes téléchargements.</p>
        ) : (
          <>
            <p className="muted">
              {done} / {items.length}
            </p>
            <div className="progress">
              <div className="progress-bar" style={{ width: `${(done / items.length) * 100}%` }} />
            </div>
            <p className="muted small">Si ton navigateur demande l’autorisation de télécharger plusieurs fichiers, accepte.</p>
          </>
        )}
        <div className="modal-actions">
          <button
            className="btn btn-ghost"
            onClick={() => {
              cancelled.current = true;
              onClose();
            }}
          >
            {finished ? 'Fermer' : 'Arrêter'}
          </button>
        </div>
      </div>
    </div>
  );
}
