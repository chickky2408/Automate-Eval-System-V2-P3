/**
 * Primary test case file triple: VCD + ERoM (binName) + ULP (linName), all non-empty after trim.
 */
export function isTestCasePrimaryFileSetComplete(tc) {
  const v = String(tc?.vcdName ?? '').trim();
  const b = String(tc?.binName ?? '').trim();
  const l = String(tc?.linName ?? '').trim();
  return Boolean(v && b && l);
}
