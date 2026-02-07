import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Steam-inspired color palette
        steam: {
          dark: '#1b2838',
          darker: '#171a21',
          blue: '#1a9fff',
          green: '#4c6b22',
          sale: '#4c6b22',
        },
        deal: {
          great: '#22c55e',   // Green - at/near ATL
          good: '#84cc16',    // Lime - good discount
          okay: '#eab308',    // Yellow - moderate
          poor: '#ef4444',    // Red - bad deal / above avg
        },
      },
    },
  },
  plugins: [],
};

export default config;
