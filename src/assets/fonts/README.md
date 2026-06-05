# Bundled fonts

The design system (see `docs/design/design-system.md` §3) uses **Poppins**. Per the privacy rule
(`.claude/rules/design.md` / `frontend.md`) fonts are **bundled**, never loaded from Google Fonts
or any CDN.

Drop these self-hosted `.woff2` files here (filenames referenced by `src/styles/_fonts.scss`):

- `poppins-extralight.woff2` (200)
- `poppins-light.woff2` (300)
- `poppins-regular.woff2` (400)
- `poppins-medium.woff2` (500)
- `poppins-bold.woff2` (700)

Poppins is OFL-licensed. Obtain the `.woff2` files offline (e.g. from the official release
archive) and copy them into this folder. Until they are present, the app falls back to the
platform `system-ui` stack — no remote request is ever made.
