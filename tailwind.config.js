const path = require('path');

/** @type {import('tailwindcss').Config} */
module.exports = {
  // Absolute paths — lib/connection.ts does process.chdir() to the DuckLake
  // metadata dir at bootstrap, so relative content globs miss all source files.
  content: [
    path.join(__dirname, 'app/**/*.{ts,tsx}'),
    path.join(__dirname, 'components/**/*.{ts,tsx}'),
  ],
  theme: {
    extend: {
      colors: {
        // Backgrounds — warm cream, DuckDB doc aesthetic
        bg: '#FDF9EE',
        surface: '#FFFFFF',
        raised: '#F5EED6',
        // Text
        ink: '#1F1D18',
        dim: '#78706A',
        dim2: '#A69C90',
        // Borders
        line: '#E8DFC7',
        line2: '#D6CBB2',
        // Brand — DuckDB pure yellow (used mainly as background highlight)
        brandHi: '#FFF000',
        // Readable brand accent for text on cream (dark amber)
        brand: '#B45309',
        // Accent palette (all readable on cream)
        amber: '#D97706',
        teal: '#0E7C6D',
        violet: '#6D28D9',
        coral: '#DC2626',
        green: '#059669',
        red: '#DC2626',
      },
      fontFamily: {
        sans: [
          'Jost', '-apple-system', 'BlinkMacSystemFont', '"Inter"', 'system-ui', 'sans-serif',
        ],
        mono: [
          '"JetBrains Mono"', '"SF Mono"', 'ui-monospace', 'Menlo', 'Consolas', 'monospace',
        ],
      },
    },
  },
};
