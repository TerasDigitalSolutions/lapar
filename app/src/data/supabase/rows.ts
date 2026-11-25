/** snake_case table row -> camelCase object (shallow). Entity-specific mappers are added by M3-B. */
export function camelRow<T>(row: Record<string, unknown>): T {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), v]),
  ) as T;
}
