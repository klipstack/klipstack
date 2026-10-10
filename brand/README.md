# Brand

- `klipstack-mark.svg`: the canonical mark. Every other asset derives from it. Strokes in
  `currentColor` on a transparent background, like an icon-library glyph: three fanned sheets, one
  line that draws the front sheet and runs on into the clip, and a filled tip where the sheets meet.
- `klipstack-mark-small.svg`: the same idea redrawn on a 24-unit grid for 32px and below (favicons,
  toolbar icons, the sidebar, the edition footer, the email header, the reader's saved-link
  marker). One back sheet instead of two, a clip with one turn, and a heavier stroke.
- `klipstack-logo.svg`: the logo, the mark followed by the name, in `currentColor`. Generated: the
  name is Newsreader turned into outlines, so it needs no font where it is used.
- `klipstack-logo-small.svg`: the logo with the small mark, for 32px and below. Built on the
  sidebar's grid: at 24px tall, the name is 18px and starts 8px after the mark, on the nav labels'
  column.
- `fonts/`: Newsreader (SIL Open Font License, `fonts/Newsreader-OFL.txt`), fixed at single weights
  and optical sizes and cut down to Latin characters: 500 at 40 for the logo's name, 600 at 18 for
  the small logo's, 400 at 40 for taglines.
- `klipstack-logo-light.svg`, `klipstack-logo-dark.svg`: the logo in fixed colors, for places where
  `currentColor` does not reach, such as images in the README: navy on light backgrounds, white on dark.

## Rules

- The clip and the front sheet are one line. Keep them one color. Do not fill the gap between the
  fan's tip and the clip: it keeps that line open.
- App icons: white mark on the navy tile, a gradient from `#3a64a0` (top left) to `#132548`.
- Use the full mark at 48px and up, the small mark at 32px and below.
- The logo's name is Newsreader Medium at 0.62 of the mark's height, 0.28 of it away. Beside the
  heavier small mark, the name is SemiBold, cut for small text. The app shows the logos as inline
  SVG (`BrandLogo` on the landing page, `BrandLogoSmall` in the sidebar); the rest of its text
  keeps the system fonts.
- Emails show the small-mark app icon and the name as text, so the name survives blocked images.

## Regenerate

`pnpm --filter @klipstack/web icons` writes the PNG icons (web app, PWA, extension, email, the mobile
app's iOS and Android icons), the mobile app's logo images (`logo.png`, and `splash-logo*.png` for
its launch screen, in `apps/mobile/assets/`), the
share cards (`share-<language>.png`, with each language's landing headline, `home.headline` without its markup), `apps/web/public/icons/favicon.svg`
and `mark.svg`, both logos, and `apps/web/app/components/brand-mark.tsx`. Run it after
changing either mark or the headline.

Then bump the `?v=` on the icon URLs in `apps/web/app/root.tsx`, `apps/web/app/app.css`,
`apps/web/public/manifest.webmanifest`, `apps/web/app/lib/email.server.ts` and
`apps/web/app/lib/share-card.server.ts`. The service worker serves `/icons/` from its cache once it
has a copy, and link previews and mail clients cache images too: an unchanged URL keeps showing the
old picture.

## Social

- `social/x-cover-*.png`: header images for the X profile, 1500×500. `b-paper` is the one in use;
  `a-navy` and `c-stripes` are the alternatives. Text starts about 430px in and stays 60px clear of
  the top and bottom: the avatar covers the bottom-left corner and phones crop those edges.
