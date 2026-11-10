# Dashboard UI brief

Scope: overview dashboard of the fictional GRC demo app. All data is fictional.
Audience: commander, security officer, document owner.

## 1. Purpose

The dashboard serves one decision: what needs attention today across documents, assets, and CSF 2.0 evidence.

- Attention first. Distribution second.
- Every screen shows the visible marker `FICTIONAL DATA / DEMO`.
- `HANDOFF.md` forbids a "SAMPLE DATA" banner. The required text is `FICTIONAL DATA / DEMO`. It replaces the subtitle cue "Sample data." Placement: out of scope, see Decisions, Demo marker.
- Route: `http://127.0.0.1:8088/`.

## Scope

Claude Design designs the chart and stat-tile visuals only.

- In scope: chart types, data per chart, chart anatomy, colors, tooltips, legends, empty/loading/error states of charts, responsive behaviour of the chart grid.
- Out of scope (stays as in current app): page shell, sidebar, header, navigation, upload control, attention tables layout, login.

## 2. Current state (top to bottom)

Render order from `frontend/src/features/dashboard/index.tsx`. This is the layout before redesign.

1. Header: `Search`, `ThemeSwitch`, `ConfigDrawer`, `ProfileDropdown`.
2. Title `Overview`. Subtitle: `What needs attention across assets, documents and CSF 2.0 evidence. Sample data.`
3. Summary line: `{docsToReview} documents need review · {csfGaps} CSF 2.0 subcategories lack current evidence · {staleHighAssets} high-criticality assets not reviewed in 365 days (as of 2026-10-21)`.
4. Section "Managed documents". Subtitle: "TLP marking, status, review timing and version activity across the document register." Source: `components/document-charts.tsx`.
   - Stat tiles (4): Total documents; Total versions; Current; Reviews overdue.
   - Charts (5):
     - "Documents by TLP": horizontal bar.
     - "Document status by TLP": horizontal stacked bar, legend, 2 columns wide, height 260.
     - "Review schedule": horizontal bar.
     - "Version activity by month": vertical columns, 2 columns wide.
     - "Documents by type": horizontal bar, height 300.
   - Each chart has an sr-only data table (`components/statistics.tsx`).
5. Stat grid (4 tiles, `index.tsx`):
   - Total assets.
   - Assets reviewed in 365 days (`n` of total).
   - Assets with monitoring evidence (`n` of total).
   - Documents current (`n` of documents).
6. Section "Encrypted uploads" (`components/uploads.tsx`). Contents: Upload button, hint paragraph, drop zone text "Drop a file here or use Upload", status line. Accepts `pdf`, `png`, `jpeg`, `txt`.
7. Four tables in a 2-column grid. Each has a "View all" link.
   - "Documents overdue or due within 30 days". Columns: ID, Title, TLP, Status, Next review. Shows 6 rows. Links: `/documents`, `/documents/$documentId`.
   - "CSF 2.0 subcategories without current evidence". Columns: ID, Outcome, Coverage. Links: `/evidence`, `/evidence#subcategory-{id}`.
   - "High-criticality assets with review older than 365 days". Columns: ID, Name, Site, Last reviewed. Empty text: "Nothing overdue." Links: `/assets`, `/assets/$assetId`.
   - "Recent activity". Columns: Time (UTC), Actor, Summary, Object. Shows 8 rows. Links: `/audit-log`. Each Object links to an asset, a document, or `/evidence`.
8. Section, aria-label "Asset and document statistics" (`components/statistics.tsx`). 5 charts:
   - "Assets by sector and criticality": stacked, 2 columns wide.
   - "Assets by criticality".
   - "Assets by status".
   - "CSF 2.0 coverage by function": stacked.
   - "Asset review status": 2 bars, "Reviewed within 365 days" and "Overdue".

### Fixture counts

Source: `frontend/src/test-utils/grc-fixture.ts`. Values checked by review. Live numbers depend on login (see caveats).

| Metric | Value |
|---|---|
| Documents | `17` |
| Versions | `43` |
| Current (approved and `nextReview >= TODAY`) | `10` |
| Reviews overdue | `2` |
| Documents to review (`<= 30` days, incl. overdue) | `8` (table shows 6) |
| TLP CLEAR / GREEN / AMBER / AMBER+STRICT / RED / RED+STRICT | `1` / `4` / `5` / `4` / `3` / `0` |
| Status | approved `10`, in review `3`, draft `2`, expired `2` |
| Review buckets | Overdue `2`; 0 to 30 days `6`; 31 to 90 days `5`; 91 to 180 days `3`; over 180 days `1` |
| Version months | `2024-02` to `2026-10`, 33 columns, peak `6` in `2026-10` |
| Document types | unverified (not computed) |
| Assets | `20` |
| Asset criticality | high `12`, medium `7`, low `1` |
| Asset status | active `17`, maintenance `2`, retired `1` |
| Asset sector | Water `8`, Energy `7`, Telecom `5` |
| Assets reviewed within 365 days | `20` of `20` |
| Assets with monitoring evidence | `1` of `20` |
| Stale high-criticality assets | `0` |
| CSF 2.0 subcategories | `21` |
| Audit events | `41` |
| CSF gap count | unverified (`coverage()` not computed) |

### Caveats

- Empty data. `frontend/src/data/grc.ts` ships empty arrays (lines 118 to 124). The live app hydrates from `/api/grc` (`main.tsx:124`), filtered by RBAC (`README.md:265`). Fixture numbers above are fixture-only. Live numbers per login: unverified.
- Fixed date. `TODAY` is the string `'2026-10-21'` (`frontend/src/data/grc.ts:4`). The comment says to use `new Date()` for real data. Today is `2026-11-09`. All "overdue", "365 days", and bucket counts are relative to `2026-10-21` until this changes. See Decisions, TODAY.
- Duplicate tile. "Current" (`document-charts.tsx:78`) and "Documents current" (`index.tsx:115`) show the same value and definition. Formats differ: `10` and `10 of 17`.

## 3. Current problems

Only problems that point to code.

| ID | Problem | Location | Effect | In scope |
|---|---|---|---|---|
| P1 | Attention is not first. | Document charts `index.tsx:103-109` and uploads `index.tsx:118` render before the attention tables `index.tsx:120-305`. Asset charts render last, `index.tsx:307`. | Decision content starts after analytics. Position below the fold: unverified (not rendered). | Out. Layout order. |
| P2 | Equal weight for all blocks. | 8 stat tiles, 10 charts, 4 tables, and 1 upload section use the same section block style. | No visual priority. The reader cannot see the decision first. | In. Chart and tile visual weight only. |
| P3 | Duplicate figure. | `document-charts.tsx:78` and `index.tsx:115`. | Same value shown twice in two formats. | In. |
| P4 | Action control inside a read-only overview. | Uploads, `index.tsx:118`. | Judgment: the upload control sits between analytics and tables and competes with attention content. | Out. Upload control. |
| P5 | Weak demo cue. | `index.tsx:94`. | Only the subtitle ending "Sample data." exists. No `FICTIONAL DATA / DEMO` marker. | Out. Demo marker. |
| P6 | Hardcoded TLP colors. | `frontend/src/components/tlp-badge.tsx`: `#1E7B45`, `#F0B429`, `#B3261E`, black or white text. | `--viz-tlp-*` tokens are not used. Dark `--viz-tlp-*` values are unused. Colors do not change with theme. | In. TLP colors. |
| P7 | Palette classes instead of state tokens. Text only, no icon. | `frontend/src/components/status-badge.tsx`: `red-100`, `amber-100`, `green-100`. | Not `--pass`, `--warn`, `--fail`. State has no icon, so color is the only non-text cue. | In. State cues in chart legend. |
| P8 | Partial list. | Documents-due table, limit 6. | 2 of 8 due documents not shown. "+2 more" link: unverified. | Out. Table. |
| P9 | Stale as-of date. | `frontend/src/data/grc.ts:4`. | Overdue and 365-day counts use `2026-10-21`. Today is `2026-11-09`. | Caveat only. Not a design item. |

P10 is not a defect. All UI text in the dashboard files is English. No Indonesian strings found. No language mix to fix.

## 4. Data available

### Entities

Document (`frontend/src/data/grc.ts:49-72`):

| Field | Meaning |
|---|---|
| `id` | Document identifier. |
| `title` | Document title. |
| `type` | One of 10 values: Policy, Procedure, Network diagram, Risk assessment, Incident response plan, Configuration baseline, Audit report, Personnel roster, Installation register, Equipment register. |
| `tlp` | TLP marking. |
| `status` | `draft` \| `in review` \| `approved` \| `expired`. |
| `owner` | Owner. |
| `approver` | Approver. |
| `nextReview` | Next review date. Input to review buckets. |
| `versions[]` | Version list (see DocVersion). |
| `locked` | Optional. Meaning: unverified. |
| `granted` | Optional. Meaning: unverified. |
| `tokenOnly` | Optional. Meaning: unverified. |

DocVersion (`grc.ts:40-47`): `version`, `date`, `author`, `summary`, `approvedBy` (optional), `file` (optional).

DocFile (`grc.ts:38`): `name`, `mime` (`pdf` \| `xlsx`), `url`.

Asset (`grc.ts:11-36`): `id`, `name`, `type`, `site`, `sector`, `purdueLevel`, `zone`, `vendor`, `model`, `firmware`, `ipAddress`, `criticality`, `owner`, `lastReviewed`, `status` (`active` \| `maintenance` \| `retired`).

AuditEvent (`grc.ts:97-106`): `id`, `at`, `actor`, `action`, `objectType`, `objectId`, `summary`, `changes[]` (optional, each `{field, from, to}`).
- `action`: `create`, `update`, `approve`, `link`, `unlink`, `export`, `delete`, `access.denied`, `purge`, `derive`.
- `objectType`: `asset`, `document`, `evidence`, `upload`, `user`, `audit`.

CsfSubcategory (`grc.ts:83-89`): `id`, `fn` (`GV`, `ID`, `PR`, `DE`, `RS`, `RC`), `category`, `categoryName`, `outcome`.

EvidenceLink (`grc.ts:90-95`): `subcategoryId`, `documentId` (optional), `assetId` (optional), `note`.

### Derived values

- Current: `status` is `approved` and `nextReview >= TODAY` (`lib/grc.ts:54-55`).
- Review bucket: `nextReview` minus `TODAY`.
  - Overdue: `< 0`.
  - 0 to 30 days: `<= 30`.
  - 31 to 90 days: `<= 90`.
  - 91 to 180 days: `<= 180`.
  - Over 180 days: `> 180`.

### Design rules for data

- Do not show `ipAddress`, `firmware`, or `model` on the dashboard. They do not serve the decision. Design recommendation, not a verified requirement.
- Do not invent trends, prior-period comparisons, targets, compliance percentages, or SLA numbers. The data cannot produce them. The only history is the version list and the audit log.

## 5. Requirements

### 5.1 Information hierarchy

1. Attention strip: three counts, each linking to its list.
2. Three attention lists: documents due, CSF gaps, stale high-criticality assets.
3. Recent activity.
4. Distribution charts: documents, then assets, then CSF coverage.

Chart scope only: layout order is out of scope.

Uploads stay on the overview as in the current app. Out of scope. See Decisions, Uploads on overview.

### 5.2 Widgets and chart form

- No dual axis.
- No pie chart with more than 5 slices. Prefer horizontal bars.
- No rainbow palette. Use `--chart-1` to `--chart-5` in order, or one hue in sequential steps.
- TLP colors come from `--viz-tlp-*` tokens only. Remove hardcoded hex.
- Red, amber, and green are reserved for state. Each carries a text label and an icon.
- Legend for 2 or more series.
- Every chart has a hover tooltip and an sr-only or visible table alternative.
- Zero-value categories still render, labeled `0` (for example, RED+STRICT).

### 5.3 Drill-down targets

| Widget | Target |
|---|---|
| Attention strip: documents count | `/documents` |
| Attention strip: CSF gaps count | `/evidence` |
| Attention strip: stale assets count | `/assets` |
| List row | Its detail route (`/documents/$documentId`, `/evidence#subcategory-{id}`, `/assets/$assetId`) |
| Chart segment | Filtered list. Filter route: unverified. |

### 5.4 Responsive

- Widths: 1440 desktop, 768 tablet, 375 phone.
- 16px side gutter.
- No horizontal page scroll. Wide tables scroll inside their own box.

### 5.5 Themes

- Light and dark mode. Both must pass the same states.

### 5.6 Keyboard and focus

- All links, buttons, and chart drill-downs reachable by Tab.
- Visible focus.
- Focus outline: 2px `#E8EAE4` (from the login spec, dark). Apply to both themes as an unverified default.

### 5.7 Motion

- Reduced motion: turn all motion off under `prefers-reduced-motion`.
- Screen change: fade and rise 10px, 280ms, `cubic-bezier(.2,.7,.2,1)`.
- Table rows: fade and rise 6px, 260ms, stagger 30ms, up to 210ms. Meaning of "up to": unverified.
- Hover and press color: 150ms. Press: `scale(.98)`.

## 6. Constraints

- Stack: React, Tailwind, shadcn, Recharts. No new dependencies.
- Tokens: `frontend/src/styles/theme.css`.
- Fonts:
  - `--font-sans`: IBM Plex Sans.
  - `--font-heading`: Saira Semi Condensed.
  - `--font-mono`: IBM Plex Mono.

### Type scale (HANDOFF)

| Role | Font | Weight | Size | Line height |
|---|---|---|---|---|
| Page title | Saira | 600 | 34px | 1.1 |
| Panel title | Saira | 600 | 24px | 1.15 |
| Tile number | Saira | 600 | 28px | 1 |
| Body | Plex Sans | 400 | 14px | 1.45 |
| Section heading | Plex Sans | 600 | 13px | unverified |
| Caption | Plex Sans | 400 | 12px | unverified |
| Banner | Plex Mono | 600 | 12px, letter-spacing 0.08em | 28px |

### Colors (`theme.css`)

Verified against `frontend/src/styles/theme.css` (lines 3 to 52 light, 67 to 117 dark). No value mismatches.

| Token | Light | Dark |
|---|---|---|
| background | `#F5F4EF` | `#0F1210` |
| foreground | `#171B18` | `#E8EAE4` |
| card | `#FBFBF8` | `#171B18` |
| muted-foreground | `#4F574F` | `#A3ABA2` |
| destructive | `#9B1C1C` | `#FF9D94` |
| border | `#7D867E` | `#2E3530` |
| chart-1 | `#2F6B4A` | `#A8D8BC` |
| chart-2 | `#8A6200` | `#E8C877` |
| chart-3 | `#5B4A8A` | `#C9BBF2` |
| chart-4 | `#3D453F` | `#C4CAC1` |
| chart-5 | `#4F574F` | `#A3ABA2` |

### TLP tokens

Verified against `theme.css` lines 48 to 53 (light), 112 to 117 (dark). Values match. Token names corrected to full `theme.css` names. Strict rows added.

| Token | Light | Dark |
|---|---|---|
| `--viz-tlp-clear` | `#737373` | `#a3a3a3` |
| `--viz-tlp-green` | `#1E7B45` | `#3FA66A` |
| `--viz-tlp-amber` | `#F0B429` | `#F0B429` |
| `--viz-tlp-amber-strict` | `#F0B429` | `#F0B429` |
| `--viz-tlp-red` | `#B3261E` | `#E5544B` |
| `--viz-tlp-red-strict` | `#B3261E` | `#E5544B` |

- AMBER+STRICT and RED+STRICT: same fill plus `ring-2 ring-inset`. Black ring for AMBER+STRICT, white ring for RED+STRICT.
- STRICT is also told apart by label text.

### Other viz and state tokens

From `theme.css` lines 39 to 47 and 28 to 37 (light), 103 to 111 and 92 to 101 (dark).

| Token | Light | Dark |
|---|---|---|
| `--viz-good` | `#00a63e` | `#05df72` |
| `--viz-warning` | `#fe9a00` | `#ffb900` |
| `--viz-danger` | `#e7000b` | `#ff6467` |
| `--viz-neutral` | `#737373` | `#a3a3a3` |
| `--viz-high` | `#e7000b` | `#ff6467` |
| `--viz-medium` | `#fe9a00` | `#ffb900` |
| `--viz-low` | `#00a63e` | `#05df72` |
| `--viz-ink` | `#171717` | `#f5f5f5` |
| `--viz-grid` | `#e5e5e5` | `#404040` |
| `--pass` | `#2F6B4A` | `#A8D8BC` |
| `--warn` | `#8A6200` | `#E8C877` |
| `--fail` | `#9B1C1C` | `#FF9D94` |
| `--erase` | `#5B4A8A` | `#C9BBF2` |
| `--text-2` | `#3D453F` | `#C4CAC1` |
| `--bg-sunken` | `#ECEBE4` | `#0B0D0B` |
| `--surface-active` | `#E8E8E1` | `#262C27` |
| `--line-subtle` | `#CFD2C9` | `#252B26` |
| `--line-strong` | `#5E6760` | `#434B44` |
| `--line-selected` | `#5E6760` | `#8A938B` |

### Radius

- Decision: use `theme.css` values.
- `--radius` is `0.625rem` (10px). `theme.css` line 2.
- HANDOFF 4px (controls and panels) and 2px (level chips) is not used.
- See Decisions, Radius.

### Credentials and names

- Do not show or write credentials, keys, or real unit names.

## 7. Deliverables expected from Claude Design

Chart visuals only. See Scope.

### Artboards

- One artboard: chart grid (stat tiles and distribution charts only).
- Widths: 1440, 768, 375.
- Themes: light and dark. Total 6 artboards.

### Per-chart spec

| Chart | Type | Data field | Encoding | Tooltip | Legend | Empty | Loading | Error |
|---|---|---|---|---|---|---|---|---|
| Documents by TLP | Horizontal bar | `tlp` (count) | Bar length; `--viz-tlp-*` colors | TLP, count | None (1 series) | Rows show `0` | Skeleton bars | Message in chart box |
| Document status by TLP | Horizontal stacked bar | `tlp`, `status` | Stacked segments; status text plus icon | TLP, status, count | Required: status | Rows show `0` | Skeleton bars | Message in chart box |
| Review schedule | Horizontal bar | `nextReview` (review bucket) | Bar length per bucket | Bucket, count | None (1 series) | Buckets show `0` | Skeleton bars | Message in chart box |
| Version activity by month | Vertical columns | `versions[].date` (by month) | Column height per month | Month, count | None (1 series) | Months show `0` | Skeleton columns | Message in chart box |
| Documents by type | Horizontal bar | `type` (fixture counts unverified) | Bar length per type | Type, count | None (1 series) | Types show `0` | Skeleton bars | Message in chart box |
| Assets by sector and criticality | Stacked bar | `sector`, `criticality` | Stacked segments per sector | Sector, criticality, count | Required: criticality | Sectors show `0` | Skeleton bars | Message in chart box |
| Assets by criticality | Horizontal bar | `criticality` | Bar length | Level, count | None (1 series) | Levels show `0` | Skeleton bars | Message in chart box |
| Assets by status | Horizontal bar | `status` (asset) | Bar length | Status, count | None (1 series) | Statuses show `0` | Skeleton bars | Message in chart box |
| CSF 2.0 coverage by function | Stacked bar | `CsfSubcategory.fn`, `EvidenceLink.subcategoryId` (coverage rule unverified) | Stacked: with and without evidence | Function, state, count | Required: coverage state | Functions show `0` | Skeleton bars | Message in chart box |
| Asset review status | Horizontal bar, 2 categories | `lastReviewed` (365-day cut-off, unverified) | Bar length | Category, count | None (1 series) | Both show `0` | Skeleton bars | Message in chart box |

### States per artboard

- Loading: skeleton per chart. Tile values show skeleton.
- Empty: zero-value categories render labeled `0`. Whole-chart empty message: designer proposes, unverified. RBAC can return zero docs.
- Error: message in chart box. Rest of grid still renders.
- Demo marker: out of scope. Not in chart spec. See Decisions, Demo marker.

### Components

| Component | Description |
|---|---|
| DistributionChart | Chart wrapper with legend, tooltip, and sr-only table. |
| StatTile | Label and value (Saira 600 28px). |
| TlpBadge | Chart legend. TLP label, token-based colors, ring for STRICT variants. |
| StatusBadge | Chart state legend. Status label with icon. Not color alone. |

Out of scope, not designed here: AttentionStrip, AttentionList, ActivityList, DemoMarker, DrillLink.

## 8. Decisions

Resolved. Designs follow these.

1. Radius: theme.css `--radius` 10px (`theme.css` line 2). HANDOFF 4px/2px not used.
2. Demo marker: out of scope. Keep current subtitle text as-is ("Sample data." stays in current app; not a design item). Placement not designed here.
3. TODAY: designs use fixture date `2026-10-21` and fixture counts. Changing to `new Date()` is an engineering task, not design.
4. Uploads on overview: out of scope, unchanged.
5. Sidebar 224px: out of scope, unchanged. Whether the dashboard uses the 224px layout: unverified.
6. TLP hex in `tlp-badge.tsx`: replace with `--viz-tlp-*` tokens. Recommended; in scope for color spec only.
7. Live data counts per login: out of scope. Design against fixture counts. Charts must handle empty data (empty state) since RBAC can return zero docs. Confirmation owner: unverified.
