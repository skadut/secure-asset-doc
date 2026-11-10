# Task: implement the redesigned dashboard chart grid

You are working in the fictional GRC demo app repo (`frontend/`, React + Tailwind + shadcn + Recharts). Implement the chart and stat-tile redesign below on the Overview route (`http://127.0.0.1:8088/`). All data is fictional.

Design reference: canvas "GRC Overview — Chart Grid" (https://claude.ai/artifact/DX1jGLhk1ibfpMSPuKXPQD). If you cannot open it, this file is the full spec. If `chart-grid.reference.dc.html` is attached, it is the design prototype source: read its `renderVals()` for exact values, labels and colors. Do not copy its markup or runtime into the app.

## 0. Rules before you start

- Scope is chart visuals and stat tiles only. Do NOT touch: page shell, sidebar, header, navigation, upload section, the 4 attention tables, login, render order in `index.tsx`, the subtitle text "Sample data.", or the `TODAY` constant.
- No new dependencies. Use Recharts, shadcn `ChartContainer`/`ChartTooltip` if already present, Tailwind, and tokens in `frontend/src/styles/theme.css`.
- Do not invent data. Compute every value from the GRC data (`useGrc()` / `lib/grc.ts`). The design used fixture values; some splits in the design were illustrative. Your code must compute them.
- Do not render the dashed "Illustrative split / Placeholder" chips from the design. They are design annotations.
- Do not show `ipAddress`, `firmware` or `model`. Do not show credentials, keys or real unit names.
- Work on a branch. Do not commit to main, push or open a PR unless the user asks.
- First read: `features/dashboard/index.tsx`, `components/document-charts.tsx`, `components/statistics.tsx`, `components/tlp-badge.tsx`, `components/status-badge.tsx`, `lib/grc.ts`, `data/grc.ts`, `styles/theme.css`, `test-utils/grc-fixture.ts`. Report any file that differs from what this spec assumes before changing it.

## 1. Components to build or change

Put shared pieces in `frontend/src/features/dashboard/components/viz/` (or the closest existing folder).

1. `StatTile`: label (12px muted), value (Saira Semi Condensed 600 28px, line-height 1, tabular nums), optional `of N` (14px muted), optional 4px meter (track `--bg-sunken`, fill `--chart-1`, width = value/of), optional state line (icon + text, 12px 600, color by state), optional note (12px muted). Card: `bg-card`, 1px `--line-subtle` border, radius `var(--radius)` (10px), padding 14px 16px, min-height 108px. Loading: skeleton 64x28 for value plus skeleton meter.
2. `DistributionChart`: card wrapper used by all 10 charts. Props: `title`, `caption`, `legend?`, `state: 'ready' | 'loading' | 'error'`, `isEmpty`, `emptyMessage`, `table: { columns, rows }`, `onRetry?`, `children`. Header: title (IBM Plex Sans 600 13px) + caption (12px muted) on the left, a `Table` toggle button on the right (`aria-pressed`, label switches to "Hide table"). Body: legend (if 2+ series), then chart, loading skeleton, or error. Table: visible inside an `overflow-x-auto` bordered box when toggled, otherwise rendered `sr-only`. Card: same as StatTile, padding 16px 16px 12px, gap 12px, `min-width: 0`.
3. `TlpBadge` (replace hardcoded hex in `tlp-badge.tsx`): text `TLP:CLEAR` etc., IBM Plex Mono 600 11px, letter-spacing .04em, padding 4px 6px, radius 4px. Background `var(--viz-tlp-<k>)`. Ink: light theme CLEAR/GREEN/RED/RED+STRICT white, AMBER/AMBER+STRICT `#171717`; dark theme all `#0F1210`. STRICT: `ring-2 ring-inset`, black ring for AMBER+STRICT, white ring for RED+STRICT. Keep the existing component API so other pages keep working.
4. `StatusBadge` / state legend item (fix `status-badge.tsx`): replace `red-100/amber-100/green-100` with `--pass`, `--warn`, `--fail`; always icon + text. Icons (lucide-react if already installed, else inline SVG, 13-14px, stroke 2.2): pass = circle-check, warn = clock, fail = triangle-alert, draft = pencil (color `--chart-4`).
5. Remove the duplicate "Documents current" tile from the asset stat grid (`index.tsx:115`). Keep one tile "Current documents" in the documents section (`document-charts.tsx:78`). This is the only `index.tsx` change allowed besides swapping in the new tile/chart components in place.

## 2. Tokens

Add to `theme.css` only if missing (do not change existing values):

- `--tip-bg` / `--tip-fg`: light `#171B18` / `#F5F4EF`, dark `#E8EAE4` / `#0F1210`.
- `--skeleton`: light `#E2E1D9`, dark `#2E3530`.
- `--focus`: light `#171B18`, dark `#E8EAE4`. The brief says 2px `#E8EAE4` for both themes, but it is invisible on the light background `#F5F4EF`; use `--focus` and flag this choice in your summary.

Color rules:

- TLP fills only from `--viz-tlp-*`. No hex in components.
- Red/amber/green (`--fail`/`--warn`/`--pass`) only for state, always with icon + text.
- Single neutral series: `--chart-1`. Non-urgent review buckets: `--chart-4`.
- Criticality (high/medium/low) is ordinal, not state: one hue in 3 steps: high `var(--chart-3)`, medium `color-mix(in srgb, var(--chart-3) 60%, var(--card))`, low `color-mix(in srgb, var(--chart-3) 30%, var(--card))`.
- AMBER bars in light theme get a 1px inset `rgba(0,0,0,.32)` edge so they reach 3:1 against the card.
- No pie charts, no dual axis, no rainbow.

## 3. Layout of the chart grid (inside the existing sections)

Section header (existing sections, restyle only): title Saira 600 24px/1.15, as-of label IBM Plex Mono 600 12px `AS OF 2026-10-21` (from `TODAY`, not hardcoded), subtitle 14px muted.

- Tile grid: 4 columns at >= 700px, 2 columns below. Gap 12px.
- Chart grid: 3 columns at >= 1200px, 2 at >= 700px, 1 below. Gap 16px, `grid-auto-flow: row dense`. Span is clamped to the column count.
- Page side gutter 16px. No horizontal page scroll at 1440, 768 or 375. Gap between the two sections 40px.

Documents section (tiles, then charts in this order; at 2 columns put Review schedule before Document status by TLP):

| Chart | Span | Form |
|---|---|---|
| Documents by TLP | 1 | horizontal bars |
| Document status by TLP | 2 | horizontal stacked bars |
| Review schedule | 1 | horizontal bars |
| Documents by type | 2 | horizontal bars |
| Version activity by month | 3 | vertical columns |

Assets section ("Assets and CSF 2.0 coverage"):

| Chart | Span | Form |
|---|---|---|
| Assets by sector and criticality | 2 | horizontal stacked bars |
| Assets by criticality | 1 | horizontal bars |
| Assets by status | 1 | horizontal bars |
| Asset review status | 1 | horizontal bars |
| CSF 2.0 coverage by function | 1 | horizontal stacked bars |

## 4. Per-chart spec

Horizontal bar row anatomy (use Recharts `BarChart layout="vertical"` or a plain CSS row list; pick one and use it for all bar charts): row height 30px, bar 16px, radius 4px (segments 3px, 2px gap between segments), label column left (12px `--text-2`), value column right (12px 600 tabular nums, 28px wide), bars scaled to the chart's max. Every category renders even when 0 (bar width 0, value `0`).

| Chart | Data | Rows / series | Colors | Tooltip | Table columns |
|---|---|---|---|---|---|
| Documents by TLP | count by `tlp` | CLEAR, GREEN, AMBER, AMBER+STRICT, RED, RED+STRICT (row label = TlpBadge) | `--viz-tlp-*`, STRICT ring | `TLP:X` / `n documents` | TLP, Documents |
| Document status by TLP | count by `tlp` x `status` | same 6 rows; series Approved, In review, Draft, Expired | `--pass`, `--warn`, `--chart-4`, `--fail`; legend with icons | segment: `TLP:X · Status` / `n documents` | TLP, Approved, In review, Draft, Expired, Total |
| Review schedule | bucket of `nextReview - TODAY` (rules in brief 4) | Overdue, 0–30 days, 31–90 days, 91–180 days, Over 180 days | Overdue `--fail` + fail icon, 0–30 `--warn` + warn icon, rest `--chart-4` | `Next review: bucket` / `n documents` | Next review, Documents |
| Documents by type | count by `type` | all 10 types in the brief's order | `--chart-1` | type / count | Type, Documents |
| Version activity by month | count of `versions[].date` by month | every month from first to last version month (fixture: 2024-02..2026-10, 33 columns), zero months included | `--chart-1`; y gridlines `--viz-grid`, baseline `--line-strong` | `YYYY-MM` / `n versions` | Month, Versions |
| Assets by sector and criticality | count by `sector` x `criticality` | sectors present in data; series High, Medium, Low | criticality steps; legend | `Sector · Level` / `n assets` | Sector, High, Medium, Low, Total |
| Assets by criticality | count by `criticality` | High, Medium, Low | criticality steps | `Criticality x` / `n assets` | Criticality, Assets |
| Assets by status | count by asset `status` | Active, Maintenance, Retired | `--chart-1` | status / count | Status, Assets |
| Asset review status | `lastReviewed` within 365 days of `TODAY` | Reviewed within 365 days, Overdue | `--pass` + icon, `--fail` + icon | category / count | Review status, Assets |
| CSF 2.0 coverage by function | `CsfSubcategory.fn` x has current evidence (reuse the existing `coverage()` rule; do not invent one) | GV Govern, ID Identify, PR Protect, DE Detect, RS Respond, RC Recover; series With current evidence, No current evidence | `--pass`, `--fail`; legend with icons | `FN · state` / `n subcategories` | Function, With evidence, No evidence, Total |

Captions: Documents by TLP `17 documents · TLP 2.0 marking`; Document status `Status within each TLP marking · 17 documents`; Review schedule `Days from 2026-10-21 to next review`; Documents by type `10 document types`; Versions `43 versions · 2024-02 to 2026-10`; Sector `20 assets across 3 sectors`; Criticality / Status `20 assets`; Asset review `Last review vs. 365 days before 2026-10-21`; CSF `21 subcategories · 6 functions`. All numbers and dates computed, never hardcoded.

Version chart: plot height 160px, y ticks at 0, 2, 4, 6 (or nice ticks up to max), x labels only at the first month, each January, and the last month; columns 2px apart, top radius 3px; hovering a column highlights its full-height slot with `--surface-active`.

## 5. Stat tiles

Documents: Total documents; Total versions; Current documents `10 of 17` with meter and note "Approved, next review on or after {TODAY}"; Reviews overdue: if > 0 value in `--fail` with state "Past next review date" (fail icon), if 0 state "None overdue" (pass icon).

Assets: Total assets; Reviewed within 365 days `n of total` with meter, state "All reviewed" (pass) when equal and total > 0, "{k} overdue" (fail) when lower; With monitoring evidence `n of total` with meter, no state.

## 6. States (every chart and tile, both themes)

- Loading: tiles show skeleton value + meter. Bar charts show 5-10 skeleton rows (label 48-84px wide, bar of varying width). Column chart shows 33 skeleton columns. Skeleton color `--skeleton`, pulse opacity 1 to .55, 1.4s.
- Empty (RBAC returns zero rows): every category still renders with `0`, and above the chart a note in a `--bg-sunken` box, 12px `--text-2`: "No documents are visible to your role. Every TLP marking still shows 0." (adapt noun and category per chart; assets: "No assets are visible to your role..."; CSF: "No CSF 2.0 subcategories are visible...").
- Error (per chart): body replaced by a `--bg-sunken` box with fail icon, "This chart couldn't load." (13px 600), "The rest of the overview is unaffected." (12px muted), and a `Retry` button. Other charts and tiles keep rendering. One chart failing must never blank the grid.

## 7. Interaction and accessibility

- Every bar row is a `<button>` (or an element in the tab order with `role="button"` only if Recharts forces it) with `aria-label` like `TLP:AMBER: 5 documents` or, for stacked rows, `TLP:AMBER: 5 documents. Approved 3, In review 1, Draft 0, Expired 1`. Focus shows the same tooltip as hover.
- Chart segment click: drill-down filter route is unverified. Do not invent a route; leave a `TODO(drill-down)` and no navigation. Table toggle and rows must be reachable by Tab.
- Tooltip: `--tip-bg` / `--tip-fg`, 12px, padding 6px 8px, radius 6px, line 1 600 weight, `pointer-events: none`, never clipped by the card.
- Focus: `outline: 2px solid var(--focus); outline-offset: 2px`.
- Text contrast 4.5:1 in both themes; bar fills 3:1 against the card.
- Motion: cards fade and rise 10px, 280ms, `cubic-bezier(.2,.7,.2,1)`. Hover color 150ms. Buttons press `scale(.98)`. Turn all motion off under `prefers-reduced-motion: reduce`.

## 8. Tests and checks

1. Unit tests against `test-utils/grc-fixture.ts` for each derived dataset: TLP counts `1/4/5/4/3/0`; status `10/3/2/2`; review buckets `2/6/5/3/1`; version months 33 with total 43 and peak 6 in 2026-10; assets criticality `12/7/1`, status `17/2/1`, sector `8/7/5`; reviewed `20 of 20`; monitoring `1 of 20`; 21 CSF subcategories. Also print (not assert) the computed document-type counts, the tlp x status and sector x criticality cross-tabs, and the CSF coverage per function, and report them; the brief marks them unverified.
2. Test empty data: every chart renders its categories with `0` and the empty note; no crash.
3. Test one chart throwing: only that card shows the error state.
4. Run the existing test suite, typecheck and lint. All must pass.
5. Run the app, check 1440, 768 and 375 widths in light and dark: no horizontal page scroll, no clipped tooltips, Tab order reaches every row and Table button.

## 9. Report back

Summarize: files changed, computed values for the unverified items, any spec item you could not follow and why (especially the focus color and drill-down route), and screenshots or notes for the 6 width/theme combinations.
