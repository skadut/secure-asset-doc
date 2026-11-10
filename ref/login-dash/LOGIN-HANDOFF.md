# Secure Asset Doc: login page specification

Build the sign-in page for Secure Asset Doc so it matches the design exactly, then hand the user into the document registry. This file extends `HANDOFF.md` from the main handoff package. Its tokens, fonts and motion rules apply here unless this file says otherwise.

## Source of truth

| File | Use |
|---|---|
| `source/Login.dc.html` | The login page: all steps, markup, styles, animation and logic |
| `source/LoginFlow.dc.html` | The same login inside the full app, showing the hand-off to the registry and sign-out |
| `source/Login-*.dc.html` | One artboard per state, each mounting `Login.dc.html` with a fixed `step` |

To read these files, follow the instructions in `HANDOFF.md`. The `/*LG-CSS*/` and `/*LG-JS*/` sections hold everything specific to login. Copy exact values from the source; do not round them.

## Authentication flow

| # | Step | Factor or check |
|---|---|---|
| 0 | System use notice | Consent before anything else (NIST AC-8) |
| 1 | Username and password | Something you know |
| 2 | Authenticator code | 6-digit TOTP from Google Authenticator (RFC 6238, 30-second period) |
| 3 | Device check | Network, authenticator code, device hostname, clock |
| 4 | Confirm | Previous sign-in and failed attempts since then (AC-9), then enter |

There is no smart card and no security key. Password plus TOTP is assurance level AAL2 under NIST SP 800-63B. TOTP is not phishing-resistant, and the design says AAL2 wherever assurance appears.

## Layout

At 1440px wide there are two columns. Below that width they wrap and stack.

- **Left panel** (`flex: 1 1 420px`, padding 48px 40px, background `#131714`, right border `#2E3530`):
  - A 32px grid pattern in `#1A1F1B`, with a scan line moving top to bottom every 6 seconds.
  - Logo and name, then a 44px Saira 600 heading: "Sign in to Secure Asset Doc".
  - Four fact boxes: Factors, Assurance, Enclave, Session.
  - A help line pinned to the bottom.
- **Right panel** (`flex: 1 1 520px`, padding 48px 24px): a column with `max-width: 520px` containing:
  - A five-part progress bar: Notice, Sign in, Code, Device, Confirm.
  - One card (`#171B18`, padding 28px, radius 4px) holding the current step.
- **Banners**: sticky banners at the top and bottom, GREEN `#1E7B45`, reading "GREEN // SIGN-IN, NO CONTROLLED CONTENT SHOWN".

Progress segment colors: done `#A8D8BC`, current `#E8EAE4`, not started `#2E3530`, locked `#FF9D94`.

## States

| State (`step` prop) | Content | Leaves when |
|---|---|---|
| `notice` | Scrollable notice (max 220px), consent checkbox, Continue (disabled at 45% opacity until checked) | Consent is checked and Continue is pressed |
| `password` | Username (`autocomplete="username"`), password (`autocomplete="current-password"`) with a show and hide toggle, Continue | Fields are filled and submitted |
| `passwordError` | Both fields get a red border, the card shakes, the alert reads "Username or password is incorrect. N attempts left before the account locks." | Retry |
| `code` | Account line with a 30-second countdown ring, 6-digit input (`autocomplete="one-time-code"`, Plex Mono 26px, letter-spacing .5em), 6 progress dots, "Verify code", "Sign in as someone else" | Correct code |
| `codeError` | Red input border, the card shakes, the alert reads "That code did not match…" | Retry |
| `device` | Four checks resolving in order, with a spinner on the current one | All checks pass |
| `deviceDone` | All four checks passed, and Continue is enabled | Continue |
| `welcome` | "Identity verified", name and role, last successful sign-in, failed attempts since then, an AC-9 warning, session rules, Enter, "Cancel and sign out" | Enter |
| `locked` | Lock icon, "Account locked", a 15-minute lockout message | Lockout expires, or a security officer resets the account |

### Device checks

| Check | Requirement | Passing value |
|---|---|---|
| Network | Must be inside the isolated enclave | Enclave ENC-2 |
| Authenticator code | Second factor for this session | Verified, Google Authenticator |
| Device hostname | Must be a registered workstation | ENC2-WS-14, registered |
| Clock | Needed for time-based codes | Synchronized, drift under 30 s |

### Rules

- **Generic errors:** errors never reveal whether the username or the password was wrong, or whether an account exists.
- **Lockout:** five failed attempts in total, counting passwords and codes together, lock the account for 15 minutes (AC-7).
- **What is never logged:** passwords and codes are never logged or kept, and their fields clear after each failure.
- **Busy buttons:** while a request is checking, the button shows a spinner and the label "Checking" or "Verifying", and is disabled.
- **Entering:** the page fades out over 600ms, then the app opens on the registry for the person who signed in.
- **Sign-out:** from the app sidebar, sign-out ends the session and returns to the notice.
- **Logging:** each success, failure, lockout and sign-out is logged.

## Motion

All keyframes are in the `/*LG-CSS*/` block of `Login.dc.html`.

| Element | Animation |
|---|---|
| Page entry | Fade and rise 14px, 500ms, staggered 0, 100 and 200ms |
| Step change | Fade and slide 18px from the right, 320ms, `cubic-bezier(.2,.7,.2,1)` |
| Wrong password or code | Horizontal shake on the card: 8, 8, 5 and 5px over 400ms |
| Code countdown ring | Stroke empties over 30 seconds, then loops |
| Busy button | Spinner, rotating every 0.9s |
| Device checks | Each resolves 550ms after the last, with a spinner on the current one |
| Checkmarks | Stroke draws in over 400ms |
| Field borders | Color changes over 200ms |
| Leaving | Fade and scale to 1.02 over 600ms |

Respect `prefers-reduced-motion` by turning all of these off.

## Copy

Use the copy as written in `Login.dc.html`. Keep the bracketed placeholders, such as `[ORGANIZATION NAME]`, `[LEGAL TEXT FROM YOUR ORGANIZATION]` and `[PHONE EXTENSION]`, until the organization supplies the real text. The notice's legal wording must come from the organization.

## Accessibility

- Every control is a real `<button>`, `<input>` or `<label>`, at least 44px high.
- Each input has a visible label. The show and hide button has an `aria-label` and `aria-pressed`.
- Status lines use `role="status"`. Errors and lockout use `role="alert"`.
- The password and code forms submit on Enter.
- Focus outlines are 2px `#E8EAE4`.

## Prototype-only items: do not ship

- **"Fill in as" buttons**, and the dashed notes that reveal the password `Secure#2026` and the code `123456`.
- **Timed delays:** the checking delays and timed device checks stand in for real server responses.
- **"Start over" on the locked screen.**
- **Hardcoded sample data:** the four sample users and their last sign-in values.

## Production security requirements

The prototype only simulates these. The real system must:

- **Verify the password on the server** against a slow, salted hash such as Argon2id, and check new passwords against breached-password lists (SP 800-63B).
- **Verify TOTP on the server:**
  - Store each secret encrypted (an HSM-wrapped key is suitable).
  - Allow at most ±1 time step.
  - Reject a code that was already used.
  - Rate-limit attempts.
- **Enroll TOTP securely:** a QR code shown once after identity proofing, plus a recovery path handled by the security officer.
- **Check the device on the server:** source network, registered hostname (or a device certificate), and clock drift.
- **Issue a session only after every step passes:** an HttpOnly, Secure, SameSite=Strict cookie, idle lock after 5 minutes, hard limit of 30 minutes, and a new session ID at sign-in.
- **Keep failure and lockout state on the server,** and alert the security officer on lockouts.
- **Return the same generic error to everyone,** whether or not the account exists.
- **Log each event server-side** in the hash-chained audit ledger.

## Decision to flag

The dashboard's access policy now requires `session.assurance >= AAL2`, to match password plus TOTP. If RED documents must require phishing-resistant AAL3, a FIDO2 key or a smart card is still needed. That decision belongs to the system owner.

## Acceptance checklist

- [ ] At 1440x900 each state matches its artboard in the design canvas.
- [ ] Continue stays disabled until the notice is accepted.
- [ ] A wrong password and a wrong code both show generic errors and shake the card.
- [ ] Five failed attempts in total lock the account.
- [ ] The code input accepts digits only, up to 6, and the countdown ring loops every 30 seconds.
- [ ] The four device checks resolve in order, and Continue enables only after the last one.
- [ ] Enter fades out, then opens the registry as the person who signed in.
- [ ] Sign-out returns to the notice, and a sign-out event is logged.
- [ ] With reduced motion turned on, no animation plays.
- [ ] At phone width the columns stack, with no horizontal scroll.
