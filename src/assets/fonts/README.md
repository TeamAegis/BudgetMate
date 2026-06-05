# Bundled fonts

The design system (see `Designs/DESIGN.md`) uses **Manrope** (display/headlines) and **Inter**
(body/labels/numeric). Per the privacy rule (`.claude/rules/frontend.md`) fonts are **bundled**,
never loaded from Google Fonts or any CDN.

Drop the following self-hosted `.woff2` files here (filenames referenced by
`src/styles/_fonts.scss`):

- `manrope-600.woff2`
- `manrope-700.woff2`
- `inter-400.woff2`
- `inter-500.woff2`
- `inter-600.woff2`

Both families are OFL-licensed. Obtain the `.woff2` files offline (e.g. from the official
release archives) and copy them into this folder. Until they are present, the app falls back to
the platform `system-ui` stack — no remote request is ever made.
