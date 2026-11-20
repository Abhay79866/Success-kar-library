import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'warm-white': '#FDFBF7',
        'soft-sand': '#F4EFEA',
        'warm-charcoal': '#2C2A29',
        'warm-muted': '#6E6762',
        'warm-border': '#E4DDD5',
        terracotta: '#D9775B',
        sage: '#7D9B76',
        brick: '#C25E5E',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['var(--font-lora)', 'ui-serif', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};

export default config;
