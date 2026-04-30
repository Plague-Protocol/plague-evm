/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Legacy neobrutalist palette (kept for compatibility)
        plague: {
          black: '#0a0a0a',
          white: '#f5f0e8',
          red: '#e63329',
          yellow: '#f5c518',
          green: '#1a7a4a',
          purple: '#6b21a8',
          border: '#0a0a0a',
        },
        // New dark game palette
        background: {
          DEFAULT: '#0a0e27',
          secondary: '#12172c',
          tertiary: '#1a1f3a',
          card: '#161b35',
        },
        foreground: {
          DEFAULT: '#f0f4f8',
          secondary: '#b4c1d1',
          muted: '#7a8592',
        },
        accent: {
          purple: '#a855f7',
          cyan: '#06b6d4',
          lime: '#84cc16',
          coral: '#ff6b6b',
          pink: '#ec4899',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'serif'],
        mono: ['var(--font-mono)', 'monospace'],
        body: ['var(--font-body)', 'sans-serif'],
      },
      boxShadow: {
        brutal: '4px 4px 0px #0a0a0a',
        'brutal-lg': '6px 6px 0px #0a0a0a',
        'brutal-red': '4px 4px 0px #e63329',
        premium: '0 20px 60px rgba(0,0,0,0.5)',
        'glow-purple': '0 0 20px rgba(168, 85, 247, 0.4)',
        'glow-cyan': '0 0 20px rgba(6, 182, 212, 0.4)',
        'glow-lime': '0 0 20px rgba(132, 204, 22, 0.4)',
        'glow-coral': '0 0 20px rgba(255, 107, 107, 0.4)',
      },
      borderWidth: {
        3: '3px',
      },
      animation: {
        'pulse-red': 'pulse-red 1.5s ease-in-out infinite',
        'infect': 'infect 0.6s ease-out forwards',
        'shake': 'shake 0.4s ease-in-out',
        'float-up': 'float-up 0.6s ease-out both',
        'slide-in-left': 'slide-in-left 0.6s ease-out both',
        'slide-in-right': 'slide-in-right 0.6s ease-out both',
        'scale-in': 'scale-in 0.6s ease-out both',
      },
      keyframes: {
        'pulse-red': {
          '0%, 100%': { boxShadow: '4px 4px 0px #e63329' },
          '50%': { boxShadow: '6px 6px 0px #e63329' },
        },
        'infect': {
          '0%': { transform: 'scale(1)', backgroundColor: '#f5f0e8' },
          '50%': { transform: 'scale(1.1)', backgroundColor: '#e63329' },
          '100%': { transform: 'scale(1)', backgroundColor: '#e63329' },
        },
        'shake': {
          '0%, 100%': { transform: 'translateX(0)' },
          '25%': { transform: 'translateX(-4px)' },
          '75%': { transform: 'translateX(4px)' },
        },
        'float-up': {
          from: { transform: 'translateY(0)', opacity: '0' },
          to: { transform: 'translateY(-8px)', opacity: '1' },
        },
        'slide-in-left': {
          from: { transform: 'translateX(-20px)', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(20px)', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' },
        },
        'scale-in': {
          from: { transform: 'scale(0.94)', opacity: '0' },
          to: { transform: 'scale(1)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
