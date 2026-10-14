# Submission: [Your Name]

## Time Spent

Total time: **\_\_** (approximate)

## Ticket Triage

### Tickets I Addressed

List the ticket numbers you worked on, in the order you addressed them:

1. **CFG-142**: Fixed the price-response guard, which discarded every response. Only the latest request's response is applied now.
2. **CFG-147**: Fixed share links that crashed the app on non-Latin-1 names or failed to open when the encoded data contained `+`.
3. **CFG-148**: Fixed the crash when turning off "Include Packaging" with Gift Wrap selected. Dependent add-ons are now removed for every option type.
4. **CFG-158**: Marcus's fix would be a no-op (`product` is already stable, `currentConfig` already memoized). The real cause: typing a draft name re-ran validation, preview and price. These now ignore the name.
5. **CFG-145**: Added a Ctrl/Cmd+Enter shortcut for Quick Add, shown on the button. Quick Add is now also blocked while the price is recalculating, so it can't add a stale price.
6. **CFG-152**: Color swatches are now focusable buttons with arrow-key navigation. Modals close on Escape wherever focus is and always return focus to their trigger. Added missing focus styles.
7. **CFG-143**: Both suspects from the ticket were real. The resize listener was never removed, and every change downloaded a new preview image because of a `Date.now()` cache-buster. Added the cleanup and dropped the timestamp, so the image is cached.
8. **CFG-151**: Each error code now maps to a plain-language message with a next step. The raw code is no longer shown.
9. **CFG-149**: No code change needed. The dimmed price and "Calculating..." were already there but ended early, because `isLoading` cleared after any response. Fixed in CFG-142, verified in the browser. I didn't take Marcus's `'...'`: it would hide the price on every change and shift the layout.
10. **CFG-156**: No key warnings in the console, and no keys were missing even in the original code. Swatches used the index and add-ons used the name as keys; both now use the id.
11. ...

### Tickets I Deprioritized

List tickets you intentionally skipped and why:

| Ticket  | Reason                                                                                                                     |
| ------- | -------------------------------------------------------------------------------------------------------------------------- |
| CFG-144 | Rejected: CFG-145 is newer and says TechStyle relies on Quick Add and wants to show it in the demo. Product should confirm |

### Tickets That Need Clarification

List any tickets where you couldn't proceed due to ambiguity:

| Ticket  | Question                                                                                                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CFG-150 | Couldn't reproduce: both products have 5 colors, which fit in one row even at 320px. Which device and product? Need the screenshot. Also, the JS sets `--color-columns` but no CSS uses it |
| CFG-146 | Couldn't reproduce: times are stored in UTC (ISO) and shown in local time. Which screen, timezone and browser? A screenshot would help                                                     |

### Tickets With a Misleading Priority Label

Our board labels aren't always right. List tickets where you disagreed with the label (e.g. a Low that's actually High, a High that's actually Low, a Medium that's actually Unclear) and explain why. If you didn't disagree with any, say so.

| Ticket  | Label on board | Your read   | Why                                                                                                                                                            |
| ------- | -------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CFG-147 | 🔴 Critical    | 🟠 High     | Only names with special characters trigger it; configurations without a name (or with a plain one) share fine. Customers hit it, but it doesn't block the demo |
| CFG-158 | 🟠 High        | 🟡 Medium   | Only extra mock requests while typing a draft name; no visible lag or flicker                                                                                  |
| CFG-152 | ⚪ Low         | 🔴 Critical | The color can't be chosen without a mouse, and TechStyle's MSA has accessibility clauses. Shipping the demo like this is a contract risk                       |

### Tickets Where You Stopped to Ask Instead of Implementing

If a ticket was ambiguous enough that the right move was to escalate / ask PM / gather more context rather than ship a fix, list it here. We value this signal — picking one interpretation blindly and shipping it can cost more than stopping to ask.

| Ticket  | Who would you ask     | What you'd ask                                                                                                                                                                                                             |
| ------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CFG-154 | PM / Finance, backend | Does the tier start at 50 (`>=`) or 51 (`>`), and is it 10% or 15%? `CONTEXT.md` and the "Add N more" hint imply `>=` and 10%, but the real backend charges the price, so changing only the UI could show the wrong amount |

---

## Technical Write-Up

### Critical Issues Found

Describe the most important bugs you identified:

#### Issue 1: Price stuck at $0.00

**Ticket(s):** CFG-142

**What was the bug?**
The guard in `usePriceCalculation` compared `Date.now()` with `PriceResponse.timestamp`, which is actually a request counter (1, 2, 3…). The check never passed, so no price reached state.

**How did you find it?**
The ticket pointed at the hook's guard. I traced `timestamp` back to `api.ts`, saw it was `++requestCounter`, and confirmed in the browser.

**How did you fix it?**
Rewrote the hook with the standard effect + `ignore` cleanup pattern. Only the latest effect run can update state, and `isLoading` is derived from the inputs of the last result instead of being set inside the effect. The file already had `set-state-in-effect` lint errors that blocked any commit touching it, so the rewrite was needed anyway. I also removed the unused `useDebouncedPriceCalculation` and `refetch`.

**Why this approach?**
Request ordering is a client concern, so it shouldn't depend on a server field. A one-line fix (client-side request counter) also worked, but it couldn't be committed without suppressing lint. I left out `AbortController` and debouncing to keep the scope small.

---

#### Issue 2: Share links crash or fail to open

**Ticket(s):** CFG-147

**What was the bug?**
`btoa` throws on non-Latin-1 characters, so a name like `Żółć test 🎨` crashed the whole widget when the Share modal opened. The base64 was also put into the URL unescaped, so any `+` came back as a space and the link wouldn't decode (only with certain characters in the name, e.g. `?>`).

**How did you find it?**
Read the share code path and reproduced both bugs in Node. Nothing in it depends on the build, so the "dev-only flake" theory doesn't hold.

**How did you fix it?**
Encode via UTF-8 bytes into base64url. The decoder also accepts the old format, so existing links still open.

**Why this approach?**
It fixes both bugs in one place (`api.ts`) and keeps old links working. `encodeURIComponent` alone wouldn't fix the crash.

---

#### Issue 3: Crash when deselecting "Include Packaging"

**Ticket(s):** CFG-148

**What was the bug?**
`handleOptionChange` removed dependent add-ons only for `select` options. Turning off the `include_packaging` toggle left Gift Wrap selected, and the summary's `availableAddOns.get(id)!` returned `undefined`. The cleanup for `select` also mutated state in place with `splice`.

**How did you find it?**
Followed the error to the summary, then checked why an unavailable add-on was still selected. Step 2 ("Premium Material") isn't needed to reproduce it.

**How did you fix it?**
The cleanup now runs for every option type and filters immutably. The summary skips add-ons that aren't available, so a draft or hand-edited share link can't crash it either.

**Why this approach?**
It fixes the root cause where dependencies change and adds a cheap guard where the crash happened. The component had 4 existing lint errors that blocked the commit, so I fixed them first in a separate commit (see Other Changes).

---

### Other Changes Made

Brief description of any other modifications:

- Fixed the existing lint errors in `ProductConfigurator`: the share-URL config is read in lazy `useState` initialisers, `shareUrl` is derived with `useMemo`, the empty `catch` in validation now sets an error, and `isDirty` is set in the change handlers. Side effect: Discard no longer shows on a fresh, loaded or shared configuration.

---

## Code Quality Notes

### Things I Noticed But Didn't Fix

List any issues you noticed but intentionally left:

| Issue                                                            | Why I Left It                                                                                                        |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `PriceResponse.timestamp` is a counter, not a time               | Misleading name; the client no longer uses it                                                                        |
| CFG-147: the configuration name from a share link isn't restored | Out of scope for CFG-147                                                                                             |
| CFG-147: decoded selections aren't validated against the product | Edge case (old or hand-edited links); validation already flags it                                                    |
| No error boundary around the widget                              | Out of scope; worth adding before the demo                                                                           |
| Misleading comment in `mockProductSimple` (`10" Large`)          | Only option values are encoded, not labels                                                                           |
| CFG-152: no focus trap in modals                                 | Escape and focus return work; full trap is beyond the audit's list                                                   |
| CFG-151: the error banner never clears                           | `setError(null)` is never called, so the banner stays after a successful retry. Needs a decision on when to clear it |
| Changing the draft name triggers a price refetch                 | `draftName` is part of `currentConfig`; the price stays correct, but splitting it out belongs in the component       |

### Potential Improvements for the Future

If you had more time, what would you improve?

1. Split `ProductConfigurator` (~1000 lines, all state local) into smaller components and hooks (options, add-ons, summary, modals, drafts/share). Most bugs here came from logic spread across one file.
2. Fix the remaining ESLint issues: `exhaustive-deps` on the `onConfigurationChange` effect and two `any`s in `types.ts`. `pnpm lint` still fails on them.

---

## Questions for the Team

Questions you would ask in a real scenario:

1. [Question 1]
2. [Question 2]

---

## Assumptions Made

List any assumptions you made to proceed:

1. CFG-142: I couldn't reproduce the "correct price flashes, then reverts" part. In the original code no response could ever pass the guard, so the real price never reached the UI. The fix makes it moot; if it still happens, I'd ask Jamie for a screen recording.

2. CFG-147: "Worked on prod a month ago" likely means earlier links had ASCII names and no `+`. I'd ask Jamie for the customer's link to confirm it now opens.

3. CFG-152: There's no custom dropdown; options use native `<select>`, which already supports arrow keys. I took item 4 to mean the color picker (`role="radiogroup"`), which now has arrow-key navigation.

---

## Self-Assessment

### What went well?

[Your reflection]

### What was challenging?

[Your reflection]

### What would you do differently with more time?

[Your reflection]

---

## AI Assistance Notes (optional)

If you used AI tools (Copilot, Claude, Cursor, ChatGPT, etc.), we'd love a short note on how. **We don't score the fact that you used AI — we score the quality of your reasoning and verification.**

Useful things to share:

- What kinds of prompts you sent (paraphrase is fine, no need to paste logs)
- Where the AI helped and where you overrode it
- Anything the AI suggested that you rejected — and why
- Anything you verified manually that the AI got wrong

---

## Additional Notes

Anything else you want us to know:

[Your notes]
