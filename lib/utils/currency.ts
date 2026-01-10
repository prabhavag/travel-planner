/**
 * Currency formatting utilities
 */

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CNY: "¥",
  KRW: "₩",
  INR: "₹",
  THB: "฿",
  AUD: "A$",
  CAD: "C$",
  CHF: "CHF",
  SGD: "S$",
  HKD: "HK$",
  NZD: "NZ$",
  MXN: "MX$",
  BRL: "R$",
  AED: "AED",
  ZAR: "R",
  SEK: "kr",
  NOK: "kr",
  DKK: "kr",
  PLN: "zł",
  CZK: "Kč",
  HUF: "Ft",
  TRY: "₺",
  ILS: "₪",
  PHP: "₱",
  MYR: "RM",
  IDR: "Rp",
  VND: "₫",
  TWD: "NT$",
};

// Currencies that don't use decimal places
const NO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "VND", "IDR", "HUF"]);

/**
 * Get the currency symbol for a given currency code
 */
export function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency.toUpperCase()] || currency;
}

/**
 * Format a cost with the appropriate currency symbol
 */
export function formatCost(cost: number, currency: string = "USD"): string {
  const symbol = getCurrencySymbol(currency);
  const upperCurrency = currency.toUpperCase();

  if (NO_DECIMAL_CURRENCIES.has(upperCurrency)) {
    return `${symbol}${Math.round(cost).toLocaleString()}`;
  }

  return `${symbol}${cost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/**
 * Get price range string with appropriate currency symbol
 * Used for restaurant price levels (1-4)
 * For multi-character symbols, uses numeric notation (e.g., "CHF 2" instead of "CHFCHF")
 */
export function getPriceRangeSymbol(priceLevel: number | undefined, currency: string = "USD"): string {
  const symbol = getCurrencySymbol(currency);
  const isMultiChar = symbol.length > 1;

  switch (priceLevel) {
    case 0:
      return "Free";
    case 1:
      return isMultiChar ? `${symbol} 1` : symbol;
    case 2:
      return isMultiChar ? `${symbol} 2` : symbol + symbol;
    case 3:
      return isMultiChar ? `${symbol} 3` : symbol + symbol + symbol;
    case 4:
      return isMultiChar ? `${symbol} 4` : symbol + symbol + symbol + symbol;
    default:
      return isMultiChar ? `${symbol} 2` : symbol + symbol;
  }
}
