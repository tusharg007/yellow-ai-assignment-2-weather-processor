# CONTROLLED TEST DATA / NOT LIVE WEATHER

`build-example.js` imports the production `processOrders` function and substitutes only the weather API transport with fixed Rain, Snow, Extreme, and Clear responses. Its generated `orders.json` is demonstration evidence only; it never reads or writes the authentic live `../../orders.json`.
