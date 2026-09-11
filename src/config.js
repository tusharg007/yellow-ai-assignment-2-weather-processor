export const DEFAULT_TIMEOUT_MS = 8_000;
export const DEFAULT_RUN_DEADLINE_MS = 20_000;

export function loadConfig(env = process.env) {
  const apiKey = env.OPENWEATHER_API_KEY || env.OPENWEATHERMAP_API_KEY;
  if (!apiKey) {
    const error = new Error('OpenWeatherMap API key is missing. Set OPENWEATHER_API_KEY or OPENWEATHERMAP_API_KEY in .env.');
    error.category = 'configuration';
    throw error;
  }
  return {
    apiKey,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    runDeadlineMs: DEFAULT_RUN_DEADLINE_MS,
  };
}
