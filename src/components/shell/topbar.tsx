export function Topbar({ title }: { title?: string }) {
  return (
    <header className="flex h-12 shrink-0 items-center border-b border-[var(--color-border)] bg-[var(--color-bg)] px-[var(--spacing-6)]">
      {title && (
        <h1 className="text-sm font-medium text-[var(--color-text)]">{title}</h1>
      )}
    </header>
  );
}
