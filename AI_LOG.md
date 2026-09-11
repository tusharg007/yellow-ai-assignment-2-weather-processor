# AI Log

- Date: 2026-09-11 IST
- Model: GPT-5.6 Terra, High thinking, via Codex, for the production-hardening and accepted-fix pass. No runtime LLM or agent is used by the CLI.

Actual implementation instructions used:

- Parallel/concurrent fetching: "Start all weather requests concurrently. Use the equivalent of `Promise.allSettled(orders.map(processOrder))`. Do NOT await each city sequentially. Preserve the original order ordering in final output."
- Error handling: "Actually request weather for every supplied city, including InvalidCity123. InvalidCity123 failing must NOT prevent valid orders from completing. A failed weather lookup must preserve that order's original status."
- AI-assisted apology function: "Implement the required personalized weather-apology function. It should use only truthful available information such as customer first name, original city, validated weather description/category. Do not invent weather intensity, compensation, arrival dates, or successful weather data after a failed lookup."
- Accepted fixes: "Support delta-seconds and HTTP-date Retry-After using an injected clock; prevent retries at the deadline; distinguish live from injected evidence; keep `.env` inside Assignment 2; and retain apologies in report metadata rather than persisted orders."

Major resulting files: `src/weather-client.js`, `src/process-orders.js`, `src/json-store.js`, `index.js`, `scripts/reset-orders.js`, `scripts/verify-concurrency.js`, `test/a2.test.js`, and the controlled evidence files.

Meaningful corrections: bounded timeout/retry/deadline behavior, including the final strict retry-deadline oversleep correction; structured provenance; atomic writes; self-contained environment location; original persisted order schema preservation; null-timing rejected-task fallback records; documented 429-without-Retry-After deferral; and explicit controlled transport-proof metadata.

Validation run: `node --test test/a2.test.js` (15 passing, 0 failing after final bounded review corrections); controlled local transport proof generated `evidence/concurrency-report.json`; static configured-key scan passed without reading or printing the key.
