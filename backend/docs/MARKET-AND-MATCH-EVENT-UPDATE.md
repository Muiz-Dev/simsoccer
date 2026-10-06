# Match Events and Market Expansion

**Status:** Implementation guide and rollout record.
**Scope:** Live/result match details, market coverage and pricing, settlement compatibility, and icon sourcing.

## Product boundary

The football simulation remains authoritative. Match details and betting markets consume its committed events and statistics; neither the UI nor market pricing may change match simulation outcomes. Keep the existing visual design and extend the current match rows/details rather than redesigning the match centre.

Public sportsbook rules are examples of product conventions, not a universal source of prices, available lines, or settlement law.

## Baseline behavior before this update

### Match events

- `MatchEngine` generates goals, shots, corners, fouls and cards. The simulation worker persists events in `match_events` and broadcasts each event over `/ws`.
- `FOUL`, `YELLOW_CARD` and `RED_CARD` are mutually exclusive event types for a single foul incident. A card event currently replaces the foul event; it does not say in metadata that a foul also occurred.
- The world overview endpoint queries `GOAL` events only. The match-centre expandable timeline consequently renders goals only.
- The browser subscribes to live fixtures and receives all event types, but updates only score, clock and status. It does not keep a visible event timeline or request missed events on reconnect.
- Final `match_statistics` rows contain shots, corners, fouls and cards. The betting page's current statistics endpoint instead returns historical form and head-to-head data; it does not return those fixture statistics.

Relevant implementation: [match-engine.ts](../src/simulation/match-engine.ts), [simulation.worker.ts](../src/workers/simulation.worker.ts), [websocket.ts](../src/realtime/websocket.ts), [app.ts](../src/app.ts), [WorldDataContext.tsx](../../frontend/src/contexts/WorldDataContext.tsx), [MatchCentre.tsx](../../frontend/src/components/MatchCentre.tsx).

### Markets and prices

- The probability engine previously offered total-goal half-lines `0.5` through `4.5`, both Over and Under; it did not offer `5.5` or whole-number Asian totals.
- It offered one total-corners line, Over/Under `9.5`, and one total-cards line, Over/Under `4.5`.
- It also creates 1X2, double chance, BTTS and a selected set of correct scores. The selected correct scores are not an exhaustive score market.
- The regular margin was `5.5%`; correct score uses `8%`. The engine converts each supplied event probability to odds with a per-outcome multiplier. That is not a universal market standard, and overlapping outcomes (such as Double Chance) should not be described as having the same simple overround as mutually exclusive outcomes.
- Settlement handles whole-number totals as ordinary wins/losses only by accident today: explicit push semantics are not implemented for them. The `TOTAL_CORNERS` and `TOTAL_CARDS` rules grade from final `match_statistics`.
- Market preparation previously ran only when a fixture had no markets. It would not fill missing market types on a partially populated fixture.
- The quick-pick row shows 1X2, Double Chance and Total Goals 2.5. The expanded market dialog renders the markets returned by the API, so corners/cards can appear there when persisted.

Relevant implementation: [probability-engine.ts](../src/markets/probability-engine.ts), [coordinator.ts](../src/football/coordinator.ts), [rules.ts](../../settlement-api/src/rules.ts), [processor.ts](../../settlement-api/src/processor.ts), [BettingDesk.tsx](../../frontend/src/app/betting/BettingDesk.tsx).

## Online research and evidence

### Goals and corners

- [bet365 Soccer Rules — Goalscoring Markets](https://help.bet365.com/s/en-us/sportsrules/soccer/goalscoring-markets) documents goal totals, BTTS, correct score and the normal-time scope for those markets.
- [bet365 Soccer Rules — Goal Line](https://help.bet365.com/s/en-us/sportsrules/soccer/goal-line) gives whole-number goal-line examples and push/return-of-stake behavior, plus split Asian lines that can result in half wins or losses.
- [bet365 Soccer Rules — Team Markets](https://help.bet365.com/s/en-us/sportsrules/soccer/team-markets) documents team-goal markets.
- [bet365 Soccer Rules — Corners](https://help.bet365.com/s/en-us/sportsrules/soccer/corner-markets) and [Asian Corners](https://help.bet365.com/s/en-us/sportsrules/soccer/asian-corners) document total/team/alternative corners and operator-specific counting rules. Their examples include an 8.5 line and whole-number push treatment.

These sources support configurable ladders and explicit settlement rules; they do not establish that every operator offers every line in every fixture. Whether a corner counts, a market's period, and abandoned-match handling must be stated in SimSoccer's own rules.

### Probability, odds and calibration

- [Smarkets — How to calculate betting margins](https://help.smarkets.com/hc/en-gb/articles/214180145-How-to-calculate-betting-margins) explains reciprocal decimal odds and overround. Overround is calculated for a mutually exclusive market as `sum(1 / odds) - 1`.
- [Dixon and Coles (1997)](https://doi.org/10.1111/1467-9876.00065) describes statistical football score modeling using Poisson regression and bookmaker data. It supports score-distribution modeling as a method, not any particular SimSoccer price or margin.

For mutually exclusive outcomes, a proportional de-vig estimate can be shown as `raw_implied_probability / sum(raw_implied_probabilities)`. That is a chosen normalization method, not a uniquely true fair probability. Prices vary by operator, model, market and margin; no fixed decimal odds should be promised for an outcome such as Over 2.0.

### SVG asset sources

The [MingCute icon repository](https://github.com/mingcute-design/mingcute-icons) contains a matching regular-stroke [whistle SVG](https://raw.githubusercontent.com/mingcute-design/mingcute-icons/main/packages/svg/core-regular/whistle.svg), [flag SVG](https://raw.githubusercontent.com/mingcute-design/mingcute-icons/main/packages/svg/core-regular/flag-3.svg), and [vertical rectangle SVG](https://raw.githubusercontent.com/mingcute-design/mingcute-icons/main/packages/svg/core-regular/rectangle-vertical.svg). The repository is Apache-2.0 licensed; retain the applicable license/attribution notices when copying assets. A single card silhouette can be tinted yellow or red, avoiding separate duplicate card drawings. Review the exact SVG and repository license before checking assets into the project.

## Safe pre-change baseline measured from the simulator

A read-only Monte Carlo run simulated 1,000 seeded matches directly with `MatchEngine`; it did not connect to PostgreSQL/Redis or modify world data. With equal nominal team ratings and no player roster:

| Measure | Sample |
|---|---:|
| Mean total goals | 2.841 |
| Matches over 2.5 goals | 54.0% |
| Mean total corners | 10.935 |
| Matches over 7.5 corners | 84.6% |
| Matches over 9.5 corners | 63.9% |
| Mean fouls | 22.442 |
| Mean yellow cards | 3.557 |
| Mean red cards | 0.307 |

This is one simulator sample, not a real-football benchmark or production-database comparison. It suggests that Over 7.5 corners is likely much shorter than Over 9.5 in this engine, but it is not sufficient to certify odds. The corner model should be calibrated against repeated simulation runs and, if desired, explicitly approved read-only production aggregates.

## Agreed defaults and implementation

- **Goal totals:** publish both Over and Under at every `0.5` increment from `0.5` through `5.5`, including whole-number lines. A whole-number exact result pushes the selection. This first range can be extended later if calibration supports it.
- **Corners:** publish both sides of half-lines `6.5` through `14.5`. This is an initial configurable ladder around the simulator's observed total-corner mean; it is not a claim that all books offer the same lines.
- **Standard margin:** use `4.5%` for standard complete markets. Keep Correct Score at its separate `8%` until its outcome coverage/pricing is deliberately revisited. This changes pricing margin, not simulation randomness.
- **Match details:** preserve the existing match-centre layout. Expanded live/results details show goal markers under their scoring team and a compact, fixed set of comparison stats; they do not replay every event.

The implementation follows those decisions additively: it creates missing markets for eligible scheduled fixtures and does not rewrite existing market, bet, settlement, or statistics rows. Legacy `TOTAL_CORNERS` 9.5 records cover that line and are not duplicated. No database connection, live-data query, reset, or seed command was run.

### Implemented behavior

- Card incidents retain their existing event type and now include metadata that identifies the accompanying foul and card, allowing one timeline entry to show both without duplicating the incident.
- The world overview and fixture-events endpoint expose all match events in sequence. Expanded match details show only goal markers and five compact stats: shots, shots on target, corners, fouls and cards. Live values are derived from the event stream, then final stored statistics take precedence. Possession is deliberately omitted: although columns exist in the schema, the simulation does not currently write calculated possession and the database default is 50/50.
- The browser merges WebSocket events by sequence, requests missed events after reconnect, and retries disconnected sockets with backoff.
- Total-goal markets cover Over and Under from 0.5 through 5.5 in half increments. Whole-number lines are priced conditional on no push and settle as void on the exact line.
- Total-corner markets cover Over and Under from 6.5 through 14.5. The expected count is calibrated to the simulator's observed average; this remains a simple Poisson approximation, not a fitted real-world corner model.
- Standard pricing uses a 4.5% per-outcome probability multiplier; Correct Score remains at 8%. Published odds are rounded to two decimals and floored at 1.01, so tail markets can have a realized overround below 4.5% after the minimum-odds floor.
- New simulations use the configured simulation version. Resumed matches use the seed and simulation version already persisted for that match.

The total-cards settlement convention remains as it was: one unit per yellow and two additional units per red. A second yellow followed by a red therefore counts as four units. This update does not redefine that market.

## Acceptance checks

- Live event catch-up remains sequence-complete, while the match-details UI summarizes those events into stat totals rather than displaying a play-by-play feed.
- Match event display does not change simulation RNG consumption, scores or the existing deterministic match hashes for the same engine version.
- Live stats reconcile to event facts; final stats reconcile to stored `match_statistics`.
- Every configured market line has Over and Under outcomes with valid probabilities/odds, explicit period and settlement definition, and tested win/push/loss cases.
- Price tests assert the configured overround on representative complete mutually exclusive outcomes after published rounding. Low-probability tail outcomes can be constrained by the 1.01 minimum-odds floor.
- Market preparation is idempotent and additive; existing accepted odds, bets and settlements are unchanged.
- Existing desktop/mobile layouts remain intact except for the requested event/stat details and added expanded-market options.
