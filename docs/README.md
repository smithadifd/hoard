# Hoard docs

Astro Starlight documentation site for [Hoard](../). Published via GitHub Pages.

## Local development

```bash
cd docs
npm install
npm run dev
```

Dev server runs on `http://localhost:4321/hoard/`.

## Build

```bash
npm run build
```

Output goes to `docs/dist/`.

## Deploy

Pushes to `main` that touch `docs/**` trigger `.github/workflows/docs.yml`, which builds the site and publishes to GitHub Pages at `https://smithadifd.github.io/hoard/`.

## Structure

```
docs/
├── astro.config.mjs      # Site config + sidebar
├── package.json
├── tsconfig.json
└── src/
    ├── content.config.ts # Starlight content collection
    └── content/docs/     # Markdown pages
```
