/**
 * Steam Early Access category id. Source: appdetails categories array.
 * https://partner.steamgames.com/doc/store/categories
 */
const EARLY_ACCESS_CATEGORY_ID = 70;

export function isEarlyAccessFromCategories(
  cats: Array<{ id: number }> | undefined,
): boolean {
  return !!cats?.some((c) => c.id === EARLY_ACCESS_CATEGORY_ID);
}
