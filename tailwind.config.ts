import type { Config } from 'tailwindcss';

// Design tokens — Oura-inspired calm dark theme (Stage 16 redesign).
//
// The whole app is built on Tailwind's `slate-*` utilities, so the cheapest way
// to re-skin every screen cohesively is to remap the slate ramp itself to a
// deep, cool, near-black palette (Oura's signature surface) with soft mid-tones.
// Components then layer rounded cards, pill buttons, big readouts, and a circular
// ring gauge on top.
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Deep, cool greyscale — remapped so existing `slate-*` classes adopt
        // the new look automatically. 950 = app base, 900 = cards, 800 = borders.
        slate: {
          50: '#f3f6f9',
          100: '#e6ecf2',
          200: '#cbd5e0',
          300: '#a7b4c4',
          400: '#7f8da0', // secondary text
          500: '#5c6979', // muted text
          600: '#3c4658',
          700: '#28313f',
          800: '#1b2330',
          900: '#111722',
          950: '#0a0e16',
        },
        // Soft teal/cyan accent — calm, Oura-like.
        accent: {
          DEFAULT: '#2cb1a6',
          fg: '#04120f',
          muted: '#7fe7dc',
        },
        // Status colours, softened toward pastels for the calmer palette.
        status: {
          taken: '#4ade80', // green-400
          due: '#fbbf24', // amber-400
          missed: '#fb7185', // rose-400
          upcoming: '#7f8da0',
        },
      },
      fontFamily: {
        sans: [
          'ui-rounded',
          '"SF Pro Rounded"',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'system-ui',
          'sans-serif',
        ],
      },
      borderRadius: {
        '2xl': '1.1rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        soft: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 12px 30px -18px rgba(0,0,0,0.7)',
      },
    },
  },
  plugins: [],
};

export default config;
