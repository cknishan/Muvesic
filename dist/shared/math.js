/** Clamp a number to the inclusive range; coordinates default to [0, 1]. */
export const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
