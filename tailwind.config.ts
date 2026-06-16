import type { Config } from 'tailwindcss';

// Design tokens (architecture): neutral slate chrome, teal accent.
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Teal accent — primary action / brand.
        accent: {
          DEFAULT: '#0f766e', // teal-700
          fg: '#ffffff',
          muted: '#5eead4', // teal-300
        },
        // Status colours used by Today / History.
        status: {
          taken: '#16a34a', // green-600
          due: '#ca8a04', // yellow-600
          missed: '#dc2626', // red-600
          upcoming: '#64748b', // slate-500
        },
      },
    },
  },
  plugins: [],
};

export default config;
