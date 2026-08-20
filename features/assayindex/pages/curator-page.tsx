"use client";

import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ASSAY_DETAIL_FIELDS } from "@/features/assayindex/constants";
import { AssayDetailView } from "@/features/assayindex/components/assay-detail-view";
import {
  createEmptyAssay,
  createEmptyAssayLevelCode,
  createEmptyLab,
  createEmptyRecord,
  createEmptySourceDocument,
  createEmptySourceLink,
} from "@/features/assayindex/curator/defaults";
import { collectDiffPaths } from "@/features/assayindex/curator/diff";
import {
  parseImportedCatalogText,
} from "@/features/assayindex/curator/import";
import { publishedCatalog } from "@/features/assayindex/data/published/catalog";
import type {
  Assay,
  AssayIndexCatalog,
  AssayLabRecord,
  AssayLevelCode,
  CatalogSelection,
  Lab,
  SourceDocument,
  SourceLink,
  ValidationIssue,
} from "@/features/assayindex/domain/types";
import { downloadCatalogJson } from "@/features/assayindex/export/json";
import { getAssayReport } from "@/features/assayindex/selectors/catalog";
import { mapValidationIssues, validateCatalog } from "@/features/assayindex/schema/catalog";
import {
  clearCuratorDraft,
  loadCuratorDraft,
  loadCuratorImportName,
  saveCuratorDraft,
  saveCuratorImportName,
} from "@/features/assayindex/storage/curator-draft";
import { resetAssayIndexLocalData } from "@/features/assayindex/storage/saved-state";

import { AssayIndexShell } from "@/features/assayindex/components/assayindex-shell";

type CuratorPageProps = {
  catalog: AssayIndexCatalog;
};

type SelectionType = CatalogSelection["type"];

type SelectOption = {
  id: string;
  label: string;
};

const selectionTypes: SelectionType[] = ["assay", "record", "lab", "source", "code"];
const sourceTypeOptions: SourceLink["sourceType"][] = [
  "test-page",
  "test-guide",
  "faq",
  "overview",
  "pdf",
  "brochure",
  "reference",
  "other",
];
const recordCategoryOptions: AssayLabRecord["category"][] = [
  "standard",
  "with-reflex",
  "resistance",
  "quantification",
  "panel",
  "reference",
  "faq",
  "other",
];
const codeCategoryOptions: AssayLevelCode["category"][] = [
  "CPT",
  "ICD10",
  "LOINC",
  "OTHER",
];
const publicationStatusOptions: Assay["status"][] = ["draft", "published"];

function cloneCatalog<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function splitListInput(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinListInput(values: string[]) {
  return values.join(", ");
}

function formatValidationIssues(catalog: AssayIndexCatalog): ValidationIssue[] {
  const result = validateCatalog(catalog);

  if (result.success) {
    return [];
  }

  return mapValidationIssues(result.error);
}

function getSelectionOptions(catalog: AssayIndexCatalog, type: SelectionType): SelectOption[] {
  switch (type) {
    case "assay":
      return catalog.assays.map((assay) => ({ id: assay.slug, label: assay.displayName }));
    case "record":
      return catalog.assayLabRecords.map((record) => ({
        id: record.id,
        label: `${record.recordTitle} (${record.labId})`,
      }));
    case "lab":
      return catalog.labs.map((lab) => ({ id: lab.id, label: lab.displayName }));
    case "source":
      return catalog.sourceDocuments.map((source) => ({ id: source.id, label: source.label }));
    case "code":
      return catalog.assayLevelCodes.map((code) => ({
        id: code.id,
        label: `${code.code} (${code.assaySlug})`,
      }));
    default:
      return [];
  }
}

function getPreviewAssaySlug(catalog: AssayIndexCatalog, selection: CatalogSelection) {
  if (selection.type === "assay") {
    return selection.id;
  }

  if (selection.type === "record") {
    return catalog.assayLabRecords.find((record) => record.id === selection.id)?.assaySlug ?? null;
  }

  if (selection.type === "source") {
    return catalog.sourceDocuments.find((source) => source.id === selection.id)?.assaySlug ?? null;
  }

  if (selection.type === "code") {
    return catalog.assayLevelCodes.find((code) => code.id === selection.id)?.assaySlug ?? null;
  }

  if (selection.type === "lab") {
    return catalog.assayLabRecords.find((record) => record.labId === selection.id)?.assaySlug ?? null;
  }

  return null;
}

function shouldUseTextarea(fieldKey: string) {
  return [
    "summary",
    "purpose",
    "notes",
    "reflexLogic",
    "limitations",
    "interferences",
    "collectionInstructions",
    "patientPreparation",
    "rejectionCriteria",
    "useOrClinicalSignificance",
    "handling",
    "storage",
    "stability",
    "includes",
  ].includes(fieldKey);
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="space-y-2 text-sm text-[#153042]">
      <span className="font-semibold">{label}</span>
      {children}
    </label>
  );
}

function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`assayindex-focus-ring w-full rounded-2xl border border-[#cad7de] px-4 py-3 text-sm text-[#153042] ${
        props.className ?? ""
      }`}
    />
  );
}

function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`assayindex-focus-ring min-h-28 w-full rounded-2xl border border-[#cad7de] px-4 py-3 text-sm leading-7 text-[#153042] ${
        props.className ?? ""
      }`}
    />
  );
}

function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`assayindex-focus-ring w-full rounded-2xl border border-[#cad7de] px-4 py-3 text-sm text-[#153042] ${
        props.className ?? ""
      }`}
    />
  );
}

export function CuratorPage({ catalog }: CuratorPageProps) {
  const [draftCatalog, setDraftCatalog] = useState<AssayIndexCatalog>(catalog);
  const [selection, setSelection] = useState<CatalogSelection>({
    type: "assay",
    id: catalog.assays[0]?.slug ?? "",
  });
  const [sourceName, setSourceName] = useState<string | null>("published-catalog.json");
  const [importIssues, setImportIssues] = useState<ValidationIssue[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let isMounted = true;

    void (async () => {
      const [savedDraft, savedName] = await Promise.all([
        loadCuratorDraft(),
        loadCuratorImportName(),
      ]);

      if (!isMounted) {
        return;
      }

      if (savedDraft?.catalog) {
        setDraftCatalog(savedDraft.catalog);
        setImportIssues(savedDraft.issues);
      }

      if (savedName) {
        setSourceName(savedName);
      }

      setIsLoaded(true);
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  const selectionOptions = useMemo(
    () => getSelectionOptions(draftCatalog, selection.type),
    [draftCatalog, selection.type],
  );
  const validationIssues = useMemo(() => formatValidationIssues(draftCatalog), [draftCatalog]);
  const diffPaths = useMemo(
    () => collectDiffPaths(publishedCatalog, draftCatalog),
    [draftCatalog],
  );
  const previewAssaySlug = useMemo(
    () =>
      getPreviewAssaySlug(draftCatalog, {
        ...selection,
        id:
          selectionOptions.find((option) => option.id === selection.id)?.id ??
          selectionOptions[0]?.id ??
          "",
      }),
    [draftCatalog, selection, selectionOptions],
  );
  const previewReport = useMemo(
    () => (previewAssaySlug ? getAssayReport(draftCatalog, previewAssaySlug) : null),
    [draftCatalog, previewAssaySlug],
  );

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    const timer = window.setTimeout(() => {
      void saveCuratorDraft({
        catalog: draftCatalog,
        updatedAt: new Date().toISOString(),
        sourceName,
        issues: [...importIssues, ...validationIssues],
      });
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [draftCatalog, importIssues, isLoaded, sourceName, validationIssues]);

  const updateCatalog = (updater: (value: AssayIndexCatalog) => AssayIndexCatalog) => {
    setDraftCatalog((current) => updater(cloneCatalog(current)));
    setImportIssues([]);
  };

  const selectionId =
    selectionOptions.find((option) => option.id === selection.id)?.id ??
    selectionOptions[0]?.id ??
    "";

  const selectedAssay = draftCatalog.assays.find((assay) => assay.slug === selectionId) ?? null;
  const selectedLab = draftCatalog.labs.find((lab) => lab.id === selectionId) ?? null;
  const selectedRecord =
    draftCatalog.assayLabRecords.find((record) => record.id === selectionId) ?? null;
  const selectedSource =
    draftCatalog.sourceDocuments.find((source) => source.id === selectionId) ?? null;
  const selectedCode =
    draftCatalog.assayLevelCodes.find((code) => code.id === selectionId) ?? null;

  const updateAssayField = <K extends keyof Assay>(key: K, value: Assay[K]) => {
    if (!selectedAssay) {
      return;
    }

    updateCatalog((nextCatalog) => {
      nextCatalog.assays = nextCatalog.assays.map((assay) =>
        assay.slug === selectedAssay.slug ? { ...assay, [key]: value } : assay,
      );
      return nextCatalog;
    });
  };

  const updateLabField = <K extends keyof Lab>(key: K, value: Lab[K]) => {
    if (!selectedLab) {
      return;
    }

    updateCatalog((nextCatalog) => {
      nextCatalog.labs = nextCatalog.labs.map((lab) =>
        lab.id === selectedLab.id ? { ...lab, [key]: value } : lab,
      );
      return nextCatalog;
    });
  };

  const updateSourceField = <K extends keyof SourceDocument>(key: K, value: SourceDocument[K]) => {
    if (!selectedSource) {
      return;
    }

    updateCatalog((nextCatalog) => {
      nextCatalog.sourceDocuments = nextCatalog.sourceDocuments.map((source) =>
        source.id === selectedSource.id ? { ...source, [key]: value } : source,
      );
      return nextCatalog;
    });
  };

  const updateCodeField = <K extends keyof AssayLevelCode>(key: K, value: AssayLevelCode[K]) => {
    if (!selectedCode) {
      return;
    }

    updateCatalog((nextCatalog) => {
      nextCatalog.assayLevelCodes = nextCatalog.assayLevelCodes.map((code) =>
        code.id === selectedCode.id ? { ...code, [key]: value } : code,
      );
      return nextCatalog;
    });
  };

  const updateRecordField = <K extends keyof AssayLabRecord>(
    key: K,
    value: AssayLabRecord[K],
  ) => {
    if (!selectedRecord) {
      return;
    }

    updateCatalog((nextCatalog) => {
      nextCatalog.assayLabRecords = nextCatalog.assayLabRecords.map((record) =>
        record.id === selectedRecord.id ? { ...record, [key]: value } : record,
      );
      return nextCatalog;
    });
  };

  const addEntity = () => {
    updateCatalog((nextCatalog) => {
      switch (selection.type) {
        case "assay": {
          const entity = createEmptyAssay();
          nextCatalog.assays.push(entity);
          setSelection({ type: "assay", id: entity.slug });
          break;
        }
        case "record": {
          const entity = createEmptyRecord(
            nextCatalog.assays[0]?.slug ?? "new-assay",
            nextCatalog.labs[0]?.id ?? "new-lab",
          );
          nextCatalog.assayLabRecords.push(entity);
          setSelection({ type: "record", id: entity.id });
          break;
        }
        case "lab": {
          const entity = createEmptyLab();
          nextCatalog.labs.push(entity);
          setSelection({ type: "lab", id: entity.id });
          break;
        }
        case "source": {
          const entity = createEmptySourceDocument(
            nextCatalog.assays[0]?.slug ?? "new-assay",
            nextCatalog.labs[0]?.id ?? "new-lab",
          );
          nextCatalog.sourceDocuments.push(entity);
          setSelection({ type: "source", id: entity.id });
          break;
        }
        case "code": {
          const entity = createEmptyAssayLevelCode(
            nextCatalog.assays[0]?.slug ?? "new-assay",
          );
          nextCatalog.assayLevelCodes.push(entity);
          setSelection({ type: "code", id: entity.id });
          break;
        }
      }

      return nextCatalog;
    });
  };

  const removeSelectedEntity = () => {
    updateCatalog((nextCatalog) => {
      switch (selection.type) {
        case "assay":
          nextCatalog.assays = nextCatalog.assays.filter((assay) => assay.slug !== selectionId);
          nextCatalog.assayLabRecords = nextCatalog.assayLabRecords.filter(
            (record) => record.assaySlug !== selectionId,
          );
          nextCatalog.sourceDocuments = nextCatalog.sourceDocuments.filter(
            (source) => source.assaySlug !== selectionId,
          );
          nextCatalog.assayLevelCodes = nextCatalog.assayLevelCodes.filter(
            (code) => code.assaySlug !== selectionId,
          );
          break;
        case "record":
          nextCatalog.assayLabRecords = nextCatalog.assayLabRecords.filter(
            (record) => record.id !== selectionId,
          );
          nextCatalog.sourceDocuments = nextCatalog.sourceDocuments.map((source) => ({
            ...source,
            relatedRecordIds: source.relatedRecordIds.filter((id) => id !== selectionId),
          }));
          break;
        case "lab":
          nextCatalog.labs = nextCatalog.labs.filter((lab) => lab.id !== selectionId);
          nextCatalog.assayLabRecords = nextCatalog.assayLabRecords.filter(
            (record) => record.labId !== selectionId,
          );
          nextCatalog.sourceDocuments = nextCatalog.sourceDocuments.filter(
            (source) => source.labId !== selectionId,
          );
          break;
        case "source":
          nextCatalog.sourceDocuments = nextCatalog.sourceDocuments.filter(
            (source) => source.id !== selectionId,
          );
          break;
        case "code":
          nextCatalog.assayLevelCodes = nextCatalog.assayLevelCodes.filter(
            (code) => code.id !== selectionId,
          );
          break;
      }

      return nextCatalog;
    });
  };

  return (
    <AssayIndexShell
      title="Local curator mode"
      description="Import, validate, edit, preview, diff, and export structured assay catalog data entirely in the browser. This is local authoring only, not a secure admin panel."
      eyebrow="AssayIndex / Local curator mode"
    >
      <section className="assayindex-panel p-5 md:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="assayindex-kicker">Draft controls</p>
            <p className="mt-2 max-w-4xl text-sm leading-7 text-[#526978]">
              Published catalog content is repo-backed. Drafts persist locally in the browser so a
              curator can validate and review changes without any server-side admin infrastructure.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="assayindex-nav-link assayindex-focus-ring"
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              Import JSON
            </button>
            <button
              className="assayindex-nav-link assayindex-focus-ring"
              type="button"
              onClick={() =>
                downloadCatalogJson(draftCatalog, sourceName ?? "assayindex-catalog.json")
              }
            >
              Export JSON
            </button>
            <button
              className="assayindex-nav-link assayindex-focus-ring"
              type="button"
              onClick={() => {
                setDraftCatalog(cloneCatalog(publishedCatalog));
                setSourceName("published-catalog.json");
                setImportIssues([]);
              }}
            >
              Reset to published
            </button>
            <button
              className="assayindex-nav-link assayindex-focus-ring"
              type="button"
              onClick={() => {
                void clearCuratorDraft();
                setDraftCatalog(cloneCatalog(publishedCatalog));
                setSourceName("published-catalog.json");
                setImportIssues([]);
              }}
            >
              Clear local draft
            </button>
            <button
              className="assayindex-nav-link assayindex-focus-ring"
              type="button"
              onClick={() => {
                void resetAssayIndexLocalData();
              }}
            >
              Reset all local data
            </button>
          </div>
        </div>

        <input
          ref={fileInputRef}
          accept="application/json"
          className="hidden"
          type="file"
          onChange={(event) => {
            const file = event.target.files?.[0];

            if (!file) {
              return;
            }

            void file
              .text()
              .then(async (rawText) => {
                const parsed = parseImportedCatalogText(rawText);

                if (parsed.catalog) {
                  setDraftCatalog(parsed.catalog);
                  setImportIssues([]);
                  setSourceName(file.name);
                  await saveCuratorImportName(file.name);
                } else {
                  setImportIssues(parsed.issues);
                }
              })
              .catch((error: unknown) => {
                setImportIssues([
                  {
                    path: "catalog",
                    message: `Unable to read ${file.name}. ${
                      error instanceof Error ? error.message : "The browser rejected the file read."
                    }`,
                    code: "file_read_error",
                  },
                ]);
              });
          }}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[280px_minmax(0,1.14fr)_minmax(360px,0.86fr)]">
        <aside className="assayindex-panel p-5 md:p-6">
          <p className="assayindex-kicker">Entity browser</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {selectionTypes.map((type) => (
              <button
                key={type}
                className={`assayindex-nav-link assayindex-focus-ring ${
                  selection.type === type ? "bg-[#dcecf2] text-[#113244]" : ""
                }`}
                type="button"
                onClick={() => {
                  const nextOptions = getSelectionOptions(draftCatalog, type);
                  setSelection({ type, id: nextOptions[0]?.id ?? "" });
                }}
              >
                {type}
              </button>
            ))}
          </div>

          <div className="mt-5 space-y-3">
            <SelectInput
              value={selectionId}
              onChange={(event) =>
                setSelection((current) => ({ ...current, id: event.target.value }))
              }
            >
              {selectionOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </SelectInput>

            <div className="flex flex-wrap gap-2">
              <button
                className="assayindex-nav-link assayindex-focus-ring"
                type="button"
                onClick={addEntity}
              >
                Add {selection.type}
              </button>
              <button
                className="assayindex-nav-link assayindex-focus-ring"
                type="button"
                onClick={removeSelectedEntity}
              >
                Remove selected
              </button>
            </div>
          </div>

          <div className="mt-6 rounded-2xl bg-[#f6fafb] p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-[#5b7281]">Draft source</p>
            <p className="mt-2 text-sm text-[#102435]">{sourceName ?? "Unnamed draft"}</p>
          </div>
        </aside>

        <section className="assayindex-panel p-5 md:p-6">
          <p className="assayindex-kicker">Structured editor</p>
          <p className="mt-2 text-sm leading-7 text-[#526978]">
            Missing values should stay null. Source links and ICD-10 associations are editable as
            separate structured lists instead of being flattened into free text.
          </p>

          <div className="mt-6 space-y-5">
            {selectedAssay ? (
              <>
                <Field label="Slug">
                  <TextInput
                    value={selectedAssay.slug}
                    onChange={(event) => {
                      const nextSlug = event.target.value;
                      updateCatalog((nextCatalog) => {
                        nextCatalog.assays = nextCatalog.assays.map((assay) =>
                          assay.slug === selectedAssay.slug ? { ...assay, slug: nextSlug } : assay,
                        );
                        nextCatalog.assayLabRecords = nextCatalog.assayLabRecords.map((record) =>
                          record.assaySlug === selectedAssay.slug
                            ? { ...record, assaySlug: nextSlug }
                            : record,
                        );
                        nextCatalog.sourceDocuments = nextCatalog.sourceDocuments.map((source) =>
                          source.assaySlug === selectedAssay.slug
                            ? { ...source, assaySlug: nextSlug }
                            : source,
                        );
                        nextCatalog.assayLevelCodes = nextCatalog.assayLevelCodes.map((code) =>
                          code.assaySlug === selectedAssay.slug
                            ? { ...code, assaySlug: nextSlug }
                            : code,
                        );
                        setSelection({ type: "assay", id: nextSlug });
                        return nextCatalog;
                      });
                    }}
                  />
                </Field>
                <Field label="Display name">
                  <TextInput
                    value={selectedAssay.displayName}
                    onChange={(event) => updateAssayField("displayName", event.target.value)}
                  />
                </Field>
                <Field label="Summary">
                  <TextArea
                    value={selectedAssay.summary}
                    onChange={(event) => updateAssayField("summary", event.target.value)}
                  />
                </Field>
                <Field label="Clinical purpose">
                  <TextArea
                    value={selectedAssay.purpose}
                    onChange={(event) => updateAssayField("purpose", event.target.value)}
                  />
                </Field>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Specialty tags">
                    <TextInput
                      value={joinListInput(selectedAssay.specialty)}
                      onChange={(event) =>
                        updateAssayField("specialty", splitListInput(event.target.value))
                      }
                    />
                  </Field>
                  <Field label="Status">
                    <SelectInput
                      value={selectedAssay.status}
                      onChange={(event) =>
                        updateAssayField("status", event.target.value as Assay["status"])
                      }
                    >
                      {publicationStatusOptions.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </SelectInput>
                  </Field>
                </div>
                <Field label="Synonyms">
                  <TextInput
                    value={joinListInput(selectedAssay.synonyms)}
                    onChange={(event) =>
                      updateAssayField("synonyms", splitListInput(event.target.value))
                    }
                  />
                </Field>
                <Field label="Keywords">
                  <TextInput
                    value={joinListInput(selectedAssay.keywords)}
                    onChange={(event) =>
                      updateAssayField("keywords", splitListInput(event.target.value))
                    }
                  />
                </Field>
              </>
            ) : null}

            {selectedLab ? (
              <>
                <Field label="Lab ID">
                  <TextInput
                    value={selectedLab.id}
                    onChange={(event) => {
                      const nextId = event.target.value;
                      updateCatalog((nextCatalog) => {
                        nextCatalog.labs = nextCatalog.labs.map((lab) =>
                          lab.id === selectedLab.id ? { ...lab, id: nextId } : lab,
                        );
                        nextCatalog.assayLabRecords = nextCatalog.assayLabRecords.map((record) =>
                          record.labId === selectedLab.id ? { ...record, labId: nextId } : record,
                        );
                        nextCatalog.sourceDocuments = nextCatalog.sourceDocuments.map((source) =>
                          source.labId === selectedLab.id ? { ...source, labId: nextId } : source,
                        );
                        setSelection({ type: "lab", id: nextId });
                        return nextCatalog;
                      });
                    }}
                  />
                </Field>
                <Field label="Display name">
                  <TextInput
                    value={selectedLab.displayName}
                    onChange={(event) => updateLabField("displayName", event.target.value)}
                  />
                </Field>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Short name">
                    <TextInput
                      value={selectedLab.shortName}
                      onChange={(event) => updateLabField("shortName", event.target.value)}
                    />
                  </Field>
                  <Field label="Website">
                    <TextInput
                      value={selectedLab.website ?? ""}
                      onChange={(event) => updateLabField("website", event.target.value || null)}
                    />
                  </Field>
                </div>
                <Field label="Notes">
                  <TextArea
                    value={selectedLab.notes ?? ""}
                    onChange={(event) => updateLabField("notes", event.target.value || null)}
                  />
                </Field>
              </>
            ) : null}

            {selectedCode ? (
              <>
                <Field label="Code ID">
                  <TextInput
                    value={selectedCode.id}
                    onChange={(event) => {
                      const nextId = event.target.value;
                      updateCatalog((nextCatalog) => {
                        nextCatalog.assayLevelCodes = nextCatalog.assayLevelCodes.map((code) =>
                          code.id === selectedCode.id ? { ...code, id: nextId } : code,
                        );
                        setSelection({ type: "code", id: nextId });
                        return nextCatalog;
                      });
                    }}
                  />
                </Field>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Assay slug">
                    <SelectInput
                      value={selectedCode.assaySlug}
                      onChange={(event) => updateCodeField("assaySlug", event.target.value)}
                    >
                      {draftCatalog.assays.map((assay) => (
                        <option key={assay.slug} value={assay.slug}>
                          {assay.displayName}
                        </option>
                      ))}
                    </SelectInput>
                  </Field>
                  <Field label="Category">
                    <SelectInput
                      value={selectedCode.category}
                      onChange={(event) =>
                        updateCodeField(
                          "category",
                          event.target.value as AssayLevelCode["category"],
                        )
                      }
                    >
                      {codeCategoryOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </SelectInput>
                  </Field>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Code">
                    <TextInput
                      value={selectedCode.code}
                      onChange={(event) => updateCodeField("code", event.target.value)}
                    />
                  </Field>
                  <Field label="Scope">
                    <SelectInput
                      value={selectedCode.scope}
                      onChange={(event) =>
                        updateCodeField("scope", event.target.value as AssayLevelCode["scope"])
                      }
                    >
                      <option value="assay-level">assay-level</option>
                      <option value="lab-specific">lab-specific</option>
                    </SelectInput>
                  </Field>
                </div>
                <Field label="Description">
                  <TextArea
                    value={selectedCode.description}
                    onChange={(event) => updateCodeField("description", event.target.value)}
                  />
                </Field>
                <Field label="Note">
                  <TextArea
                    value={selectedCode.note ?? ""}
                    onChange={(event) => updateCodeField("note", event.target.value || null)}
                  />
                </Field>
              </>
            ) : null}

            {selectedSource ? (
              <>
                <Field label="Source ID">
                  <TextInput
                    value={selectedSource.id}
                    onChange={(event) => {
                      const nextId = event.target.value;
                      updateCatalog((nextCatalog) => {
                        nextCatalog.sourceDocuments = nextCatalog.sourceDocuments.map((source) =>
                          source.id === selectedSource.id ? { ...source, id: nextId } : source,
                        );
                        setSelection({ type: "source", id: nextId });
                        return nextCatalog;
                      });
                    }}
                  />
                </Field>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Assay slug">
                    <SelectInput
                      value={selectedSource.assaySlug}
                      onChange={(event) => updateSourceField("assaySlug", event.target.value)}
                    >
                      {draftCatalog.assays.map((assay) => (
                        <option key={assay.slug} value={assay.slug}>
                          {assay.displayName}
                        </option>
                      ))}
                    </SelectInput>
                  </Field>
                  <Field label="Lab ID">
                    <SelectInput
                      value={selectedSource.labId}
                      onChange={(event) => updateSourceField("labId", event.target.value)}
                    >
                      {draftCatalog.labs.map((lab) => (
                        <option key={lab.id} value={lab.id}>
                          {lab.displayName}
                        </option>
                      ))}
                    </SelectInput>
                  </Field>
                </div>
                <Field label="Label">
                  <TextInput
                    value={selectedSource.label}
                    onChange={(event) => updateSourceField("label", event.target.value)}
                  />
                </Field>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="URL">
                    <TextInput
                      value={selectedSource.url}
                      onChange={(event) => updateSourceField("url", event.target.value)}
                    />
                  </Field>
                  <Field label="Source type">
                    <SelectInput
                      value={selectedSource.sourceType}
                      onChange={(event) =>
                        updateSourceField(
                          "sourceType",
                          event.target.value as SourceDocument["sourceType"],
                        )
                      }
                    >
                      {sourceTypeOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </SelectInput>
                  </Field>
                </div>
                <Field label="Related record IDs">
                  <TextInput
                    value={joinListInput(selectedSource.relatedRecordIds)}
                    onChange={(event) =>
                      updateSourceField("relatedRecordIds", splitListInput(event.target.value))
                    }
                  />
                </Field>
                <Field label="Note">
                  <TextArea
                    value={selectedSource.note ?? ""}
                    onChange={(event) => updateSourceField("note", event.target.value || null)}
                  />
                </Field>
              </>
            ) : null}
            {selectedRecord ? (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Record ID">
                    <TextInput
                      value={selectedRecord.id}
                      onChange={(event) => {
                        const nextId = event.target.value;
                        updateCatalog((nextCatalog) => {
                          nextCatalog.assayLabRecords = nextCatalog.assayLabRecords.map((record) =>
                            record.id === selectedRecord.id ? { ...record, id: nextId } : record,
                          );
                          nextCatalog.sourceDocuments = nextCatalog.sourceDocuments.map((source) =>
                            source.relatedRecordIds.includes(selectedRecord.id)
                              ? {
                                  ...source,
                                  relatedRecordIds: source.relatedRecordIds.map((id) =>
                                    id === selectedRecord.id ? nextId : id,
                                  ),
                                }
                              : source,
                          );
                          setSelection({ type: "record", id: nextId });
                          return nextCatalog;
                        });
                      }}
                    />
                  </Field>
                  <Field label="Category">
                    <SelectInput
                      value={selectedRecord.category}
                      onChange={(event) =>
                        updateRecordField(
                          "category",
                          event.target.value as AssayLabRecord["category"],
                        )
                      }
                    >
                      {recordCategoryOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </SelectInput>
                  </Field>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Assay slug">
                    <SelectInput
                      value={selectedRecord.assaySlug}
                      onChange={(event) => updateRecordField("assaySlug", event.target.value)}
                    >
                      {draftCatalog.assays.map((assay) => (
                        <option key={assay.slug} value={assay.slug}>
                          {assay.displayName}
                        </option>
                      ))}
                    </SelectInput>
                  </Field>
                  <Field label="Lab ID">
                    <SelectInput
                      value={selectedRecord.labId}
                      onChange={(event) => updateRecordField("labId", event.target.value)}
                    >
                      {draftCatalog.labs.map((lab) => (
                        <option key={lab.id} value={lab.id}>
                          {lab.displayName}
                        </option>
                      ))}
                    </SelectInput>
                  </Field>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Display order">
                    <TextInput
                      type="number"
                      value={selectedRecord.displayOrder}
                      onChange={(event) =>
                        updateRecordField(
                          "displayOrder",
                          Number(event.target.value || "0"),
                        )
                      }
                    />
                  </Field>
                  <Field label="Publication status">
                    <SelectInput
                      value={selectedRecord.publicationStatus}
                      onChange={(event) =>
                        updateRecordField(
                          "publicationStatus",
                          event.target.value as AssayLabRecord["publicationStatus"],
                        )
                      }
                    >
                      {publicationStatusOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </SelectInput>
                  </Field>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Synonyms">
                    <TextInput
                      value={joinListInput(selectedRecord.synonyms)}
                      onChange={(event) =>
                        updateRecordField("synonyms", splitListInput(event.target.value))
                      }
                    />
                  </Field>
                  <Field label="CPT codes">
                    <TextInput
                      value={joinListInput(selectedRecord.cptCodes)}
                      onChange={(event) =>
                        updateRecordField("cptCodes", splitListInput(event.target.value))
                      }
                    />
                  </Field>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="LOINC codes">
                    <TextInput
                      value={joinListInput(selectedRecord.loincCodes)}
                      onChange={(event) =>
                        updateRecordField("loincCodes", splitListInput(event.target.value))
                      }
                    />
                  </Field>
                  <Field label="Source verified at">
                    <TextInput
                      value={selectedRecord.sourceVerifiedAt ?? ""}
                      onChange={(event) =>
                        updateRecordField("sourceVerifiedAt", event.target.value || null)
                      }
                    />
                  </Field>
                </div>

                {ASSAY_DETAIL_FIELDS.map(([fieldKey, label]) => {
                  const value = selectedRecord[fieldKey as keyof AssayLabRecord];
                  const isLongText = shouldUseTextarea(fieldKey);

                  return (
                    <Field key={fieldKey} label={label}>
                      {isLongText ? (
                        <TextArea
                          value={typeof value === "string" ? value : ""}
                          onChange={(event) =>
                            updateRecordField(
                              fieldKey as keyof AssayLabRecord,
                              (event.target.value || null) as AssayLabRecord[keyof AssayLabRecord],
                            )
                          }
                        />
                      ) : (
                        <TextInput
                          value={typeof value === "string" ? value : ""}
                          onChange={(event) =>
                            updateRecordField(
                              fieldKey as keyof AssayLabRecord,
                              (event.target.value || null) as AssayLabRecord[keyof AssayLabRecord],
                            )
                          }
                        />
                      )}
                    </Field>
                  );
                })}

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-[#153042]">Associated ICD-10 entries</p>
                    <button
                      className="assayindex-nav-link assayindex-focus-ring"
                      type="button"
                      onClick={() =>
                        updateRecordField("associatedIcd10", [
                          ...selectedRecord.associatedIcd10,
                          {
                            code: "",
                            description: "",
                            category: "ICD10",
                            scope: "lab-specific",
                            note: null,
                          },
                        ])
                      }
                    >
                      Add ICD-10 entry
                    </button>
                  </div>

                  {selectedRecord.associatedIcd10.map((entry, index) => (
                    <div
                      key={`${selectedRecord.id}-icd10-${index}`}
                      className="grid gap-3 rounded-2xl border border-[#d9e3e8] p-4"
                    >
                      <div className="grid gap-3 md:grid-cols-2">
                        <Field label="Code">
                          <TextInput
                            value={entry.code}
                            onChange={(event) =>
                              updateRecordField(
                                "associatedIcd10",
                                selectedRecord.associatedIcd10.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? { ...item, code: event.target.value }
                                    : item,
                                ),
                              )
                            }
                          />
                        </Field>
                        <Field label="Description">
                          <TextInput
                            value={entry.description}
                            onChange={(event) =>
                              updateRecordField(
                                "associatedIcd10",
                                selectedRecord.associatedIcd10.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? { ...item, description: event.target.value }
                                    : item,
                                ),
                              )
                            }
                          />
                        </Field>
                      </div>
                      <Field label="Note">
                        <TextInput
                          value={entry.note ?? ""}
                          onChange={(event) =>
                            updateRecordField(
                              "associatedIcd10",
                              selectedRecord.associatedIcd10.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, note: event.target.value || null }
                                  : item,
                              ),
                            )
                          }
                        />
                      </Field>
                      <button
                        className="assayindex-nav-link assayindex-focus-ring justify-self-start"
                        type="button"
                        onClick={() =>
                          updateRecordField(
                            "associatedIcd10",
                            selectedRecord.associatedIcd10.filter(
                              (_, itemIndex) => itemIndex !== index,
                            ),
                          )
                        }
                      >
                        Remove ICD-10 entry
                      </button>
                    </div>
                  ))}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-[#153042]">Source links</p>
                    <button
                      className="assayindex-nav-link assayindex-focus-ring"
                      type="button"
                      onClick={() =>
                        updateRecordField("sourceLinks", [
                          ...selectedRecord.sourceLinks,
                          createEmptySourceLink(),
                        ])
                      }
                    >
                      Add source link
                    </button>
                  </div>

                  {selectedRecord.sourceLinks.map((link, index) => (
                    <div
                      key={`${selectedRecord.id}-source-${index}`}
                      className="grid gap-3 rounded-2xl border border-[#d9e3e8] p-4"
                    >
                      <div className="grid gap-3 md:grid-cols-2">
                        <Field label="Label">
                          <TextInput
                            value={link.label}
                            onChange={(event) =>
                              updateRecordField(
                                "sourceLinks",
                                selectedRecord.sourceLinks.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? { ...item, label: event.target.value }
                                    : item,
                                ),
                              )
                            }
                          />
                        </Field>
                        <Field label="URL">
                          <TextInput
                            value={link.url}
                            onChange={(event) =>
                              updateRecordField(
                                "sourceLinks",
                                selectedRecord.sourceLinks.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? { ...item, url: event.target.value }
                                    : item,
                                ),
                              )
                            }
                          />
                        </Field>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <Field label="Source type">
                          <SelectInput
                            value={link.sourceType}
                            onChange={(event) =>
                              updateRecordField(
                                "sourceLinks",
                                selectedRecord.sourceLinks.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? {
                                        ...item,
                                        sourceType: event.target.value as SourceLink["sourceType"],
                                      }
                                    : item,
                                ),
                              )
                            }
                          >
                            {sourceTypeOptions.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </SelectInput>
                        </Field>
                        <Field label="Note">
                          <TextInput
                            value={link.note ?? ""}
                            onChange={(event) =>
                              updateRecordField(
                                "sourceLinks",
                                selectedRecord.sourceLinks.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? { ...item, note: event.target.value || null }
                                    : item,
                                ),
                              )
                            }
                          />
                        </Field>
                      </div>
                      <button
                        className="assayindex-nav-link assayindex-focus-ring justify-self-start"
                        type="button"
                        onClick={() =>
                          updateRecordField(
                            "sourceLinks",
                            selectedRecord.sourceLinks.filter((_, itemIndex) => itemIndex !== index),
                          )
                        }
                      >
                        Remove source link
                      </button>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </section>

        <aside className="space-y-6">
          <section className="assayindex-panel p-5 md:p-6">
            <p className="assayindex-kicker">Validation summary</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-[#d9e3e8] p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-[#5b7281]">Validation issues</p>
                <p className="mt-2 text-2xl font-semibold text-[#102435]">
                  {importIssues.length + validationIssues.length}
                </p>
              </div>
              <div className="rounded-2xl border border-[#d9e3e8] p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-[#5b7281]">Diff paths</p>
                <p className="mt-2 text-2xl font-semibold text-[#102435]">{diffPaths.length}</p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {[...importIssues, ...validationIssues].slice(0, 12).map((issue, index) => (
                <article
                  key={`${issue.path}-${index}`}
                  className="rounded-2xl border border-[#d9e3e8] p-4"
                >
                  <p className="text-xs uppercase tracking-[0.16em] text-[#5b7281]">{issue.path}</p>
                  <p className="mt-2 text-sm font-semibold text-[#102435]">{issue.message}</p>
                  <p className="mt-1 text-xs text-[#617886]">{issue.code}</p>
                </article>
              ))}
              {importIssues.length + validationIssues.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-[#cad8df] p-4 text-sm leading-7 text-[#5b7281]">
                  Current draft validates against the published schema.
                </p>
              ) : null}
            </div>
          </section>

          <section className="assayindex-panel p-5 md:p-6">
            <p className="assayindex-kicker">Draft vs published</p>
            <div className="mt-4 space-y-3">
              {diffPaths.slice(0, 12).map((path) => (
                <p
                  key={path}
                  className="rounded-2xl border border-[#d9e3e8] px-4 py-3 text-sm leading-7 text-[#4d6472]"
                >
                  {path}
                </p>
              ))}
              {diffPaths.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-[#cad8df] p-4 text-sm leading-7 text-[#5b7281]">
                  Draft matches published catalog.
                </p>
              ) : null}
            </div>
          </section>
        </aside>
      </section>

      <section className="assayindex-panel p-5 md:p-6">
        <p className="assayindex-kicker">Preview</p>
        <p className="mt-2 text-sm leading-7 text-[#526978]">
          Preview uses the public assay detail renderer against the current draft catalog.
        </p>
        <div className="mt-6">
          {previewReport ? (
            <AssayDetailView labs={draftCatalog.labs} previewMode report={previewReport} />
          ) : (
            <div className="rounded-2xl border border-dashed border-[#cad8df] p-6 text-sm leading-7 text-[#5b7281]">
              Select an assay-linked entity to preview the rendered public page.
            </div>
          )}
        </div>
      </section>
    </AssayIndexShell>
  );
}
