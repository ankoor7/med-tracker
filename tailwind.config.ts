import type { Config } from 'tailwindcss';

// Design tokens — Stage 19 minimalistic, clean theme.
//
// Colour, radius and shadow values are NOT hardcoded here: they read CSS
// custom properties defined in `src/ui/tokens.css` (the token layer), which
// is theme-aware (`:root` = light, `:root[data-theme="dark"]` = dark, with
// `prefers-color-scheme` as the initial signal). That keeps light/dark to a
// single variable swap while every existing `slate-*`/`accent-*`/`status-*`
// utility class across the app keeps resolving unchanged — see tokens.css's
// documentation header for the full rationale and the WCAG-AA contrast pairs
// each token was chosen to satisfy.
//
// Each token is wired via `withOpacityValue`, not a bare `var(--x)`: the
// existing screens use Tailwind's opacity-modifier syntax extensively
// (`bg-accent/15`, `bg-slate-900/80`, `text-status-taken/90`, …). Tailwind
// can only apply an opacity modifier to a colour value in a format it
// controls (`rgb(var(--x) / <alpha-value>)`); a bare hex-string variable
// makes it silently drop the whole utility. tokens.css therefore stores
// each colour as an `R G B` channel triple for this helper to consume.
function withOpacityValue(variable: string): string {
  // The tailwindcss type definitions don't model Tailwind's documented
  // "opacity-aware color function" pattern (a function is valid at runtime;
  // the shipped types only allow strings) — cast at the boundary rather than
  // widen `Config`'s type and lose real type-checking everywhere else.
  const fn = ({ opacityValue }: { opacityValue?: string }) => {
    if (opacityValue === undefined) {
      return `rgb(var(${variable}))`;
    }
    return `rgb(var(${variable}) / ${opacityValue})`;
  };
  return fn as unknown as string;
}

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Neutral ramp — remapped so existing `slate-*` classes adopt the
        // theme automatically. By convention within this ramp: 950/900 are
        // surfaces (app background / cards), 800 is the border tone, and
        // 50-500 run from primary text down to muted text. Each theme's
        // tokens.css block inverts the concrete hex values so this ordering
        // holds in both light and dark.
        slate: {
          50: withOpacityValue('--sd-slate-50-rgb'),
          100: withOpacityValue('--sd-slate-100-rgb'),
          200: withOpacityValue('--sd-slate-200-rgb'),
          300: withOpacityValue('--sd-slate-300-rgb'),
          400: withOpacityValue('--sd-slate-400-rgb'),
          500: withOpacityValue('--sd-slate-500-rgb'),
          600: withOpacityValue('--sd-slate-600-rgb'),
          700: withOpacityValue('--sd-slate-700-rgb'),
          800: withOpacityValue('--sd-slate-800-rgb'),
          900: withOpacityValue('--sd-slate-900-rgb'),
          950: withOpacityValue('--sd-slate-950-rgb'),
        },
        // Single calm accent — used for primary actions and emphasis.
        accent: {
          DEFAULT: withOpacityValue('--sd-accent-rgb'),
          fg: withOpacityValue('--sd-accent-fg-rgb'),
          muted: withOpacityValue('--sd-accent-muted-rgb'),
        },
        // Status colours — kept legible (AA) against both themes' surfaces.
        status: {
          taken: withOpacityValue('--sd-status-taken-rgb'),
          due: withOpacityValue('--sd-status-due-rgb'),
          missed: withOpacityValue('--sd-status-missed-rgb'),
          upcoming: withOpacityValue('--sd-status-upcoming-rgb'),
        },
      },
      fontFamily: {
        // Clean system sans — no bespoke rounded-font emulation.
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'system-ui',
          'sans-serif',
        ],
      },
      borderRadius: {
        '2xl': 'var(--sd-radius-lg)',
        '3xl': 'var(--sd-radius-xl)',
      },
      boxShadow: {
        soft: 'var(--sd-shadow-soft)',
      },
    },
  },
  plugins: [],
};

export default config;
