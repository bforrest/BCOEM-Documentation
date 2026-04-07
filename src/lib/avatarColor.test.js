import { describe, it, expect } from 'vitest';
import { avatarColor, avatarInitials } from './avatarColor.js';

describe('avatarColor', () => {
  it('returns a hex color string', () => {
    const color = avatarColor('BCOEMSupport');
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('is deterministic — same name always returns same color', () => {
    expect(avatarColor('Alice')).toBe(avatarColor('Alice'));
  });

  it('returns different colors for different names', () => {
    // Not guaranteed but very likely with a palette of 8+
    const colors = ['Alice', 'Bob', 'Carol', 'Dave'].map(avatarColor);
    const unique = new Set(colors);
    expect(unique.size).toBeGreaterThan(1);
  });
});

describe('avatarInitials', () => {
  it('returns up to 2 characters from the name', () => {
    expect(avatarInitials('BCOEMSupport')).toBe('BC');
  });

  it('returns single char for single-char names', () => {
    expect(avatarInitials('X')).toBe('X');
  });

  it('uses first letter of each word for multi-word names', () => {
    expect(avatarInitials('Original Poster')).toBe('OP');
  });

  it('handles empty string gracefully', () => {
    expect(avatarInitials('')).toBe('?');
  });
});
