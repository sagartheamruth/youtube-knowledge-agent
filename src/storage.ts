import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChunkRecord, InsightLogEntry, PlaylistManifest, VideoRecord } from './types.js';

export type Storage = ReturnType<typeof createStorage>;

export function createStorage(rootDir: string) {
  const dataDir = path.join(rootDir, 'data');
  const videosDir = path.join(dataDir, 'videos');

  async function ensureLayout() {
    await fs.mkdir(videosDir, { recursive: true });
  }

  async function readJson<T>(filePath: string, fallback: T): Promise<T> {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return JSON.parse(raw) as T;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') return fallback;
      throw error;
    }
  }

  async function writeJson(filePath: string, value: unknown) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  }

  return {
    dataDir,
    videosDir,
    ensureLayout,
    readManifest: () => readJson<PlaylistManifest | null>(path.join(dataDir, 'playlist-manifest.json'), null),
    writeManifest: (manifest: PlaylistManifest) => writeJson(path.join(dataDir, 'playlist-manifest.json'), manifest),
    readVideo: (videoId: string) => readJson<VideoRecord | null>(path.join(videosDir, `${videoId}.json`), null),
    writeVideo: (video: VideoRecord) => writeJson(path.join(videosDir, `${video.id}.json`), video),
    async listVideos(): Promise<VideoRecord[]> {
      await ensureLayout();
      const entries = await fs.readdir(videosDir);
      const videos = await Promise.all(entries.filter((name) => name.endsWith('.json')).map((name) => readJson<VideoRecord | null>(path.join(videosDir, name), null)));
      return videos.filter((item): item is VideoRecord => Boolean(item));
    },
    readChunks: () => readJson<ChunkRecord[]>(path.join(dataDir, 'chunks.json'), []),
    writeChunks: (chunks: ChunkRecord[]) => writeJson(path.join(dataDir, 'chunks.json'), chunks),
    readInsightLog: () => readJson<InsightLogEntry[]>(path.join(dataDir, 'insight-log.json'), []),
    writeInsightLog: (entries: InsightLogEntry[]) => writeJson(path.join(dataDir, 'insight-log.json'), entries),
    writeReport: (name: string, value: unknown) => writeJson(path.join(dataDir, name), value)
  };
}
