// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://smithadifd.github.io',
  base: '/hoard',
  integrations: [
    starlight({
      title: 'Hoard',
      description: 'Self-hosted game deal tracker and backlog manager. Reference docs and self-hosting guide.',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/smithadifd/hoard',
        },
      ],
      sidebar: [
        {
          label: 'Architecture',
          items: [
            { label: 'How it works', link: '/architecture/' },
            { label: 'Scoring engine', link: '/architecture/scoring-engine/' },
          ],
        },
        {
          label: 'Features',
          items: [
            { label: 'Overview', link: '/features/' },
            { label: 'Discord alerts', link: '/features/alerts/' },
            { label: 'Backlog recommender', link: '/features/backlog/' },
          ],
        },
        {
          label: 'Self-hosting',
          items: [
            { label: 'Guide', link: '/self-hosting/' },
            { label: 'Configuration', link: '/self-hosting/configuration/' },
            { label: 'Backup and restore', link: '/self-hosting/backups/' },
            { label: 'Upgrading', link: '/self-hosting/upgrading/' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Design decisions', link: '/design-decisions/' },
            { label: 'Data sources', link: '/data-sources/' },
            { label: 'Demo mode', link: '/demo/' },
            { label: 'Changelog', link: '/changelog/' },
          ],
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/smithadifd/hoard/edit/main/docs/',
      },
      lastUpdated: true,
    }),
  ],
});
