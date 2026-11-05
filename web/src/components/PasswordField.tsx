import { useState } from 'react';

// Sans caractères faciles à confondre (0/O, 1/l/I) : plus simple à recopier pour la modèle.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generatePassword(): string {
  const bytes = crypto.getRandomValues(new Uint32Array(12));
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  required?: boolean;
}

/** Champ mot de passe visible, avec génération automatique et copie. */
export function PasswordField({ value, onChange, label = 'Mot de passe', required }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // presse-papiers indisponible (HTTP) : le mot de passe reste visible à l'écran
    }
  }

  return (
    <label className="field">
      {label}
      <div className="field-row">
        <input
          type="text"
          autoComplete="new-password"
          spellCheck={false}
          value={value}
          minLength={8}
          required={required}
          onChange={(e) => onChange(e.target.value)}
          placeholder="8 caractères minimum"
        />
        <button type="button" className="btn btn-ghost" onClick={() => onChange(generatePassword())}>
          Générer
        </button>
        <button type="button" className="btn btn-ghost" onClick={copy} disabled={!value}>
          {copied ? 'Copié ✓' : 'Copier'}
        </button>
      </div>
    </label>
  );
}
