import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { Innertube, Platform } from 'youtubei.js';
import type { TranscriptSegment } from './types.js';
import { normalizeText } from './utils.js';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const youtubedl = require('youtube-dl-exec') as (url: string, flags: Record<string, unknown>) => Promise<unknown>;
let platformPatched = false;
let clientPromise: Promise<Innertube> | null = null;

type ElevenLabsWord = {
  text: string;
  start: number;
  end: number;
  type: 'word' | 'spacing';
};

type ElevenLabsTranscriptionResponse = {
  text: string;
  words?: ElevenLabsWord[];
};

function patchYoutubeRuntime() {
  if (platformPatched) return;
  Platform.load({
    ...Platform.shim,
    eval: (data, env) => new vm.Script(`(function(){${data.output}; return {${data.exported.join(',')}};})()`).runInContext(vm.createContext({ ...env }))
  });
  platformPatched = true;
}

export async function getYoutubeClient(): Promise<Innertube> {
  patchYoutubeRuntime();
  clientPromise ??= Innertube.create();
  return clientPromise;
}

async function ensureYtDlpBinary(projectRoot: string) {
  const pkgRoot = path.join(projectRoot, 'node_modules/.pnpm/youtube-dl-exec@3.1.5/node_modules/youtube-dl-exec');
  const binary = path.join(pkgRoot, 'bin/yt-dlp');
  try {
    await fs.access(binary);
  } catch {
    await execFileAsync('node', ['scripts/postinstall.js'], { cwd: pkgRoot });
  }
}

async function ffprobeDurationSec(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ]);
    return Number(stdout.trim());
  } catch {
    const { stderr } = await execFileAsync('ffmpeg', ['-i', filePath]).catch((error: any) => ({ stderr: String(error.stderr ?? '') }));
    const match = String(stderr).match(/Duration:\s+(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!match) throw new Error(`Could not determine audio duration for ${filePath}`);
    const [, hh, mm, ss] = match;
    return Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
  }
}

async function cutAudioChunk(inputPath: string, outputPath: string, startSec: number, durationSec: number) {
  await execFileAsync('ffmpeg', [
    '-y',
    '-ss', String(startSec),
    '-t', String(durationSec),
    '-i', inputPath,
    '-vn',
    '-ac', '1',
    '-ar', '16000',
    outputPath
  ]);
}

function buildSegmentsFromWords(words: ElevenLabsWord[], chunkOffsetSec: number): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let buffer = '';
  let startSec = 0;
  let endSec = 0;
  let wordCount = 0;

  function flush() {
    const text = normalizeText(buffer);
    if (!text) return;
    segments.push({
      text,
      startSec: chunkOffsetSec + startSec,
      durSec: Math.max(0.1, endSec - startSec)
    });
    buffer = '';
    startSec = 0;
    endSec = 0;
    wordCount = 0;
  }

  for (const entry of words) {
    if (entry.type === 'spacing') {
      buffer += entry.text;
      continue;
    }

    if (!buffer) startSec = entry.start;
    endSec = entry.end;
    buffer += entry.text;
    wordCount += 1;

    if (/[.!?]$/.test(entry.text) || wordCount >= 24 || endSec - startSec >= 18) {
      flush();
    }
  }

  flush();
  return segments;
}

async function transcribeChunkWithElevenLabs(filePath: string, apiKey: string): Promise<ElevenLabsTranscriptionResponse> {
  const form = new FormData();
  const fileBuffer = await fs.readFile(filePath);
  form.append('model_id', 'scribe_v2');
  form.append('file', new Blob([fileBuffer], { type: 'audio/mpeg' }), path.basename(filePath));
  const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: form
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ElevenLabs transcription failed (${response.status}): ${body.slice(0, 300)}`);
  }
  return response.json() as Promise<ElevenLabsTranscriptionResponse>;
}

export async function transcribeVideoWithElevenLabs(params: { projectRoot: string; videoId: string; apiKey: string; segmentDurationSec?: number; }): Promise<TranscriptSegment[]> {
  const { projectRoot, videoId, apiKey, segmentDurationSec = 900 } = params;
  await ensureYtDlpBinary(projectRoot);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `yt-agent-${videoId}-`));
  const outputTemplate = path.join(tempDir, `${videoId}.%(ext)s`);
  try {
    await youtubedl(`https://www.youtube.com/watch?v=${videoId}`, {
      extractAudio: true,
      audioFormat: 'mp3',
      output: outputTemplate,
      noCheckCertificates: true,
      youtubeSkipDashManifest: true,
      preferFreeFormats: true
    });

    const audioPath = path.join(tempDir, `${videoId}.mp3`);
    const totalDurationSec = await ffprobeDurationSec(audioPath);
    const transcripts: TranscriptSegment[] = [];

    for (let start = 0; start < totalDurationSec; start += segmentDurationSec) {
      const chunkPath = path.join(tempDir, `${videoId}-${start}.mp3`);
      const duration = Math.min(segmentDurationSec, totalDurationSec - start);
      await cutAudioChunk(audioPath, chunkPath, start, duration);
      const result = await transcribeChunkWithElevenLabs(chunkPath, apiKey);
      const wordSegments = buildSegmentsFromWords(result.words ?? [], start);

      if (wordSegments.length) {
        transcripts.push(...wordSegments);
      } else if (result.text.trim()) {
        transcripts.push({ text: normalizeText(result.text), startSec: start, durSec: duration });
      }
    }

    return transcripts;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
