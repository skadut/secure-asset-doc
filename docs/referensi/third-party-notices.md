# Pemberitahuan pihak ketiga

Dokumen ini mencantumkan referensi tampilan dan lisensi pihak ketiga yang dipakai proyek. Teks lisensi di bawah dipertahankan apa adanya dalam bahasa Inggris.

The following appearance references were adapted from the Uiverse.io Galaxy repository. Only CSS and markup structure were borrowed, adapted to project tokens, and scoped under `.ui-…` class names. No code is loaded from Uiverse at runtime.

Source repository: https://github.com/uiverse-io/galaxy (MIT, see licence below).

| # | Source file | Author (credit line in file) | Used in | Status |
|---|---|---|---|---|
| 1 | https://github.com/uiverse-io/galaxy/blob/main/Radio-buttons/Admin12121_cold-bobcat-20.html | Admin12121 | `src/features/evidence/components/coverage-segment.{tsx,css}` | adapted |
| 2 | https://github.com/uiverse-io/galaxy/blob/main/Checkboxes/G4b413l_smooth-duck-62.html | G4b413l | `src/components/data-table/faceted-filter.{tsx,css}` | adapted |
| 3 | https://github.com/uiverse-io/galaxy/blob/main/Inputs/Alanav29_tough-ape-65.html | Alanav29 | `src/components/data-table/search-field.css` (static label only; floating label rejected) | adapted |
| 4 | https://github.com/uiverse-io/galaxy/blob/main/loaders/AHMED-MIT_cold-ape-73.html | AHMED-MIT | `src/features/documents/components/file-preview.{tsx,css}` | adapted |

## Cracked earth background (not from the Galaxy repository)

- Source: a code snippet supplied by the user. Credit line: "From Uiverse.io by UserNameSekhar". Original catalogue URL not verified; none is given here.
- Used in: `public/patterns/cracked-earth-light.svg` and `public/patterns/cracked-earth-dark.svg`, applied as a static background on the page canvas via `--page-pattern` in `src/styles/theme.css`.
- Adapted: the feTurbulence/feConvolveMatrix filter chain is pre-rendered into a static SVG tile. Light and dark differ only in ground and crack colour.

---

## MIT licence (Uiverse.io Galaxy)

Source: https://github.com/uiverse-io/galaxy/blob/main/LICENSE

```
MIT License

Copyright (c) 2023 Uiverse.io

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
