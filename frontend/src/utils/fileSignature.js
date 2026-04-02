export async function computeFileSignature(file) {
  if (!file) return { checksum: null, size: 0, modifiedAt: null };
  const arrayBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return {
    checksum: hashHex,
    size: file.size,
    modifiedAt: file.lastModified ? new Date(file.lastModified).toISOString() : null,
  };
}

