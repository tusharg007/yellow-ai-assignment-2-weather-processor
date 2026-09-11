const WEATHER_URL = 'https://api.openweathermap.org/data/2.5/weather';
const CITY_QUERIES = new Map([
  ['New York', 'New York,US'],
  ['Mumbai', 'Mumbai,IN'],
  ['London', 'London,GB'],
]);

export function cityQuery(city) {
  return CITY_QUERIES.get(city) || city;
}

function failure(category, message, status, extra = {}) {
  return { ok: false, error: { category, message, status, ...extra } };
}

export function parseRetryAfterMs(value, nowMs) {
  if (!value) return null;
  if (/^\s*\d+\s*$/.test(value)) return Number(value.trim()) * 1_000;
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - nowMs) : null;
}

async function fetchAttempt(url, { fetchImpl, timeoutMs, now }) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response?.ok) {
      const status = response?.status;
      if (status === 401) return failure('authentication', 'Weather provider rejected the API key.', status);
      if (status === 404) return failure('not_found', 'City was not found by the weather provider.', status);
      if (status === 429) return failure('rate_limited', 'Weather provider rate limit reached.', status, {
        retryAfterMs: parseRetryAfterMs(response.headers?.get?.('retry-after'), now()),
      });
      if (typeof status === 'number' && status >= 500) return failure('server_error', 'Weather provider server error.', status);
      return failure('provider_error', 'Weather provider returned an unsuccessful response.', status);
    }

    let body;
    try {
      body = await response.json();
    } catch {
      return failure('malformed_response', 'Weather provider returned invalid JSON.');
    }
    const primary = body?.weather?.[0];
    if (!Array.isArray(body?.weather) || body.weather.length === 0 || !primary
      || typeof primary.main !== 'string' || !primary.main.trim()) {
      return failure('malformed_response', 'Weather provider response has no valid weather[0].main.');
    }
    return {
      ok: true,
      weather: {
        main: primary.main.trim(),
        description: typeof primary.description === 'string' && primary.description.trim()
          ? primary.description.trim()
          : undefined,
        observed_at: Number.isFinite(body.dt) ? new Date(body.dt * 1_000).toISOString() : undefined,
      },
    };
  } catch (error) {
    if (timedOut || error?.name === 'AbortError') return failure('timeout', 'Weather request timed out.');
    return failure('network', 'Weather request could not reach the provider.');
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchWeather(city, {
  apiKey,
  fetchImpl = fetch,
  timeoutMs = 8_000,
  runDeadlineMs = 20_000,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (!apiKey) return failure('configuration', 'Weather API key is not configured.');

  const url = new URL(WEATHER_URL);
  url.searchParams.set('q', cityQuery(city));
  url.searchParams.set('appid', apiKey);
  url.searchParams.set('units', 'metric');
  url.searchParams.set('lang', 'en');
  const deadline = now() + runDeadlineMs;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
      return failure('timeout', 'Weather retry deferred because the run deadline was reached.', undefined, {
        deferred: true,
        attempts: attempt - 1,
        retryCount: Math.max(0, attempt - 2),
      });
    }
    const result = await fetchAttempt(url, { fetchImpl, timeoutMs: Math.min(timeoutMs, remainingMs), now });
    if (result.ok) return { ...result, attempts: attempt, retryCount: attempt - 1 };

    const retryable = result.error.category === 'timeout'
      || result.error.category === 'network'
      || result.error.category === 'server_error'
      || result.error.category === 'rate_limited';
    if (!retryable || attempt === 2) return { ...result, attempts: attempt, retryCount: attempt - 1 };

    const waitMs = result.error.category === 'rate_limited'
      ? result.error.retryAfterMs
      : 100;
    // Without a usable Retry-After value, provider recovery time is unknowable; defer rather than guess.
    const remainingMsAfterFailure = deadline - now();
    if (remainingMsAfterFailure <= 0 || waitMs === null || waitMs < 0 || waitMs >= remainingMsAfterFailure) {
      return {
        ...result,
        attempts: attempt,
        retryCount: attempt - 1,
        error: { ...result.error, deferred: true, message: 'Weather retry deferred because no remaining run-deadline budget can fit the retry wait.' },
      };
    }
    await sleep(waitMs);
    if (deadline - now() <= 0) {
      return {
        ...result,
        attempts: attempt,
        retryCount: attempt - 1,
        error: { ...result.error, deferred: true, message: 'Weather retry deferred because the run deadline was reached.' },
      };
    }
  }
}
