/** Cœur des favoris (plein quand la photo est aimée). */
export function Heart({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
      <path
        d="M12 20.4l-1.3-1.2C6 14.9 3 12.2 3 8.8 3 6 5.2 3.9 7.9 3.9c1.6 0 3.1.7 4.1 1.9 1-1.2 2.5-1.9 4.1-1.9 2.7 0 4.9 2.1 4.9 4.9 0 3.4-3 6.1-7.7 10.4L12 20.4z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}
