# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A time-boxed (~4h) frontend take-home task: a React 19 + TypeScript + Vite app hosting the `ProductConfigurator` widget for "ConfigureFlow". The job is to triage `TICKETS.md`, fix what matters most for a client demo, and document decisions in `SUBMISSION_TEMPLATE.md` / the PR template (`.github/PULL_REQUEST_TEMPLATE.md`). Read `CONTEXT.md` for business rules (discount tiers, option dependencies, drafts, share URLs) and `TICKETS.md` for the backlog.

The tickets are deliberately imperfect:

- Board priority labels can be wrong; the description wins (e.g. CFG-152 is labelled Low but has a contractual WCAG angle).
- Some tickets contradict each other (CFG-144 "remove Quick Add" vs CFG-145 "add hotkey to Quick Add").
- Some are genuinely ambiguous and should be escalated rather than guessed (CFG-154 `>` vs `>=`, which also conflicts with `CONTEXT.md` percentages).
- "Suggested fixes" from Marcus (CFG-149, CFG-158) and claims like "dev-only flake" (CFG-147) must be verified against the code, not trusted.

Prioritise demo blockers, keep fixes root-cause and minimal, and record assumptions/questions for the submission.

## Commands

Package manager is **pnpm**; Node >= 22.13 (`.nvmrc` = 24).

```bash
pnpm install        # also installs lefthook git hooks (prepare script)
pnpm dev            # Vite dev server at http://localhost:5173
pnpm build          # tsc -b (type-check) + vite build
pnpm lint           # eslint .
pnpm format         # prettier --write .
pnpm format:check
pnpm preview
```

There is **no test runner configured** (no Vitest/Jest). Verification today = `pnpm build` (strict TS: `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax` → use `import type`) + `pnpm lint` + manual check in the browser. If tests are added, they'd need a runner installed first.

Pre-commit (lefthook) runs `prettier --write` and `eslint --fix` on staged files and re-stages them. Prettier: single quotes, semicolons, trailing commas, width 100.

## Git conventions

README asks for atomic commits with a readable history. Prefix commit messages with the ticket ID (`CFG-142: ...`). Work goes on a branch, submitted via PR using the provided template.

## Architecture

Data flow: `App.tsx` → `<ProductConfigurator product={mockProduct} />` → hook/services/utils. Only `mockProduct` (laptop) is rendered; `mockProductSimple` (t-shirt, contains the CFG-147 example values) is unused unless you swap it in.

- **`components/ProductConfigurator/ProductConfigurator.tsx`** — intentionally monolithic (~960 lines). All state is local `useState` (selections, add-ons, quantity, drafts, modals, validation, preview, error). Options are rendered via `renderOption` switching on `ProductOption.type` (`select` | `color` | `quantity` | `toggle`); add-ons render separately. `currentConfig` is a `useMemo` that drives the validation, preview, share-URL and price effects — anything in its deps (including `draftName`) re-triggers them, and it embeds `new Date()` timestamps.
- **`components/ProductConfigurator/types.ts`** — domain types and `ERROR_CODES`. `ProductConfiguratorProps` is duplicated here and in the component. `services/api.ts` and the hook use string literals for error codes instead of `ERROR_CODES`.
- **`hooks/usePriceCalculation.ts`** — async price fetching with a "latest request wins" guard via `latestRequestRef`. Note the guard compares against `PriceResponse.timestamp`, which `api.ts` sets to an incrementing **request counter**, not a time. The effect deps are `config.selections/addOns/quantity` (not `fetchPrice`). `useDebouncedPriceCalculation` exists but is unused.
- **`services/api.ts`** — mock backend with random latency (`calculatePrice` 150–800 ms, so responses arrive out of order on purpose). Also holds draft persistence (localStorage key `configureflow_drafts`, max 10) and share-URL encode/decode (`btoa`/`atob` of JSON — `btoa` throws on non-Latin-1 characters).
- **`utils/pricing.ts`** — `calculatePriceBreakdown` (used by the mock API = "server-side" pricing) plus `getAppliedDiscountPercentage` / `getNextDiscountTier` used directly by the component for the discount badge/hint. All three read `QUANTITY_DISCOUNT_TIERS`; threshold comparisons must stay consistent across them. `roundToCents` exists but isn't used.

Option/add-on dependencies (`dependsOn: { optionId, requiredValue }`) are evaluated in three places: `isAddOnAvailable` / `renderOption` in the component, `handleOptionChange` cleanup of dependent add-ons (select options only), and `validateConfiguration` in the API. Changes to dependency logic need to keep these in agreement.

The app renders under `<StrictMode>`, so effects run twice in dev — relevant when reasoning about listeners, leaks and request races.
