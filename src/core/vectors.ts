/**
 * Векторная память без обязательного внешнего провайдера.
 *
 * Основной путь — локальный hashing-vectorizer: быстро, бесплатно и без сети.
 * Если включён OMIKA_EMBED_API=1 и есть ключ, сервер может заменить его
 * на API-эмбеддинги, но retrieval и хранение те же.
 */
export interface VectorEntry {
  turn: number;
  text: string;
  vector: number[];
}

export function hashVector(text: string, dims = 384): number[] {
  const vector = new Array<number>(dims).fill(0);
  const words = String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 2);
  for (const word of words) {
    let hash = 2166136261;
    for (const char of word) {
      hash ^= char.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 16777619);
    }
    const index = Math.abs(hash) % dims;
    vector[index] += 1;
    // соседний бин делает вектор устойчивее к словоформам
    vector[(index + 17) % dims] += 0.35;
  }
  const length = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0)) || 1;
  return vector.map((item) => item / length);
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0;
  for (let index = 0; index < a.length; index += 1) dot += a[index] * b[index];
  return dot;
}

export function retrieve(entries: VectorEntry[], query: string, limit = 3): VectorEntry[] {
  const probe = hashVector(query);
  return entries
    .map((entry) => ({ entry, score: cosine(probe, entry.vector) }))
    .filter((row) => row.score > 0.02)
    .sort((a, b) => b.score - a.score || b.entry.turn - a.entry.turn)
    .slice(0, limit)
    .map((row) => row.entry);
}
