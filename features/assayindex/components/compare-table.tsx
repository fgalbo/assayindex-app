import { buildCompareRows } from "@/features/assayindex/selectors/catalog";
import type { AssayLabRecord, Lab } from "@/features/assayindex/domain/types";

type CompareTableProps = {
  records: AssayLabRecord[];
  labsById: Map<string, Lab>;
  density?: "comfortable" | "compact";
};

export function CompareTable({ records, labsById, density = "comfortable" }: CompareTableProps) {
  const rows = buildCompareRows(records, labsById);

  return (
    <div className={density === "compact" ? "assayindex-density-compact" : undefined}>
      <div className="hidden overflow-x-auto md:block">
        <table className="assayindex-table">
          <thead>
            <tr>
              <th>Field</th>
              {records.map((record) => (
                <th key={record.id}>
                  <div className="space-y-1">
                    <div className="font-semibold tracking-normal text-[#132332]">
                      {labsById.get(record.labId)?.displayName ?? record.labId}
                    </div>
                    <div className="text-xs normal-case text-[#5b6e7c]">{record.recordTitle}</div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th>{row.label}</th>
                {records.map((record) => (
                  <td key={record.id}>{row.values[record.id]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 md:hidden">
        {records.map((record) => (
          <article key={record.id} className="assayindex-panel p-4">
            <div className="space-y-1">
              <p className="assayindex-kicker">{labsById.get(record.labId)?.shortName ?? record.labId}</p>
              <h3 className="text-lg font-semibold text-[#112535]">{record.recordTitle}</h3>
            </div>
            <dl className="mt-4 space-y-3">
              {rows.map((row) => (
                <div key={row.key}>
                  <dt className="text-xs uppercase tracking-[0.16em] text-[#506575]">{row.label}</dt>
                  <dd className="mt-1 text-sm leading-6 text-[#153042]">{row.values[record.id]}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
    </div>
  );
}
