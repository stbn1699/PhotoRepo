import { useEffect, useState, type ReactNode } from 'react';

const SRC = '/api/signature';

/**
 * Signature du photographe (le copyright.png du NAS), recolorée aux couleurs du site :
 * l'image sert de pochoir (mask CSS), la couleur vient du thème.
 * Si le fichier n'existe pas, affiche `fallback` (le nom du site).
 */
export function Signature({ className = '', label, fallback }: { className?: string; label: string; fallback: ReactNode }) {
  const [ratio, setRatio] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setRatio(img.naturalWidth / img.naturalHeight);
    img.onerror = () => setRatio(null);
    img.src = SRC;
  }, []);

  if (ratio === undefined) return <span className={`signature-placeholder ${className}`} />;
  if (ratio === null) return <>{fallback}</>;
  return <span className={`signature ${className}`} style={{ aspectRatio: ratio }} role="img" aria-label={label} />;
}
