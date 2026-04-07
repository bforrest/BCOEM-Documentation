const PALETTE = [
  '#0969da', // blue
  '#2da44e', // green
  '#6e40c9', // purple
  '#cf222e', // red
  '#bf8700', // yellow
  '#1b7c83', // teal
  '#e16f24', // orange
  '#8250df', // violet
];

/**
 * Deterministically maps an author name to a palette color.
 * @param {string} name
 * @returns {string} hex color
 */
export function avatarColor(name) {
  if (!name) return PALETTE[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

/**
 * Returns up to 2 initials from a name.
 * Multi-word names use the first letter of each of the first two words.
 * Single words use the first two characters.
 * @param {string} name
 * @returns {string}
 */
export function avatarInitials(name) {
  if (!name || !name.trim()) return '?';
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}
