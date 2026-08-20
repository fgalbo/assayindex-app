const memoryStore = new Map<string, string>();

export function canUseLocalStorage() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const key = "__assayindex_storage_probe__";
    window.localStorage.setItem(key, key);
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function readStorageValue(key: string) {
  if (canUseLocalStorage()) {
    return window.localStorage.getItem(key);
  }

  return memoryStore.get(key) ?? null;
}

export function writeStorageValue(key: string, value: string) {
  if (canUseLocalStorage()) {
    window.localStorage.setItem(key, value);
    return;
  }

  memoryStore.set(key, value);
}

export function removeStorageValue(key: string) {
  if (canUseLocalStorage()) {
    window.localStorage.removeItem(key);
    return;
  }

  memoryStore.delete(key);
}

export function readStorageJson<T>(key: string, fallback: T): T {
  const value = readStorageValue(key);

  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function writeStorageJson<T>(key: string, value: T) {
  writeStorageValue(key, JSON.stringify(value));
}
