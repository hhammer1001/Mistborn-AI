export function FlameIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={Math.round(size * 1.18)}
      fill="currentColor"
      aria-hidden
    >
      <path d="M8 0c0 2.4-2.5 3.5-2.5 6.4 0 1.4 1 2.4 2 2.4 1 0 1.7-.6 1.7-1.6 0-.5-.2-.9-.4-1.3 1.6 1.3 2.6 2.9 2.6 4.5 0 2.2-2 4-4.4 4S2.6 12.6 2.6 10.4C2.6 7 8 5 8 0z" />
    </svg>
  );
}
