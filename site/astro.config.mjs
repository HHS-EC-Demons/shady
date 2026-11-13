import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

const icons = ['ArrowCounterClockwise', 'ArrowsOut', 'CalendarBlank', 'CaretDown', 'CaretLeft', 'CaretRight', 'Check', 'LinkSimple', 'MagnifyingGlass', 'Plant', 'Printer', 'Thermometer', 'Trash', 'Tree', 'Umbrella', 'X'];

export default defineConfig({
  site: process.env.SITE_URL || 'http://localhost:4321',
  base: process.env.BASE_PATH || '/',
  trailingSlash: 'ignore',
  integrations: [react()],
  devToolbar: { enabled: false },
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: [...icons.map((name) => `@phosphor-icons/react/dist/csr/${name}`), 'qrcode.react', 'react-day-picker'],
    },
  },
});
