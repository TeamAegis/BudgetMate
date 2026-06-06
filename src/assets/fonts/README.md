# Bundled fonts

The design system (see `docs/design/design-system.md` §3) uses **Poppins**. Per the privacy rule
(`.claude/rules/design.md` / `frontend.md`) fonts are **bundled**, never loaded from Google Fonts
or any CDN.

These self-hosted `.woff2` files are present here (filenames referenced by `src/styles/_fonts.scss`):

- `poppins-extralight.woff2` (200)
- `poppins-light.woff2` (300)
- `poppins-regular.woff2` (400)
- `poppins-medium.woff2` (500)
- `poppins-bold.woff2` (700)

## Provenance & licence

Poppins © 2020 The Poppins Project Authors (https://github.com/itfoundry/Poppins), licensed
under the **SIL Open Font License 1.1** — full text in [`OFL.txt`](./OFL.txt).

The bundled files are the **latin subset** weights, taken from the
[`@fontsource/poppins`](https://www.npmjs.com/package/@fontsource/poppins) release
(`files/poppins-latin-<weight>-normal.woff2`) and renamed to the names above. They are committed
to the repo so the build is fully offline — no Google Fonts / CDN fetch ever occurs (NFR-P4).

To refresh them: `npm install --no-save @fontsource/poppins`, copy
`node_modules/@fontsource/poppins/files/poppins-latin-{200,300,400,500,700}-normal.woff2` here
under the names above, then remove the package. The latin subset keeps each weight ~8 KB (APK
size budget, NFR-Perf1).
