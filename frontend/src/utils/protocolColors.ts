/**
 * Centralized protocol color mapping using CSS variables.
 *
 * Each protocol resolves to a `var(--protocol-<name>)` CSS variable so
 * colors automatically adapt when the user switches themes.
 */

export type Protocol = 'ssh' | 'rdp' | 'vnc' | 'telnet' | 'ftp';

/** CSS variable string for each protocol – safe to use in `style={{ color }}` or Tailwind arbitrary values. */
export const PROTOCOL_COLORS: Record<Protocol, string> = {
  ssh: 'var(--protocol-ssh)',
  rdp: 'var(--protocol-rdp)',
  vnc: 'var(--protocol-vnc)',
  telnet: 'var(--protocol-telnet)',
  ftp: 'var(--protocol-ftp)',
};

/**
 * Resolve a protocol string to its CSS variable color.
 * Returns a neutral fallback for unknown protocols.
 */
export function getProtocolColor(protocol: string): string {
  const key = protocol.toLowerCase() as Protocol;
  return PROTOCOL_COLORS[key] ?? 'var(--text-muted)';
}
