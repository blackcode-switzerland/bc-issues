import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Theme Colors (for @apply compatibility)
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: 'var(--card)',
        'card-foreground': 'var(--card-foreground)',
        primary: 'var(--primary)',
        'primary-foreground': 'var(--primary-foreground)',
        secondary: {
          DEFAULT: '#1c1c24',
          foreground: '#fafafa',
        },
        muted: {
          DEFAULT: '#1c1c24',
          foreground: '#a1a1aa',
        },
        accent: {
          DEFAULT: '#1c1c24',
          foreground: '#fafafa',
        },
        destructive: {
          DEFAULT: '#dc2626',
          foreground: '#fafafa',
        },
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        // Blackcode Brand Colors
        brand: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
          950: '#082f49',
        },
        // Status Colors
        status: {
          backlog: '#6b7280',
          todo: '#3b82f6',
          'in-progress': '#f59e0b',
          blocked: '#ef4444',
          'in-review': '#8b5cf6',
          done: '#10b981',
          cancelled: '#9ca3af',
        },
        // Priority Colors
        priority: {
          low: '#6b7280',
          medium: '#3b82f6',
          high: '#f59e0b',
          urgent: '#ef4444',
        },
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'Consolas', 'monospace'],
      },
      animation: {
        'slide-in': 'slideIn 0.2s ease-out',
        'slide-out': 'slideOut 0.2s ease-in',
        'fade-in': 'fadeIn 0.15s ease-out',
        'scale-in': 'scaleIn 0.15s ease-out',
      },
      keyframes: {
        slideIn: {
          '0%': { transform: 'translateX(-100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        slideOut: {
          '0%': { transform: 'translateX(0)', opacity: '1' },
          '100%': { transform: 'translateX(100%)', opacity: '0' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}

export default config

