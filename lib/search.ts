export function booleanPrefixSearch(value: string): string {
  return (value.match(/[\p{L}\p{N}]{3,}/gu) ?? [])
    .map((token) => `+${token}*`)
    .join(" ");
}
