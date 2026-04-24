import type { AskResult, ChunkRecord, SearchHit } from './types.js';
import { formatTimestamp, scoreTokenOverlap, splitSentences, tokenize } from './utils.js';
import { searchChunks } from './search.js';

function sentenceCandidates(question: string, hits: SearchHit[]): Array<{ sentence: string; hit: SearchHit; score: number }> {
  const questionTokens = tokenize(question);
  return hits.flatMap((hit) =>
    splitSentences(hit.text).map((sentence) => ({
      sentence,
      hit,
      score: scoreTokenOverlap(questionTokens, sentence) + hit.score / 10
    }))
  );
}

function composeAnswer(question: string, hits: SearchHit[]): string {
  const candidates = sentenceCandidates(question, hits)
    .sort((a, b) => b.score - a.score)
    .filter((candidate) => candidate.score > 0.12);

  const picked: string[] = [];
  for (const candidate of candidates) {
    if (picked.some((sentence) => sentence === candidate.sentence)) continue;
    picked.push(candidate.sentence);
    if (picked.length >= 3) break;
  }

  if (!picked.length) {
    return `I found related moments in the corpus, but not enough signal to answer this confidently without guessing.`;
  }

  return `From your videos, the clearest answer is: ${picked.join(' ')}`;
}

export function answerQuestion(chunks: ChunkRecord[], question: string): AskResult {
  const hits = searchChunks(chunks, question, 8);
  const best = hits[0];

  if (!best || best.score < 0.5) {
    return {
      covered: false,
      answer: `I couldn’t find a solid answer for that in the current transcript corpus, so I won’t make one up.`,
      citations: [],
      hits
    };
  }

  const citations = hits.slice(0, 3).map((hit) => ({
    videoId: hit.videoId,
    videoTitle: hit.videoTitle,
    videoUrl: hit.videoUrl,
    startSec: hit.startSec,
    endSec: hit.endSec,
    timestamp: formatTimestamp(hit.startSec)
  }));

  return {
    covered: true,
    answer: composeAnswer(question, hits),
    citations,
    hits
  };
}
