import { useEffect, useMemo, useRef, useState } from 'react';
import {
  canPickFolder,
  canShareFiles,
  fetchAsFile,
  formatBytes,
  pickFolder,
  saveToFolder,
  splitInBatches,
  triggerDownload,
  wait,
  type DownloadItem,
} from '../downloads';

interface Props {
  items: DownloadItem[];
  onClose: () => void;
}

/**
 * Fenêtre de téléchargement de plusieurs photos (ou d'une seule sur téléphone).
 *  - Téléphone : par paquets, via le menu « Partager » → les photos vont dans la galerie.
 *  - Ordinateur : dans un dossier choisi (Chrome/Edge) ou une par une dans Téléchargements.
 */
export function DownloadDialog({ items, onClose }: Props) {
  const share = useMemo(canShareFiles, []);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        {share ? <ShareFlow items={items} onClose={onClose} /> : <DesktopFlow items={items} onClose={onClose} />}
      </div>
    </div>
  );
}

function Progress({ value, total }: { value: number; total: number }) {
  return (
    <div className="progress">
      <div className="progress-bar" style={{ width: `${total ? Math.min(100, (value / total) * 100) : 0}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Téléphone : menu Partager, par paquets
// ---------------------------------------------------------------------------

function ShareFlow({ items, onClose }: Props) {
  const batches = useMemo(() => splitInBatches(items), [items]);
  const [batchIndex, setBatchIndex] = useState(0);
  const [phase, setPhase] = useState<'fetching' | 'ready' | 'done' | 'error'>('fetching');
  const [files, setFiles] = useState<File[]>([]);
  const [loaded, setLoaded] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const batch = batches[batchIndex];
  const batchBytes = batch?.reduce((sum, i) => sum + i.size, 0) ?? 0;

  // Récupère les photos du paquet en cours.
  useEffect(() => {
    if (!batch) return;
    const controller = new AbortController();
    setPhase('fetching');
    setLoaded(0);
    setFiles([]);
    (async () => {
      const result: File[] = [];
      for (const item of batch) {
        result.push(await fetchAsFile(item, controller.signal, (n) => setLoaded((l) => l + n)));
      }
      setFiles(result);
      setPhase('ready');
    })().catch((err) => {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Erreur');
      setPhase('error');
    });
    return () => controller.abort();
  }, [batch]);

  async function save() {
    try {
      await navigator.share({ files });
      setFiles([]); // libère la mémoire
      if (batchIndex + 1 < batches.length) setBatchIndex(batchIndex + 1);
      else setPhase('done');
    } catch (err) {
      // Menu fermé sans enregistrer : on laisse le bouton pour réessayer.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Erreur');
      setPhase('error');
    }
  }

  const multi = batches.length > 1;
  const title = items.length === 1 ? 'Enregistrer la photo' : `Enregistrer ${items.length} photos`;

  return (
    <>
      <h2>{title}</h2>
      {phase === 'fetching' && (
        <>
          <p className="muted">
            {multi ? `Paquet ${batchIndex + 1} sur ${batches.length} : ` : ''}
            préparation… {formatBytes(loaded)} / {formatBytes(batchBytes)}
          </p>
          <Progress value={loaded} total={batchBytes} />
        </>
      )}
      {phase === 'ready' && (
        <>
          <p className="muted">
            {multi ? `Paquet ${batchIndex + 1} sur ${batches.length} prêt. ` : ''}
            Touche le bouton puis choisis <strong>« Enregistrer les images »</strong> pour les mettre dans ta galerie.
          </p>
          <button className="btn btn-primary btn-block" onClick={save}>
            {multi
              ? `Enregistrer le paquet ${batchIndex + 1}/${batches.length} (${batch.length} photo${batch.length > 1 ? 's' : ''})`
              : items.length === 1
                ? 'Enregistrer'
                : `Enregistrer les ${items.length} photos`}
          </button>
        </>
      )}
      {phase === 'done' && <p>C’est fait ! Les photos sont dans ta galerie.</p>}
      {phase === 'error' && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>
          {phase === 'done' ? 'Fermer' : 'Annuler'}
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Ordinateur : dossier choisi, ou une par une dans Téléchargements
// ---------------------------------------------------------------------------

function DesktopFlow({ items, onClose }: Props) {
  const folderSupported = useMemo(canPickFolder, []);
  const [phase, setPhase] = useState<'choose' | 'running' | 'done' | 'error'>('choose');
  const [doneCount, setDoneCount] = useState(0);
  const [loaded, setLoaded] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef(new AbortController());
  const totalBytes = items.reduce((sum, i) => sum + i.size, 0);

  useEffect(() => {
    controller.current = new AbortController();
    return () => controller.current.abort();
  }, []);

  async function toFolder() {
    let dir;
    try {
      dir = await pickFolder();
    } catch {
      return; // fenêtre de choix fermée
    }
    setPhase('running');
    try {
      for (const item of items) {
        await saveToFolder(dir, item, controller.current.signal, (n) => setLoaded((l) => l + n));
        setDoneCount((c) => c + 1);
      }
      setPhase('done');
    } catch (err) {
      if (controller.current.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Erreur');
      setPhase('error');
    }
  }

  const started = useRef(false);
  async function oneByOne() {
    if (started.current) return;
    started.current = true;
    setPhase('running');
    for (const item of items) {
      if (controller.current.signal.aborted) return;
      triggerDownload(item.url);
      setDoneCount((c) => c + 1);
      await wait(700); // laisse le navigateur démarrer chaque téléchargement
    }
    setPhase('done');
  }

  // Sans choix de dossier possible, on lance directement.
  useEffect(() => {
    if (!folderSupported) void oneByOne();
  }, []);

  return (
    <>
      <h2>Télécharger {items.length} photo{items.length > 1 ? 's' : ''}</h2>
      <p className="muted">{formatBytes(totalBytes)} au total, en qualité d’origine.</p>
      {phase === 'choose' && (
        <div className="modal-choices">
          <button className="btn btn-primary btn-block" onClick={toFolder}>
            Choisir un dossier
          </button>
          <button className="btn btn-ghost btn-block" onClick={oneByOne}>
            Une par une dans Téléchargements
          </button>
          <p className="muted small">
            Une par une : ton navigateur peut demander l’autorisation de télécharger plusieurs fichiers.
          </p>
        </div>
      )}
      {phase === 'running' && (
        <>
          <p className="muted">
            {doneCount} / {items.length}
            {loaded > 0 && ` · ${formatBytes(loaded)}`}
          </p>
          <Progress value={loaded > 0 ? loaded : doneCount} total={loaded > 0 ? totalBytes : items.length} />
        </>
      )}
      {phase === 'done' && <p>Terminé !</p>}
      {phase === 'error' && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>
          {phase === 'done' ? 'Fermer' : 'Annuler'}
        </button>
      </div>
    </>
  );
}
