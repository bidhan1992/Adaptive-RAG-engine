export function chunkText(text, size = 420, overlap = 80) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= size) return [cleaned];

  const chunks = [];
  let start = 0;
  while (start < cleaned.length) {
    const end = Math.min(cleaned.length, start + size);
    chunks.push(cleaned.slice(start, end));
    if (end === cleaned.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks;
}

export function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}
