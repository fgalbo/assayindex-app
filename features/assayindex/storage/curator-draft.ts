import { ASSAYINDEX_DRAFT_STORAGE_KEY, ASSAYINDEX_IMPORT_NAME_KEY } from "@/features/assayindex/constants";
import type { CuratorDraft } from "@/features/assayindex/domain/types";
import { readStorageJson, removeStorageValue, writeStorageJson } from "@/features/assayindex/storage/browser";

async function getIdbHelpers() {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return null;
  }

  try {
    return await import("idb-keyval");
  } catch {
    return null;
  }
}

export async function loadCuratorDraft() {
  const idb = await getIdbHelpers();

  if (idb) {
    try {
      const draft = await idb.get<CuratorDraft>(ASSAYINDEX_DRAFT_STORAGE_KEY);

      if (draft !== undefined) {
        return draft ?? null;
      }
    } catch {
      // Fall through to localStorage when IndexedDB is blocked or unavailable.
    }
  }

  return readStorageJson<CuratorDraft | null>(ASSAYINDEX_DRAFT_STORAGE_KEY, null);
}

export async function saveCuratorDraft(draft: CuratorDraft) {
  const idb = await getIdbHelpers();

  if (idb) {
    try {
      await idb.set(ASSAYINDEX_DRAFT_STORAGE_KEY, draft);
      removeStorageValue(ASSAYINDEX_DRAFT_STORAGE_KEY);
      return;
    } catch {
      // Persist to localStorage below when IndexedDB rejects the write.
    }
  }

  writeStorageJson(ASSAYINDEX_DRAFT_STORAGE_KEY, draft);
}

export async function clearCuratorDraft() {
  const idb = await getIdbHelpers();

  if (idb) {
    await Promise.allSettled([
      idb.del(ASSAYINDEX_DRAFT_STORAGE_KEY),
      idb.del(ASSAYINDEX_IMPORT_NAME_KEY),
    ]);
  }

  removeStorageValue(ASSAYINDEX_DRAFT_STORAGE_KEY);
  removeStorageValue(ASSAYINDEX_IMPORT_NAME_KEY);
}

export async function saveCuratorImportName(fileName: string | null) {
  const idb = await getIdbHelpers();

  if (idb) {
    try {
      await idb.set(ASSAYINDEX_IMPORT_NAME_KEY, fileName);
      removeStorageValue(ASSAYINDEX_IMPORT_NAME_KEY);
      return;
    } catch {
      // Persist to localStorage below when IndexedDB rejects the write.
    }
  }

  writeStorageJson(ASSAYINDEX_IMPORT_NAME_KEY, fileName);
}

export async function loadCuratorImportName() {
  const idb = await getIdbHelpers();

  if (idb) {
    try {
      const fileName = await idb.get<string | null>(ASSAYINDEX_IMPORT_NAME_KEY);

      if (fileName !== undefined) {
        return fileName ?? null;
      }
    } catch {
      // Fall through to localStorage when IndexedDB is blocked or unavailable.
    }
  }

  return readStorageJson<string | null>(ASSAYINDEX_IMPORT_NAME_KEY, null);
}
