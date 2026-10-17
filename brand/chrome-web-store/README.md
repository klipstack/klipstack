# Chrome Web Store

The pictures and texts of the extension's listing in the Chrome Web Store. Upload them in the
developer dashboard (Store listing tab); keep them true to what the extension does.

| File | Store field |
| --- | --- |
| `icon-128.png` | Store icon: the app icon drawn 96px inside a transparent 128px square, as the store asks |
| `screenshot-<n>-en.png`, `screenshot-<n>-es.png` | Screenshots, 1280×800: the English ones as global and English, the Spanish ones as Spanish |
| `promo-small-440x280.png` | Small promo tile |
| `promo-marquee-1400x560.png` | Marquee promo tile (shown only if the store features the extension) |

The screenshots are, in order: the extension saving a page (its notice on the page), the page in
the reader, and the library.

## Regenerate

- The icon and the tiles: `pnpm --filter @klipstack/web icons` (`apps/web/scripts/icons.ts`).
- The screenshots: `pnpm --filter @klipstack/web store-screenshots --url <app address>`
  (`apps/web/scripts/store-screenshots.ts`), against a running app with the demo account
  (`pnpm orb:app` in an orb). It builds the extension for that app, saves a sample article with
  it in Chromium, and frames each capture under its caption. The pictures use the machine's fonts:
  these were made in an orb with Inter and Bitstream Charter set as its default sans and serif
  (fontconfig), close to what a Mac shows.

Run them again when the extension, the reader or the library changes how it looks, then upload
the new files.

## Store listing

**Name** (comes from the manifest): Klipstack

**Summary** (from the manifest, up to 132 characters):
Save the page you are reading to Klipstack, exactly as you see it.

**Category:** Productivity → Tools (or "Workflow & Planning")

**Language:** English (add Spanish)

**Description (English):**

Klipstack is a calm place to save, read and annotate articles. This extension saves the page you
are reading to your Klipstack library with one click.

- Saves the page exactly as you see it, including articles behind a login or a paywall you pay
  for.
- One click on the toolbar button, or right-click a page or a link and choose "Save to
  Klipstack".
- A small notice confirms the save, with a link to open the article in the reader.
- Uses the Klipstack account you are signed in to in this browser: no API key and nothing to set
  up.

The extension acts only when you click it, and only on that tab. It removes scripts and hidden
form fields before sending a page, and sends it only to Klipstack. Klipstack has no
ads, trackers or analytics.

You need a Klipstack account: https://klipstack.com

**Description (Spanish):**

Klipstack es un lugar tranquilo para guardar, leer y anotar artículos. Esta extensión guarda en
tu biblioteca de Klipstack la página que estás leyendo, con un clic.

- Guarda la página tal como la ves, incluso artículos que requieren iniciar sesión o una
  suscripción que pagas.
- Un clic en el botón de la barra, o clic derecho en una página o un enlace y "Guardar en
  Klipstack".
- Un aviso confirma que se guardó, con un enlace para abrir el artículo en el lector.
- Usa la cuenta de Klipstack con la que hayas iniciado sesión en este navegador: sin clave de API
  ni nada que configurar.

La extensión actúa solo cuando haces clic en ella, y solo en esa pestaña. Quita los scripts y los
campos ocultos de formularios antes de enviar una página, y la envía solo a
Klipstack. Klipstack no tiene anuncios, rastreadores ni analítica.

Necesitas una cuenta de Klipstack: https://klipstack.com

**Official URL / Homepage:** https://klipstack.com
**Support URL:** https://klipstack.com/support

**Graphics:** the files above.

## Privacy practices tab

**Single purpose:**
Save the web page the user is reading, or a link they choose, to their Klipstack library.

**Permission justifications:**

- `activeTab`: When the user clicks the toolbar button or the context menu, the extension reads
  that one tab's page to save it. It has no access to tabs the user has not acted on.
- `scripting`: Runs a function in the clicked tab that copies the page as displayed (without
  scripts and hidden form fields) and shows a small "Saved" notice on the page.
- `contextMenus`: Adds "Save page to Klipstack" and "Save link to Klipstack" to the right-click
  menu.
- Host permission (`https://klipstack.com/*`): Sends the saved page to Klipstack with the
  user's existing Klipstack sign-in (cookies). It is the only site the extension can reach by
  itself.

**Remote code:** No, I am not using remote code. (All code is in the package.)

**Data usage, what the extension collects:**
- ☑ Website content (the page the user chooses to save: text, images' addresses, title)
- ☑ Web history (the address of the page the user saves)
- ☑ Authentication information? No: the extension reads no credentials; the browser attaches the
  user's Klipstack cookie to requests to Klipstack. Leave unticked.
- Everything else: unticked.

**Certifications (tick all three):**
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://klipstack.com/privacy

## Distribution

- Visibility: Public. (Or "Unlisted" for a first round, reachable only by link.)
- Regions: all.

## Notes for the reviewer (optional field)

Sign-up is by invite, so create an account for the reviewer and give its email and password
here. Steps: sign in to klipstack.com, open any article, click the Klipstack
button; a "Saved to Klipstack" notice appears, and the article is in the library.
