/** Join class names, dropping falsey entries. Last writer still wins in CSS. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
