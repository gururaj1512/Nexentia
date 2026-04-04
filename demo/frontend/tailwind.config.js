/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        gray: {
          950: '#0a0a0f',
        },
      },
      animation: {
        'flash-red': 'flashRed 0.5s ease-in-out infinite',
        'pulse-green': 'pulseGreen 1s ease-in-out infinite',
      },
      keyframes: {
        flashRed: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.3' },
        },
        pulseGreen: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(34,197,94,0.4)' },
          '50%': { boxShadow: '0 0 0 10px rgba(34,197,94,0)' },
        },
      },
    },
  },
  plugins: [],
};
