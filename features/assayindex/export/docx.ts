import { ASSAY_DETAIL_FIELDS } from "@/features/assayindex/constants";
import type { AssayLabRecord, AssayReport } from "@/features/assayindex/domain/types";
import { renderListOrFallback, renderValueOrFallback } from "@/features/assayindex/utils/formatting";

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function buildCodeLine(record: AssayLabRecord) {
  return renderListOrFallback([
    record.testCode ? `Test ${record.testCode}` : null,
    record.orderCode ? `Order ${record.orderCode}` : null,
    record.cptCodes.length > 0 ? `CPT ${record.cptCodes.join(", ")}` : null,
    record.loincCodes.length > 0 ? `LOINC ${record.loincCodes.join(", ")}` : null,
    record.associatedIcd10.length > 0
      ? `ICD-10 ${record.associatedIcd10.map((code) => code.code).join(", ")}`
      : null,
  ]);
}

function buildPriceLine(record: AssayLabRecord) {
  return renderListOrFallback(record.priceObservations?.map((price) => price.sourceText) ?? []);
}

export async function buildAssayReportDocxBlob(report: AssayReport) {
  const {
    AlignmentType,
    BorderStyle,
    Document,
    HeadingLevel,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
  } = await import("docx");

  const comparisonTable = new Table({
    width: {
      size: 100,
      type: WidthType.PERCENTAGE,
    },
    rows: [
      new TableRow({
        children: [
          "Lab",
          "Test",
          "Codes",
          "Specimen",
          "Turnaround",
          "Methodology",
          "Source-listed price",
          "Reflex logic",
        ].map(
          (label) =>
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: label, bold: true })] })],
            }),
        ),
      }),
      ...report.labRecords.map(
        (record) =>
          new TableRow({
            children: [
              record.labId,
              record.testName,
              buildCodeLine(record),
              renderValueOrFallback(record.specimenType),
              renderValueOrFallback(record.turnaroundTime),
              renderValueOrFallback(record.methodology),
              buildPriceLine(record),
              renderValueOrFallback(record.reflexLogic),
            ].map(
              (value) =>
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun(value)] })],
                }),
            ),
          }),
      ),
    ],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: "9BA4B1" },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: "9BA4B1" },
      left: { style: BorderStyle.SINGLE, size: 1, color: "9BA4B1" },
      right: { style: BorderStyle.SINGLE, size: 1, color: "9BA4B1" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "D5DBE1" },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "D5DBE1" },
    },
  });

  const detailSections = report.labRecords.flatMap((record) => {
    const details = ASSAY_DETAIL_FIELDS.map(([fieldKey, label]) => {
      const value = renderValueOrFallback(record[fieldKey as keyof AssayLabRecord] as string | null);
      return new Paragraph({
        children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun(value)],
      });
    });

    const sourceParagraphs = record.sourceLinks.map(
      (link) =>
        new Paragraph({
          children: [new TextRun({ text: `${link.label}: `, bold: true }), new TextRun(link.url)],
        }),
    );

    return [
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun(record.recordTitle)],
      }),
      new Paragraph({
        children: [new TextRun({ text: "Codes: ", bold: true }), new TextRun(buildCodeLine(record))],
      }),
      ...details,
      new Paragraph({
        children: [
          new TextRun({ text: "Source-listed price: ", bold: true }),
          new TextRun(buildPriceLine(record)),
        ],
      }),
      new Paragraph({
        children: [new TextRun({ text: "Sources", bold: true })],
      }),
      ...sourceParagraphs,
    ];
  });

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: "AssayIndex", bold: true, size: 32 })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: report.assay.displayName, bold: true, size: 28 })],
          }),
          new Paragraph(report.assay.summary),
          new Paragraph(report.assay.purpose),
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun("Associated Codes")],
          }),
          ...report.assayLevelCodes.map(
            (code) =>
              new Paragraph(`${code.category} ${code.code} - ${code.description}${code.note ? ` (${code.note})` : ""}`),
          ),
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun("Cross-lab Comparison")],
          }),
          comparisonTable,
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun("Detailed Lab Records")],
          }),
          ...detailSections,
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun("Supporting Sources")],
          }),
          ...report.sources.map(
            (source) =>
              new Paragraph(
                `${source.label} (${source.sourceType}) - ${source.url}${source.note ? ` - ${source.note}` : ""}`,
              ),
          ),
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun("Disclaimer")],
          }),
          new Paragraph(report.disclaimer),
        ],
      },
    ],
  });

  return Packer.toBlob(doc);
}

export async function downloadAssayReportDocx(report: AssayReport) {
  const blob = await buildAssayReportDocxBlob(report);
  downloadBlob(blob, `AssayIndex_${report.assay.slug}_Report.docx`);
}
