export function isClinicalCodeLikeQuery(query: string) {
  const trimmedQuery = query.trim();
  const compactLength = [
    ...trimmedQuery.normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, ""),
  ].length;
  if (compactLength === 0) return false;
  if (compactLength <= 4) return true;
  if (!/\s/u.test(trimmedQuery) && /\p{N}/u.test(trimmedQuery)) return true;
  if (/^[A-Z]{2,8}$/u.test(trimmedQuery)) return true;

  const uppercaseCount = trimmedQuery.match(/\p{Lu}/gu)?.length ?? 0;
  if (!/\s/u.test(trimmedQuery) && compactLength <= 12 && uppercaseCount >= 2) return true;

  const codeSegments = trimmedQuery.split(/[-/:]+/u);
  return codeSegments.length > 1
    && codeSegments.every((segment) => /^[a-z0-9]{1,4}$/iu.test(segment));
}
