import type { AskResult, ChunkRecord, SearchHit } from './types.js';
import { formatTimestamp, normalizeText, scoreTokenOverlap, splitSentences, tokenize } from './utils.js';
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

function cleanSentence(sentence: string): string {
  return normalizeText(
    sentence
      .replace(/\[[^\]]+\]/g, '')
      .replace(/\b(?:uh|um|uhh|umm)\b/gi, '')
      .replace(/\b(?:okay|ok|right)\b[,.!?]?\s*/gi, '')
      .replace(/\bI would say\b[:,]?\s*/gi, '')
      .replace(/\s*--\s*/g, ' ')
      .replace(/\s+,/g, ',')
      .replace(/\b(\w+)\s+\1\b/gi, '$1')
  ).replace(/^[,.;: -]+|[,.;: -]+$/g, '');
}

function sentenceQuality(sentence: string): number {
  const cleaned = cleanSentence(sentence);
  if (!cleaned) return -1;
  let score = 0;
  if (cleaned.length >= 40) score += 0.2;
  if (cleaned.length <= 240) score += 0.2;
  if (/[.!?]$/.test(cleaned)) score += 0.15;
  if (/\b(?:risk|career|hiring|company|business|startup|job|skill|skills|founder|entrepreneur)\b/i.test(cleaned)) score += 0.2;
  if (/\b(?:this|that|it|he|she|they)\b/i.test(cleaned.slice(0, 12))) score -= 0.05;
  return score;
}

function pickEvidence(question: string, hits: SearchHit[]) {
  const candidates = sentenceCandidates(question, hits)
    .map((candidate) => {
      const cleaned = cleanSentence(candidate.sentence);
      return {
        ...candidate,
        cleaned,
        score: candidate.score + sentenceQuality(candidate.sentence)
      };
    })
    .sort((a, b) => b.score - a.score)
    .filter((candidate) => candidate.cleaned.length > 0 && candidate.score > 0.18);

  const picked: Array<{ sentence: string; hit: SearchHit }> = [];
  const seen = new Set<string>();
  const usedChunks = new Set<string>();

  for (const candidate of candidates) {
    const key = candidate.cleaned.toLowerCase();
    if (seen.has(key)) continue;
    if (usedChunks.has(candidate.hit.id) && picked.length >= 2) continue;
    seen.add(key);
    usedChunks.add(candidate.hit.id);
    picked.push({ sentence: candidate.cleaned, hit: candidate.hit });
    if (picked.length >= 3) break;
  }

  return picked;
}

function composeAnswer(question: string, hits: SearchHit[]): string {
  const evidence = pickEvidence(question, hits);

  if (!evidence.length) {
    return `I found related moments in the corpus, but not enough signal to answer this confidently without guessing.`;
  }

  const intro = evidence.length === 1
    ? `Based on the videos, the strongest answer is:`
    : `Based on the videos, the strongest answer is:`;

  const bullets = evidence.map((item) => `- ${item.sentence}`);
  return [intro, ...bullets].join('\n');
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
