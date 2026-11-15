import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWithProgress, formatBytes, saveBlob, wait, type DownloadItem } from '../downloads';

interface Props {
  items: DownloadItem[];
  onClose: () => void;
}

/** Nombre de photos téléchargées en même temps. */
const PARALLEL = 5;
/** Essais par photo avant de la marquer en échec. */
const ATTEMPTS = 3;

type Status = 'waiting' | 'downloading' | 'saved' | 'failed';

interface Task {
  item: DownloadItem;
  status: Status;
  received: number;
  attempt: number;
  error?: string;
}

/**
 * Téléchargement de plusieurs photos, 5 à la fois au maximum.
 * Chaque photo est d'abord reçue entièrement par le site (on suit sa progression), puis enregistrée
 * d'un coup sur l'appareil : pas de fichier à moitié téléchargé. En cas d'erreur réseau, la photo
 * est retentée automatiquement, puis proposée avec un bouton « Réessayer ».
 */
export function DownloadDialog({ items, onClose }: Props) {
  const tasks = useRef<Task[]>(items.map((item) => ({ item, status: 'waiting', received: 0, attempt: 0 })));
  const controller = useRef(new AbortController());
  const active = useRef(0);
  const [, setTick] = useState(0);

  // Rafraîchit l'affichage au plus une fois par image (la progression arrive très souvent).
  const frame = useRef<number | null>(null);
  const render = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setTick((t) => t + 1);
    });
  }, []);

  const pump = useCallback(() => {
    const signal = controller.current.signal;
    while (!signal.aborted && active.current < PARALLEL) {
      const task = tasks.current.find((t) => t.status === 'waiting');
      if (!task) break;
      active.current++;
      task.status = 'downloading';
      void (async () => {
        for (task.attempt = 1; task.attempt <= ATTEMPTS; task.attempt++) {
          task.received = 0;
          task.error = undefined;
          render();
          try {
            const blob = await fetchWithProgress(task.item.url, signal, (received) => {
              task.received = received;
              render();
            });
            saveBlob(blob, task.item.name);
            task.status = 'saved';
            break;
          } catch (err) {
            if (signal.aborted) {
              task.status = 'waiting';
              break;
            }
            task.error = err instanceof Error ? err.message : 'Erreur';
            if (task.attempt < ATTEMPTS) await wait(task.attempt * 2000); // 2 s, puis 4 s
            else task.status = 'failed';
          }
        }
        active.current--;
        render();
        pump();
      })();
    }
    render();
  }, [render]);

  // Démarrage, et arrêt de tout ce qui est en cours si la fenêtre se ferme.
  useEffect(() => {
    controller.current = new AbortController();
    pump();
    return () => controller.current.abort();
  }, [pump]);

  const list = tasks.current;
  const saved = list.filter((t) => t.status === 'saved');
  const failed = list.filter((t) => t.status === 'failed');
  const downloading = list.filter((t) => t.status === 'downloading');
  const finished = downloading.length === 0 && !list.some((t) => t.status === 'waiting');
  const totalBytes = list.reduce((sum, t) => sum + t.item.size, 0);
  const doneBytes = list.reduce((sum, t) => sum + (t.status === 'saved' ? t.item.size : t.received), 0);

  // Empêche l'écran de se mettre en veille pendant le téléchargement (si le navigateur le permet).
  useEffect(() => {
    if (finished || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const acquire = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.wakeLock
        .request('screen')
        .then((l) => (lock = l))
        .catch(() => {});
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release().catch(() => {});
    };
  }, [finished]);

  function retryFailed() {
    for (const t of failed) {
      t.status = 'waiting';
      t.received = 0;
      t.attempt = 0;
      t.error = undefined;
    }
    pump();
  }

  function stop() {
    controller.current.abort();
    onClose();
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h2>
          Téléchargement de {list.length} photo{list.length > 1 ? 's' : ''}
        </h2>

        <div className="dl-summary">
          <span>
            <strong>{saved.length}</strong> / {list.length} enregistrée{saved.length > 1 ? 's' : ''}
          </span>
          <span className="muted">
            {formatBytes(doneBytes)} / {formatBytes(totalBytes)}
          </span>
        </div>
        <div className="progress">
          <div className="progress-bar" style={{ width: `${totalBytes ? (doneBytes / totalBytes) * 100 : 0}%` }} />
        </div>

        {downloading.length > 0 && (
          <ul className="dl-list">
            {downloading.map((t) => (
              <li key={t.item.url}>
                <span className="dl-name">{t.item.name}</span>
                <span className="muted small">
                  {t.error ? `nouvel essai (${t.attempt}/${ATTEMPTS})…` : `${Math.round((t.received / (t.item.size || 1)) * 100)} %`}
                </span>
                <div className="progress progress-thin">
                  <div className="progress-bar" style={{ width: `${(t.received / (t.item.size || 1)) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}

        {failed.length > 0 && (
          <div className="dl-failed">
            <p className="error">
              {failed.length} photo{failed.length > 1 ? 's' : ''} n’{failed.length > 1 ? 'ont' : 'a'} pas pu être
              téléchargée{failed.length > 1 ? 's' : ''} : {failed.map((t) => t.item.name).join(', ')}
            </p>
            {finished && (
              <button className="btn btn-primary" onClick={retryFailed}>
                Réessayer
              </button>
            )}
          </div>
        )}

        {finished && failed.length === 0 && <p>Terminé ! Les photos sont dans tes téléchargements.</p>}
        {!finished && (
          <p className="muted small">
            Garde cette page ouverte jusqu’à la fin. Si ton navigateur demande l’autorisation de télécharger plusieurs
            fichiers, accepte.
          </p>
        )}

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={finished ? onClose : stop}>
            {finished ? 'Fermer' : 'Arrêter'}
          </button>
        </div>
      </div>
    </div>
  );
}
