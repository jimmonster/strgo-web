/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,html}'],
  theme: { extend: {
    colors: { void: '#040407', cyber: '#00dfd8', electric: '#7928ca', neon: '#ff0080' },
    zIndex: { background: '0', spotlight: '1', content: '10', navbar: '50', noise: '90', cursor: '100' },
    animation: {
      'aurora-drift': 'aurora 20s ease-in-out infinite alternate',
      'text-shimmer': 'shimmer 3.5s linear infinite',
      'border-spin': 'border-spin 4s linear infinite',
      'pulse-glow': 'pulse-glow 3s cubic-bezier(0.4, 0, 0.6, 1) infinite'
    },
    keyframes: {
      aurora: { '0%': { transform: 'translate(0, 0) scale(1)' }, '50%': { transform: 'translate(80px, -60px) scale(1.15)' }, '100%': { transform: 'translate(-60px, 50px) scale(0.9)' } },
      shimmer: { '0%': { backgroundPosition: '200% center' }, '100%': { backgroundPosition: '-200% center' } },
      'border-spin': { '100%': { transform: 'rotate(360deg)' } },
      'pulse-glow': { '0%, 100%': { opacity: '0.4', filter: 'brightness(1)' }, '50%': { opacity: '0.85', filter: 'brightness(1.4)' } }
    }
  } },
  plugins: []
};
