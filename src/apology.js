export function weatherAwareApology(order, weather) {
  const firstName = order.customer.trim().split(/\s+/)[0];
  const description = typeof weather.description === 'string' && weather.description.trim()
    ? weather.description.trim()
    : weather.main.trim().toLowerCase() === 'extreme'
      ? 'extreme weather'
      : weather.main.trim().toLowerCase();
  return `Hi ${firstName}, your order to ${order.city} is delayed due to ${description}. We appreciate your patience!`;
}
