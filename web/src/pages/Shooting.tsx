import { Link } from 'react-router-dom';

// La galerie arrive à l'étape 2.
export function ShootingPage() {
  return (
    <>
      <p>
        <Link to="/">← Retour</Link>
      </p>
      <p className="empty">La galerie arrive bientôt.</p>
    </>
  );
}
