import { supabase, supabaseUrl } from "./supabase";
import type { TwitchAlertType } from "../shared/twitchAlerts";
import { defaultAlertSoundUrl } from "../shared/twitchAlerts";

const ALERT_SOUNDS_BUCKET = "alert-sounds";
const MAX_SOUND_BYTES = 5 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set(["mp3", "wav", "ogg", "webm", "m4a"]);

function extensionFromFile(file: File): string | null {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && ALLOWED_EXTENSIONS.has(fromName)) {
    return fromName;
  }

  const mimeMap: Record<string, string> = {
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
    "audio/webm": "webm",
    "audio/mp4": "m4a",
    "audio/x-wav": "wav",
  };

  return mimeMap[file.type] ?? null;
}

export function formatAlertSoundLabel(soundUrl: string, alertType: TwitchAlertType): string {
  const defaultUrl = defaultAlertSoundUrl(alertType);
  if (!soundUrl.trim() || soundUrl === defaultUrl) {
    return "Default clip";
  }

  try {
    const pathname = soundUrl.startsWith("http")
      ? new URL(soundUrl).pathname
      : soundUrl;
    const filename = pathname.split("/").pop();
    if (filename) return filename;
  } catch {
    // fall through
  }

  return soundUrl.length > 36 ? `${soundUrl.slice(0, 33)}...` : soundUrl;
}

export function isDefaultAlertSound(soundUrl: string, alertType: TwitchAlertType): boolean {
  const trimmed = soundUrl.trim();
  return !trimmed || trimmed === defaultAlertSoundUrl(alertType);
}

export async function uploadAlertSound(
  userId: string,
  alertType: TwitchAlertType,
  file: File
): Promise<{ ok: true; publicUrl: string } | { ok: false; error: string }> {
  if (!supabaseUrl) {
    return { ok: false, error: "Supabase URL is not configured." };
  }

  if (file.size > MAX_SOUND_BYTES) {
    return { ok: false, error: "Sound must be 5 MB or smaller." };
  }

  const extension = extensionFromFile(file);
  if (!extension) {
    return { ok: false, error: "Use MP3, WAV, OGG, WebM, or M4A audio." };
  }

  const path = `${userId}/${alertType}.${extension}`;

  const { error } = await supabase.storage.from(ALERT_SOUNDS_BUCKET).upload(path, file, {
    upsert: true,
    cacheControl: "3600",
    contentType: file.type || undefined,
  });

  if (error) {
    console.error("Alert sound upload failed:", error.message);
    return { ok: false, error: error.message };
  }

  const { data } = supabase.storage.from(ALERT_SOUNDS_BUCKET).getPublicUrl(path);
  const publicUrl = data.publicUrl;

  if (!publicUrl) {
    return { ok: false, error: "Upload succeeded but public URL could not be resolved." };
  }

  return { ok: true, publicUrl };
}

export async function resetAlertSoundToDefault(
  userId: string,
  alertType: TwitchAlertType
): Promise<{ ok: true } | { ok: false; error: string }> {
  const extensions = ["mp3", "wav", "ogg", "webm", "m4a"];
  const paths = extensions.map((ext) => `${userId}/${alertType}.${ext}`);

  const { error } = await supabase.storage.from(ALERT_SOUNDS_BUCKET).remove(paths);

  if (error) {
    console.error("Alert sound reset failed:", error.message);
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
