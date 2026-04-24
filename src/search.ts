import MiniSearch from 'minisearch';
import type { ChunkRecord, SearchHit } from './types.js';

export function createSearchIndex(chunks: ChunkRecord[]) {
  const mini = new MiniSearch<ChunkRecord>({
    idField: 'id',
    fields: ['videoTitle', 'text'],
    storeFields: ['id', 'videoId', 'videoTitle', 'videoUrl', 'startSec', 'endSec', 'text', 'tokenishLength'],
    searchOptions: {
      boost: { videoTitle: 2, text: 1 },
      fuzzy: 0.15,
      prefix: true
    }
  });

  mini.addAll(chunks);
  return mini;
}

export function searchChunks(chunks: ChunkRecord[], query: string, limit = 8): SearchHit[] {
  if (!chunks.length) return [];
  const index = createSearchIndex(chunks);
  return index.search(query, { combineWith: 'AND', prefix: true, fuzzy: 0.1 })
    .concat(index.search(query, { combineWith: 'OR', prefix: true, fuzzy: 0.2 }))
    .reduce<SearchHit[]>((acc, hit) => {
      if (acc.some((existing) => existing.id === hit.id)) return acc;
      acc.push({ ...(hit as unknown as ChunkRecord), score: hit.score });
      return acc;
    }, [])
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
