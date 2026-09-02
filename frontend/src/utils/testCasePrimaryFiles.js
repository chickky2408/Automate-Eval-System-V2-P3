/**
 * Primary test case file requirement: VCD is mandatory; ERoM and ULP are optional.
 */
export function isTestCasePrimaryFileSetComplete(tc) {
  const v = String(tc?.vcdName ?? '').trim();
  return Boolean(v);
}
