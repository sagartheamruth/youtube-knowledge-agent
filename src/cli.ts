import path from 'node:path';
import process from 'node:process';
import { chunkAllVideos } from './chunking.js';
import { buildInsightVoiceScript, pickDailyInsight } from './insights.js';
import { answerQuestion } from './qa.js';
import { createStorage } from './storage.js';
import { fetchPlaylist, fetchVideoRecordWithFallback } from './youtube.js';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const storage = createStorage(rootDir);

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function syncCommand() {
  const playlistUrl = argValue('--playlist') ?? process.env.YOUTUBE_PLAYLIST_URL;
  const maxVideos = Number(argValue('--max-videos') ?? '0') || undefined;
  const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
  if (!playlistUrl) throw new Error('Missing --playlist <url>');
  await storage.ensureLayout();

  const { manifest, videos } = await fetchPlaylist(playlistUrl);
  const selectedVideos = typeof maxVideos === 'number' ? videos.slice(0, maxVideos) : videos;
  const existingVideos = new Map((await storage.listVideos()).map((video) => [video.id, video]));
  const saved = [];
  const updated = [];

  for (const video of selectedVideos) {
    const record = await fetchVideoRecordWithFallback({ projectRoot: rootDir, videoId: video.id, elevenLabsApiKey });
    const existing = existingVideos.get(video.id);
    if (!existing || existing.transcriptHash !== record.transcriptHash || existing.title !== record.title) {
      await storage.writeVideo(record);
      updated.push(video.id);
    }
    saved.push(record);
  }

  const chunks = chunkAllVideos(saved);
  await storage.writeManifest(manifest);
  await storage.writeChunks(chunks);
  await storage.writeReport('last-sync.json', {
    syncedAt: new Date().toISOString(),
    playlistTitle: manifest.title,
    playlistUrl: manifest.playlistUrl,
    totalVideos: saved.length,
    totalChunks: chunks.length,
    updatedVideoIds: updated
  });

  console.log(JSON.stringify({ ok: true, savedVideos: saved.length, chunks: chunks.length, updatedVideoIds: updated }, null, 2));
}

async function askCommand() {
  const question = argValue('--question') ?? process.argv.slice(3).join(' ').trim();
  if (!question) throw new Error('Missing --question');
  const chunks = await storage.readChunks();
  const result = answerQuestion(chunks, question);
  console.log(JSON.stringify(result, null, 2));
}

async function insightCommand() {
  const markSent = process.argv.includes('--mark-sent');
  const includeVoiceScript = process.argv.includes('--voice-script');
  const chunks = await storage.readChunks();
  const log = await storage.readInsightLog();
  const result = pickDailyInsight(chunks, log);
  if (markSent) {
    log.push({ chunkId: result.chunk.id, sentAt: new Date().toISOString() });
    await storage.writeInsightLog(log);
  }
  console.log(JSON.stringify(includeVoiceScript ? { ...result, voiceScript: buildInsightVoiceScript(result) } : result, null, 2));
}

async function checkCommand() {
  const manifest = await storage.readManifest();
  const videos = await storage.listVideos();
  const chunks = await storage.readChunks();
  const insights = await storage.readInsightLog();
  console.log(JSON.stringify({ manifest, videos: videos.length, chunks: chunks.length, insights: insights.length }, null, 2));
}

async function main() {
  const command = process.argv[2];
  switch (command) {
    case 'sync':
      await syncCommand();
      break;
    case 'ask':
      await askCommand();
      break;
    case 'insight':
      await insightCommand();
      break;
    case 'check':
      await checkCommand();
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
