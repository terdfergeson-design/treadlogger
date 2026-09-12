/** Hands encoded bytes to the browser as a file download. */
export function downloadBytes(bytes: Uint8Array, fileName: string): void {
  // `application/vnd.ant.fit` is the registered type for FIT files; browsers and
  // desktop importers both recognise it.
  const blob = new Blob([bytes as unknown as BlobPart], { type: "application/vnd.ant.fit" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Revoking immediately can race the download in some browsers, so give the
  // navigation a moment to start.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function formatBytes(byteLength: number): string {
  if (byteLength < 1024) return `${byteLength} B`;
  if (byteLength < 1024 * 1024) return `${(byteLength / 1024).toFixed(1)} KB`;
  return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`;
}
