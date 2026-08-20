export const LOINC_LICENSE_URL = "https://loinc.org/license";

const LOINC_CODE_PATTERN = /^\d{1,7}-\d$/;

export function loincRecordUrl(code: string) {
  const normalized = code.trim();
  return LOINC_CODE_PATTERN.test(normalized) ? `https://loinc.org/${normalized}/` : null;
}
