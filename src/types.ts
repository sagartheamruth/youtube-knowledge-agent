export type TranscriptSegment = {
  text: string;
  startSec: number;
  durSec: number;
};

export type VideoRecord = {
  id: string;
  title: string;
  url: string;
  author?: string;
  description?: string;
  durationSec?: number;
  viewCount?: number;
  thumbnails?: string[];
  transcriptLanguage?: string;
  transcriptSource: 'youtube-captions' | 'elevenlabs-scribe';
  transcriptFetchedAt: string;
  transcriptHash: string;
  transcript: TranscriptSegment[];
};

export type PlaylistManifest = {
  playlistId: string;
  playlistUrl: string;
  title: string;
  syncedAt: string;
  videoIds: string[];
};

export type ChunkRecord = {
  id: string;
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  startSec: number;
  endSec: number;
  text: string;
  tokenishLength: number;
};

export type InsightLogEntry = {
  chunkId: string;
  sentAt: string;
};

export type SearchHit = ChunkRecord & {
  score: number;
};

export type AskResult = {
  covered: boolean;
  answer: string;
  citations: Array<{
    videoId: string;
    videoTitle: string;
    videoUrl: string;
    startSec: number;
    endSec: number;
    timestamp: string;
  }>;
  hits: SearchHit[];
};

export type InsightResult = {
  insight: string;
  chunk: ChunkRecord;
  timestamp: string;
  alreadySentCount: number;
  strategy: string;
};
