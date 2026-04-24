import type { ChunkRecord, InsightLogEntry, InsightResult } from './types.js';
import { formatTimestamp, splitSentences, tokenize } from './utils.js';

function scoreSignal(chunk: ChunkRecord): number {
  const text = chunk.text.toLowerCase();
  const tokens = tokenize(chunk.text);
  const uniqueRatio = new Set(tokens).size / Math.max(tokens.length, 1);
  const noveltyBoost = [
    'most people',
    'the mistake',
    'problem is',
    'truth is',
    'actually',
    'instead',
    'don’t',
    'stop',
    'if you'
  ].reduce((sum, phrase) => sum + (text.includes(phrase) ? 0.2 : 0), 0);
  return uniqueRatio + noveltyBoost + Math.min(chunk.text.length / 1200, 1);
}

function daysSinceLastSent(chunkId: string, log: InsightLogEntry[]): number {
  const sent = log.filter((entry) => entry.chunkId === chunkId).sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];
  if (!sent) return 9999;
  const diffMs = Date.now() - new Date(sent.sentAt).getTime();
  return diffMs / (1000 * 60 * 60 * 24);
}

export function pickDailyInsight(chunks: ChunkRecord[], log: InsightLogEntry[]): InsightResult {
  if (!chunks.length) throw new Error('No chunks available. Run sync first.');

  const scored = chunks
    .map((chunk) => ({
      chunk,
      score: scoreSignal(chunk) + Math.min(daysSinceLastSent(chunk.id, log) / 30, 2)
    }))
    .sort((a, b) => b.score - a.score);

  const winner = scored[0]?.chunk;
  if (!winner) throw new Error('Could not select an insight chunk.');

  const lines = splitSentences(winner.text).slice(0, 2);
  const timestamp = formatTimestamp(winner.startSec);
  return {
    insight: `Daily insight: ${lines.join(' ')} Source: ${winner.videoTitle} at ${timestamp}.`,
    chunk: winner,
    timestamp,
    alreadySentCount: log.filter((entry) => entry.chunkId === winner.id).length,
    strategy: 'least-recently-surfaced + signal-ranked'
  };
}
