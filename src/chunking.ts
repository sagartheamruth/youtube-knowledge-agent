import type { ChunkRecord, VideoRecord } from './types.js';
import { normalizeText } from './utils.js';

export function chunkVideo(video: VideoRecord, maxChars = 900): ChunkRecord[] {
  const chunks: ChunkRecord[] = [];
  let buffer = '';
  let startSec = 0;
  let endSec = 0;
  let chunkIndex = 0;

  function flush() {
    const text = normalizeText(buffer);
    if (!text) return;
    chunks.push({
      id: `${video.id}:${chunkIndex}`,
      videoId: video.id,
      videoTitle: video.title,
      videoUrl: video.url,
      startSec,
      endSec,
      text,
      tokenishLength: text.split(/\s+/).length
    });
    chunkIndex += 1;
    buffer = '';
  }

  for (const segment of video.transcript) {
    const nextText = normalizeText(`${buffer} ${segment.text}`);
    if (!buffer) startSec = segment.startSec;
    endSec = Math.max(endSec, segment.startSec + segment.durSec);

    if (nextText.length > maxChars && buffer) {
      flush();
      startSec = segment.startSec;
      endSec = segment.startSec + segment.durSec;
      buffer = segment.text;
      continue;
    }

    buffer = nextText;
  }

  flush();
  return chunks;
}

export function chunkAllVideos(videos: VideoRecord[]): ChunkRecord[] {
  return videos.flatMap((video) => chunkVideo(video));
}
