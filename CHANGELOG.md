# Changelog

## 1.0.0

First public release.

- Adds an **Offer History** card to the trade-building screen on sleeper.com, in both the classic
  and the new ("beta") layouts, in dark and light mode (the classic layout is dark only).
- Shows every past offer with the same owner(s): sent and received, with its outcome
  (Accepted, Rejected, Pending, Cancelled, Failed), date, and who would get what, including draft picks.
- Warns when the draft is an **exact repeat** or a **very similar** offer, and when it shares
  assets with an earlier offer. The warning updates as you add or remove players.
- Summary pills at the top of the card (accepted / rejected / pending / cancelled) filter the list.
- Works for redraft, keeper and dynasty leagues; follows a league back through earlier seasons.
- Keeps its own copy of your offer history in the browser (`chrome.storage.local`).
- Hardened against malformed data, corrupted saved data and hostile text; includes a browser test
  suite (`tests/`) that runs on dummy data.
