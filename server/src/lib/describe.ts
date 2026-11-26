/**
 * Turns noisy bank text into something readable for the transaction list.
 * The original text is always kept in raw_description (rules match on both).
 *   "EXAMPLEFLIX* VIDEO SUB EXAMPLEFLIX.COM CA Date 10/29/26 24000000000000000000099"
 *     -> "EXAMPLEFLIX* VIDEO SUB EXAMPLEFLIX.COM CA"
 *   "#600000000123  Streamly USA 800-5550100 NY" -> "Streamly USA NY"
 * Only fixed, simple patterns are used here (no user-supplied regex anywhere).
 */
export function cleanDescription(text: string): string {
  const original = text.replace(/\s+/g, ' ').trim();
  // ACH memos: "TYPE: MONEYLINE ID: 123 CO: FID BKG SVC LLC NAME: <your name> ..." -> "FID BKG SVC LLC"
  // (also keeps your own name, which banks put after NAME:, out of the list)
  const co = / CO: (.+?)(?: NAME:| Entry Class| ACH Trace|$)/i.exec(` ${original}`);
  if (co?.[1] && /\bTYPE:/i.test(original)) return co[1].trim().slice(0, 200);
  const cleaned = original
    .replace(/\s+Date\s+\d{1,2}\/\d{1,2}\/\d{2,4}(\s+\d+)?$/i, '') // card "Date 10/29/26 2401..." tail
    .replace(/#\d{6,}/g, '') // long reference numbers
    .replace(/\b\d{10,}\b/g, '') // trace numbers
    .replace(/\b\d{3}-\d{3}-?\d{4}\b/g, '') // phone numbers
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || original).slice(0, 200);
}
