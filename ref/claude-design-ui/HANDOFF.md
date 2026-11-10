# Secure Asset Doc: UI implementation handoff

Rebuild this UI so it matches the design exactly. Treat `source/` as the source of truth for values and `screenshots/` as the visual reference for the result.

## Contents

| Path | Use |
|---|---|
| `source/Prototype.dc.html` | Primary reference. All screens, shared state, animations and behavior in one file |
| `source/Main`, `Operation`, `Viewer`, `Release`, `Audit`, `Controls` `.dc.html` | Static-state reference for each screen. Some copy and sample data differ from the prototype; the prototype wins |
| `source/canvas.json` | Canvas layout only. Not needed in the app |
| `screenshots/prototype/` | 15 states from the end-to-end flow, in order |
| `screenshots/artboards/` | The six standalone screens |

## How to read the source files

`.dc.html` is a design-tool format and does not run outside the design canvas. Do not ship or try to execute it. Translate it:

- `{{a.b}}` is a value from `renderVals()`.
- `<sc-for list="{{x}}" as="i">` is a loop. `<sc-if value="{{x}}">` is a conditional.
- `<helmet>` holds global CSS and font links.
- The `<script type="text/x-dc">` block holds state and logic. `class Component extends DCLogic` behaves like a React class component, with `renderVals()` preparing the template's values.
- Inline styles hold the exact spacing, sizes and colors. Copy these numbers; do not round them or swap in a framework's defaults.

## Design tokens

### Color

| Token | Value | Use |
|---|---|---|
| `bg` | `#0F1210` | Page ground |
| `bg-sunken` | `#0B0D0B` | Behind the document page |
| `bg-side` | `#131714` | Sidebar, right-hand panels |
| `surface` | `#171B18` | Cards, tables, inputs |
| `surface-active` | `#262C27` | Hover, selected, active nav |
| `line-subtle` | `#252B26` | Row dividers |
| `line` | `#2E3530` | Panel borders |
| `line-strong` | `#434B44` | Input and button borders |
| `line-selected` | `#8A938B` | Selected outline |
| `text` | `#E8EAE4` | Primary text; primary button fill |
| `text-2` | `#C4CAC1` | Secondary text |
| `text-3` | `#A3ABA2` | Labels and captions |
| `pass` | `#A8D8BC` | Permit, verified |
| `warn` | `#E8C877` | Pending, deny events in the ledger |
| `fail` | `#FF9D94` | Deny, failure |
| `erase` | `#C9BBF2` | Cryptographic erase queue |
| `paper` / `ink` | `#F5F4EF` / `#171B18` | Document page |

Classification levels. Strong color is reserved for these wherever possible, and each always carries its text label:

| Level | Fill | Text | FIPS 199 |
|---|---|---|---|
| RED | `#B3261E` | `#FFFFFF` | High |
| AMBER | `#F0B429` | `#14110D` | Moderate |
| GREEN | `#1E7B45` | `#FFFFFF` | Low |

Prototype-only controls use `#1B1F2B`, `#343B57`, `#6F7A9C`, `#AEB6D4`, `#C5CBE0` and `#E2E5F1`. Leave these out of production.

### Type

Google Fonts: `Saira Semi Condensed` (500, 600, 700) for headings, `IBM Plex Sans` (400, 500, 600) for UI, `IBM Plex Mono` (400, 500, 600) for control numbers, hashes, codes and banners.

| Role | Style |
|---|---|
| Page title | Saira 600, 34px, line-height 1.1 |
| Panel title | Saira 600, 24px, line-height 1.15 |
| Tile number | Saira 600, 28px, line-height 1 |
| Body | Plex Sans 400, 14px, line-height 1.45 |
| Section heading | Plex Sans 600, 13px |
| Caption | Plex Sans 400, 12px |
| Banner | Plex Mono 600, 12px, letter-spacing 0.08em, line-height 28px |

### Shape and layout

- Radius: 4px on controls and panels, 2px on level chips. No shadows, except the toast.
- Minimum control height: 44px. Registry rows 56px, ledger rows 48px.
- Sidebar 224px, right panel 380px (340px on audit, 300px on the viewer), main padding 24px. Designed at 1440px wide.
- Below those widths the panels and sidebar wrap and stack. Wide tables scroll inside their own box.

### Motion

Copy from the `<helmet>` of `source/Prototype.dc.html`:

- Screen change: fade and rise 10px, 280ms, `cubic-bezier(.2,.7,.2,1)`.
- Detail panel on selection change: fade and slide 12px from the right, 220ms.
- Table rows: fade and rise 6px, 260ms, staggered by 30ms up to 210ms.
- Toast: fade and rise 12px, 240ms, auto-hide after 3.4s.
- Hover and press: color changes 150ms, `scale(.98)` while pressed.
- Banner color: 300ms.
- Respect `prefers-reduced-motion` by turning all of this off.

## Screens

1. **Document registry**: tiles that filter, search, level filter, table, and a detail panel with the access decision.
2. **Operation access**: participant-by-document matrix, effective access, revoke, and an access-decision tester.
3. **Secure viewer**: page thumbnails, watermarked page, session timer, seal, and blocked actions.
4. **Dual authorization**: request queue, five-step progress, approvers, approve or deny.
5. **Audit ledger**: event filters, hash-link detail, chain verification.
6. **NIST controls**: decision flow and a filterable SP 800-53 mapping.
7. **Document not available**: shown for a denied request. It must not confirm that the document exists.

A sticky banner at the top and bottom always shows the highest level on screen.

## Access rules (the core requirement)

- **RED is per person and per document.** Access requires being named in that document. Rank, role, base level and membership of the operation do not grant it.
- **Permit condition for RED:** named in the document, read-in signed, operation active, session at AAL3, managed device.
- **AMBER and GREEN** use base level, where AMBER covers GREEN.
- **Hidden means hidden.** Documents a user may not access do not appear in lists or search, and denials are worded so they do not reveal existence.
- **Security officers** see RED metadata and manage access, but cannot read titles or content.
- **Adding access needs two people:** the commander and a security officer. Requesters cannot approve their own request. Revoking needs one person and applies at once.
- **Everything is logged,** including denials.
- **Navigation by role:**
  - Sergeant: registry, viewer, requests.
  - Commander: adds operation access.
  - Security officer: adds audit and NIST controls.

## Prototype-only items: do not ship

- The "view as" persona bar, "Try a hidden RED document", Reset and the guided demo.
- The dashed "Prototype note" on the denied screen.
- The persona data, requests and events hardcoded in the script. Replace them with API data.
- The "SAMPLE DATA" banner text. Use the organization's real marking rules.

## Security: the prototype only simulates these

The prototype makes all decisions in the browser, which is not acceptable in production. The real system must:

- Evaluate and enforce every access decision on the server. Hiding something in the UI is not access control.
- Never send a browser any data the user may not see, including titles and counts.
- Do real encryption, key handling, signatures and hash-chaining on the backend and HSM. The hashes and verify result shown here are simulated.
- Treat watermark and print or copy blocking as deterrents, since a browser cannot fully enforce them.

NIST mapping here is a design mapping, not evidence of compliance. RED, AMBER and GREEN are a proposed scheme, and national classification rules take priority.
