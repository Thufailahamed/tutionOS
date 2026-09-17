/**
 * Configurable brand/product layer — the product name is never hardcoded
 * through the architecture. Reads from worker vars when available.
 */
export interface Brand {
  name: string;
  tagline: string;
  positioning: string;
}

export const DEFAULT_BRAND: Brand = {
  name: "ClassFlow",
  tagline: "Teach. Manage. Grow.",
  positioning: "The operating system for tuition classes.",
};

export function getBrand(env?: { APP_NAME?: string; BRAND_TAGLINE?: string }): Brand {
  return {
    name: env?.APP_NAME || DEFAULT_BRAND.name,
    tagline: env?.BRAND_TAGLINE || DEFAULT_BRAND.tagline,
    positioning: DEFAULT_BRAND.positioning,
  };
}
