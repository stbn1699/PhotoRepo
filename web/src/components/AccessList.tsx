import { useMemo, useState } from 'react';

export interface AccessItem {
  id: number;
  label: string;
  sublabel?: string;
}

/** Option supplémentaire affichée à côté d'un élément coché (ex. partager les RAW). */
export interface AccessExtra {
  label: string;
  title: string;
  isAvailable: (id: number) => boolean;
  isOn: (id: number) => boolean;
  onToggle: (id: number, on: boolean) => void;
}

interface Props {
  items: AccessItem[];
  extra?: AccessExtra;
  checked: Set<number>;
  onChange: (next: Set<number>) => void;
  searchPlaceholder: string;
  emptyText: string;
  saving?: boolean;
}

/** Liste à cocher avec recherche, pour donner ou retirer des accès. */
export function AccessList({ items, extra, checked, onChange, searchPlaceholder, emptyText, saving }: Props) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = normalize(query);
    return q ? items.filter((i) => normalize(`${i.label} ${i.sublabel ?? ''}`).includes(q)) : items;
  }, [items, query]);

  function toggle(id: number) {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  if (items.length === 0) return <p className="muted">{emptyText}</p>;

  return (
    <div className="access-list">
      <div className="access-list-head">
        {items.length > 6 && (
          <input
            className="search"
            type="search"
            placeholder={searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        <span className="muted small">
          {checked.size} / {items.length} {saving ? '· enregistrement…' : '· enregistré automatiquement'}
        </span>
      </div>
      <ul>
        {filtered.map((item) => (
          <li key={item.id} className={`access-row ${checked.has(item.id) ? 'is-checked' : ''}`}>
            <label>
              <input type="checkbox" checked={checked.has(item.id)} onChange={() => toggle(item.id)} />
              <span>
                {item.label}
                {item.sublabel && <span className="muted small"> · {item.sublabel}</span>}
              </span>
            </label>
            {extra && checked.has(item.id) && extra.isAvailable(item.id) && (
              <label className="switch switch-small" title={extra.title}>
                <input
                  type="checkbox"
                  checked={extra.isOn(item.id)}
                  onChange={(e) => extra.onToggle(item.id, e.target.checked)}
                />
                <span className="switch-track" aria-hidden />
                {extra.label}
              </label>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}
