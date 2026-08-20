export function collectDiffPaths(baseValue: unknown, nextValue: unknown, path = "root"): string[] {
  if (Object.is(baseValue, nextValue)) {
    return [];
  }

  const baseIsArray = Array.isArray(baseValue);
  const nextIsArray = Array.isArray(nextValue);

  if (baseIsArray !== nextIsArray) {
    return [path];
  }

  if (baseIsArray && nextIsArray) {
    const left = baseValue as unknown[];
    const right = nextValue as unknown[];
    const maxLength = Math.max(left.length, right.length);
    const diffs: string[] = [];

    for (let index = 0; index < maxLength; index += 1) {
      diffs.push(...collectDiffPaths(left[index], right[index], `${path}[${index}]`));
    }

    return diffs;
  }

  const baseIsObject = typeof baseValue === "object" && baseValue !== null;
  const nextIsObject = typeof nextValue === "object" && nextValue !== null;

  if (baseIsObject && nextIsObject) {
    const keys = new Set([
      ...Object.keys(baseValue as Record<string, unknown>),
      ...Object.keys(nextValue as Record<string, unknown>),
    ]);
    const diffs: string[] = [];

    for (const key of keys) {
      diffs.push(
        ...collectDiffPaths(
          (baseValue as Record<string, unknown>)[key],
          (nextValue as Record<string, unknown>)[key],
          `${path}.${key}`,
        ),
      );
    }

    return diffs;
  }

  return [path];
}
