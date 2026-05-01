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
        plague: {
          black: '#060b06',
          white: '#d4c9b2',
          red: '#cc1414',
          yellow: '#c97a12',
          green: '#39ff14',
          mold: '#5a8a2a',
          border: '#0a100a',
        },
        background: {
          DEFAULT: '#060b06',
          secondary: '#0a100a',
          tertiary: '#0e180d',
          card: '#0c1309',
        },
        foreground: {
          DEFAULT: '#d4c9b2',
          secondary: '#8fa882',
          muted: '#4a5e44',
        },
        accent: {
          bio: '#39ff14',
          blood: '#cc1414',
          bone: '#c8b89a',
          rust: '#c97a12',
          mold: '#5a8a2a',
          bile: '#8bc34a',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'cursive'],
        mono: ['var(--font-mono)', 'monospace'],
        body: ['var(--font-body)', 'sans-serif'],
      },
      boxShadow: {
        brutal: '4px 4px 0px #060b06',
        'brutal-lg': '6px 6px 0px #060b06',
        'brutal-bio': '4px 4px 0px #39ff14',
        'brutal-blood': '4px 4px 0px #cc1414',
        premium: '0 20px 60px rgba(0,0,0,0.7)',
        'glow-bio': '0 0 20px rgba(57, 255, 20, 0.5)',
        'glow-blood': '0 0 20px rgba(204, 20, 20, 0.5)',
        'glow-bone': '0 0 12px rgba(200, 184, 154, 0.3)',
        'glow-rust': '0 0 16px rgba(201, 122, 18, 0.4)',
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
        'flicker': 'flicker 4s linear infinite',
        'toxic-pulse': 'toxic-pulse 2.5s ease-in-out infinite',
        'blood-drip': 'blood-drip 3s ease-in infinite',
        'glitch': 'glitch 0.3s ease-in-out',
        'rot': 'rot 8s ease-in-out infinite',
      },
      keyframes: {
        'pulse-red': {
          '0%, 100%': { boxShadow: '4px 4px 0px #cc1414' },
          '50%': { boxShadow: '6px 6px 0px #cc1414' },
        },
        'infect': {
          '0%': { transform: 'scale(1)', backgroundColor: '#d4c9b2' },
          '50%': { transform: 'scale(1.1)', backgroundColor: '#cc1414' },
          '100%': { transform: 'scale(1)', backgroundColor: '#cc1414' },
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
        'flicker': {
          '0%, 19.9%, 22%, 62.9%, 64%, 64.9%, 70%, 100%': { opacity: '1' },
          '20%, 21.9%, 63%, 63.9%, 65%, 69.9%': { opacity: '0.4' },
        },
        'toxic-pulse': {
          '0%, 100%': { boxShadow: '0 0 8px rgba(57, 255, 20, 0.3)' },
          '50%': { boxShadow: '0 0 28px rgba(57, 255, 20, 0.7), 0 0 56px rgba(57, 255, 20, 0.2)' },
        },
        'blood-drip': {
          '0%': { transform: 'translateY(-100%)', opacity: '0' },
          '10%': { opacity: '1' },
          '80%': { opacity: '1' },
          '100%': { transform: 'translateY(200%)', opacity: '0' },
        },
        'glitch': {
          '0%, 100%': { transform: 'translate(0)' },
          '20%': { transform: 'translate(-3px, 1px)' },
          '40%': { transform: 'translate(3px, -1px)' },
          '60%': { transform: 'translate(-2px, 2px)' },
          '80%': { transform: 'translate(2px, -2px)' },
        },
        'rot': {
          '0%, 100%': { filter: 'hue-rotate(0deg) saturate(1)' },
          '50%': { filter: 'hue-rotate(20deg) saturate(1.2)' },
        },
      },
    },
  },
  plugins: [],
}
