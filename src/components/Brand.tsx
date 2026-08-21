export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand-lockup" aria-label="Rashika Kapoor">
      <span className="brand-monogram">RK</span>
      {!compact && <span className="brand-name">Rashika Kapoor</span>}
    </span>
  );
}
