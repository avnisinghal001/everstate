/** The Everstate hexagon: ink body, clay top face. Same geometry as the landing page favicon. */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true" focusable="false">
      <path d="M13 2 23.4 8v10L13 24 2.6 18V8Z" fill="var(--brand-ink, #141413)" />
      <path d="M13 2 23.4 8 13 14 2.6 8Z" fill="#D97757" />
    </svg>
  );
}
