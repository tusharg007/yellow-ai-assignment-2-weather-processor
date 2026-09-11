const DELAYING_CONDITIONS = new Set(['rain', 'snow', 'extreme']);

export function shouldDelay(weatherMain) {
  return typeof weatherMain === 'string' && DELAYING_CONDITIONS.has(weatherMain.trim().toLowerCase());
}
