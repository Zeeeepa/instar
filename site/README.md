# Instar Landing Page

Landing page for [instar.sh](https://instar.sh) — built with Astro.

## Development

```bash
npm install
npm run dev       # Local dev server at localhost:4321
npm run build     # Production build to ./dist/
npm run preview   # Preview production build
```

## Deployment

Static site deployed to Vercel. Uses `@astrojs/vercel` adapter.

## Structure

```
src/
  pages/
    index.astro     # Single-page landing
  layouts/
    Layout.astro    # Base layout with meta tags
public/
  logo.png          # Instar logo
  favicon.*         # Favicon variants
  social-preview.png  # OG image (1280x640)
```
