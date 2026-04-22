// Compute a file signature used for client-side dedup.
//
// NOTE: `crypto.subtle` is only available in a "secure context" (HTTPS or
// http://localhost). On plain HTTP over a LAN IP (e.g. http://192.168.1.108:8000)
// `window.crypto.subtle` is undefined and calling digest() throws. In that
// case we silently degrade to a checksum-less signature — dedup then falls
// back to (name + size) which is good enough for the Library UI.
export async function computeFileSignature(file) {
  if (!file) return { checksum: null, size: 0, modifiedAt: null };
  const size = file.size;
  const modifiedAt = file.lastModified ? new Date(file.lastModified).toISOString() : null;

  const subtle =
    (typeof globalThis !== 'undefined' &&
      globalThis.crypto &&
      globalThis.crypto.subtle) ||
    null;

  if (!subtle) {
    return { checksum: null, size, modifiedAt };
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const hashBuffer = await subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    return { checksum: hashHex, size, modifiedAt };
  } catch (err) {
    console.warn('[computeFileSignature] falling back without checksum:', err);
    return { checksum: null, size, modifiedAt };
  }
}
