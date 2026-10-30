# 2026-10-30 – Rate a routine step after the fact

Interview (grill-me) answers from Paul and the decisions derived from them.

| # | Question | Answer | Decision |
|---|---|---|---|
| 1 | Where to rate later | Both places | End-of-routine summary + per-entry history on the Progress screen (any day). |
| 2 | Change an existing rating | Yes, including removal | Clean / OK / Broke / no rating, at any time. |
| 3 | Does a late rating count toward the 3-clean streak | Yes | Late ratings are ratings; a late OK/Broke breaks the streak. The +4 suggestion appears at the next practice. |
| 4 | Reminder | Small line on Home | Shown only while unrated steps exist; disappears when all are rated. |
| 5 | Reminder range | Last 7 days | Today and the 6 days before. |
| 6 | Tapping the reminder | Window with all steps | One list with Clean / OK / Broke per step. |
| 7 | Branch | New branch on top of sync | `rate-later` from `d1-sync`, so late ratings sync between devices. |
| 8 | Goal | Correct picture and correct streak | — |

## Technical decisions (made by Claude)
- `RT.setRating(subId, entry, rating|null)` edits the existing working-tempo entry in place (same id → synced as an edit, last change wins). It refuses clean-max entries, so clean max can never be touched.
- It re-finds the entry by date in current state, because a sync may have replaced the object the practice screen still holds.
- The reminder counts only routine steps (`src: "routine"`) without a rating. Manually logged working tempi can still be rated in the history, but are not counted.
- Steps not linked to an exercise have no entry; they can be rated only in that session's summary (as before).
- The session log text (`plan.log`) is not rewritten; the rating lives on the entry.
- The +4 suggestion is not shown while rating late; `RT.raiseSuggestion` already counts late ratings at the next practice.
- In the summary, tapping the current rating again clears it.
