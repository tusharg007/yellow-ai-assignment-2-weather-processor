# Assignment 2 - Weather-aware order processing

Node.js ESM CLI using OpenWeatherMap current weather. It processes supplied orders concurrently and only delays `Rain`, `Snow`, or `Extreme` from `weather[0].main`.

## Commands

From `assignment-2/`:

```powershell
node --env-file=.env index.js
node --test test/a2.test.js
node scripts/reset-orders.js
```

Set `OPENWEATHERMAP_API_KEY` (or `OPENWEATHER_API_KEY`) in this directory's `.env`; never commit it. `reset-orders.js` explicitly restores `orders.json` from immutable `orders.input.json` and is never run automatically.

Exit codes: `0` means all valid orders completed and only the expected InvalidCity123 404 may have failed; `2` means a valid-city or other unexpected per-order failure caused a degraded run; `1` means configuration, input, or persistence failed.

`orders.json` and `evidence/live-weather-report.json` are live evidence. `examples/controlled-delay/` is explicitly controlled fixture data, not live weather.
