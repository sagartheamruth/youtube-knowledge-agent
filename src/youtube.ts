import { XMLParser } from 'fast-xml-parser';
import type { Innertube } from 'youtubei.js';
import type { PlaylistManifest, TranscriptSegment, VideoRecord } from './types.js';
import { ensure, normalizeText, parsePlaylistId, sha256 } from './utils.js';
import { getYoutubeClient, transcribeVideoWithElevenLabs } from './transcription.js';

type PlaylistVideo = {
  id: string;
  title: string;
  url: string;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: 'text'
});

let clientPromise: Promise<Innertube> | null = null;

async function getClient() {
  clientPromise ??= getYoutubeClient();
  return clientPromise;
}

export async function fetchPlaylist(playlistUrlOrId: string): Promise<{ manifest: PlaylistManifest; videos: PlaylistVideo[] }> {
  const playlistId = parsePlaylistId(playlistUrlOrId);
  const client = await getClient();
  let playlist = await client.getPlaylist(playlistId);
  const videos: PlaylistVideo[] = [];

  while (true) {
    videos.push(
      ...playlist.items
        .map((item: any) => {
          const maybeId = 'id' in item ? item.id : undefined;
          if (!maybeId) return null;
          const maybeTitle = 'title' in item ? item.title : undefined;
          return {
            id: maybeId,
            title: normalizeText(maybeTitle?.text ?? maybeTitle?.toString?.() ?? maybeId),
            url: `https://www.youtube.com/watch?v=${maybeId}`
          };
        })
        .filter((item: PlaylistVideo | null): item is PlaylistVideo => Boolean(item))
    );

    if (!playlist.has_continuation) break;
    playlist = await playlist.getContinuation();
  }

  return {
    manifest: {
      playlistId,
      playlistUrl: `https://www.youtube.com/playlist?list=${playlistId}`,
      title: normalizeText(playlist.info?.title ?? playlistId),
      syncedAt: new Date().toISOString(),
      videoIds: videos.map((video) => video.id)
    },
    videos
  };
}

function parseCaptionXml(xml: string): TranscriptSegment[] {
  const parsed = parser.parse(xml) as { transcript?: { text?: Array<{ text?: string; start?: string; dur?: string }> | { text?: string; start?: string; dur?: string } } };
  const textNodes = parsed.transcript?.text;
  const items = Array.isArray(textNodes) ? textNodes : textNodes ? [textNodes] : [];

  return items
    .map((entry) => ({
      text: normalizeText(typeof entry.text === 'string' ? entry.text : ''),
      startSec: Number(entry.start ?? 0),
      durSec: Number(entry.dur ?? 0)
    }))
    .filter((entry) => entry.text.length > 0);
}

export async function fetchVideoRecord(videoId: string): Promise<VideoRecord> {
  const client = await getClient();
  const info = await client.getInfo(videoId);
  const captionTracks = info.captions?.caption_tracks ?? [];
  const englishTrack = captionTracks.find((track: any) => track.language_code?.startsWith('en')) ?? captionTracks[0];
  const track = ensure(englishTrack, `No captions found for ${videoId}`);
  const response = await fetch(track.base_url);
  if (!response.ok) throw new Error(`Failed to fetch captions for ${videoId}: ${response.status}`);
  const xml = await response.text();
  const transcript = parseCaptionXml(xml);
  const transcriptText = transcript.map((segment) => segment.text).join(' ');

  return {
    id: videoId,
    title: normalizeText(info.basic_info.title ?? videoId),
    url: `https://www.youtube.com/watch?v=${videoId}`,
    author: normalizeText(info.basic_info.channel?.name ?? info.basic_info.author ?? ''),
    description: normalizeText(info.basic_info.short_description ?? ''),
    durationSec: info.basic_info.duration ?? undefined,
    viewCount: typeof info.basic_info.view_count === 'number' ? info.basic_info.view_count : undefined,
    thumbnails: info.basic_info.thumbnail?.map((thumb: any) => thumb.url) ?? [],
    transcriptLanguage: track.language_code,
    transcriptSource: 'youtube-captions',
    transcriptFetchedAt: new Date().toISOString(),
    transcriptHash: sha256(transcriptText),
    transcript
  };
}

export async function fetchVideoRecordWithFallback(params: { projectRoot: string; videoId: string; elevenLabsApiKey?: string; }): Promise<VideoRecord> {
  const { projectRoot, videoId, elevenLabsApiKey } = params;
  const client = await getClient();
  const info = await client.getInfo(videoId);

  let transcript: TranscriptSegment[] = [];
  let transcriptSource: VideoRecord['transcriptSource'] = 'youtube-captions';
  let transcriptLanguage = 'en';

  try {
    const captionBased = await fetchVideoRecord(videoId);
    transcript = captionBased.transcript;
    transcriptSource = captionBased.transcriptSource;
    transcriptLanguage = captionBased.transcriptLanguage ?? 'en';
  } catch {
    transcript = [];
  }

  if (!transcript.length) {
    if (!elevenLabsApiKey) throw new Error(`No usable transcript found for ${videoId}, and ELEVENLABS_API_KEY is not set.`);
    transcript = await transcribeVideoWithElevenLabs({ projectRoot, videoId, apiKey: elevenLabsApiKey });
    transcriptSource = 'elevenlabs-scribe';
    transcriptLanguage = 'en';
  }

  const transcriptText = transcript.map((segment) => segment.text).join(' ');
  return {
    id: videoId,
    title: normalizeText(info.basic_info.title ?? videoId),
    url: `https://www.youtube.com/watch?v=${videoId}`,
    author: normalizeText(info.basic_info.channel?.name ?? info.basic_info.author ?? ''),
    description: normalizeText(info.basic_info.short_description ?? ''),
    durationSec: info.basic_info.duration ?? undefined,
    viewCount: typeof info.basic_info.view_count === 'number' ? info.basic_info.view_count : undefined,
    thumbnails: info.basic_info.thumbnail?.map((thumb: any) => thumb.url) ?? [],
    transcriptLanguage,
    transcriptSource,
    transcriptFetchedAt: new Date().toISOString(),
    transcriptHash: sha256(transcriptText),
    transcript
  };
}
