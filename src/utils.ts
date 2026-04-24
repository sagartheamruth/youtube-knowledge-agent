import crypto from 'node:crypto';

export function ensure<T>(value: T | null | undefined, message: string): T {
  if (value == null) throw new Error(message);
  return value;
}

export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function parsePlaylistId(input: string): string {
  if (/^[A-Za-z0-9_-]+$/.test(input) && input.startsWith('PL')) return input;
  const url = new URL(input);
  const list = url.searchParams.get('list');
  if (!list) throw new Error(`Could not find playlist id in: ${input}`);
  return list;
}

export function formatTimestamp(totalSec: number): string {
  const seconds = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function normalizeText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
}

const STOPWORDS = new Set([
  'a','an','the','and','or','but','if','then','else','when','how','what','why','who','where','is','am','are','was','were','be','been','being','to','of','in','on','for','with','from','by','about','into','after','before','at','as','it','this','that','these','those','i','you','we','they','he','she','my','your','our','their','me','him','her','them','do','does','did','done','can','could','should','would','will','just','than','too','very','more','most','less','least','up','down','out','over','under','again','only','own','same','so','than'
]);

export function tokenize(text: string): string[] {
  return normalizeText(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

export function scoreTokenOverlap(questionTokens: string[], text: string): number {
  if (!questionTokens.length) return 0;
  const haystack = new Set(tokenize(text));
  let matches = 0;
  for (const token of questionTokens) {
    if (haystack.has(token)) matches += 1;
  }
  return matches / questionTokens.length;
}

export function splitSentences(text: string): string[] {
  return normalizeText(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function dedupe<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = key(item);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
