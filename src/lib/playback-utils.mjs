export function formatTimestamp(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  const pad = value => String(value).padStart(2, '0');
  return hours > 0
    ? `[${pad(hours)}:${pad(minutes)}:${pad(remainder)}]`
    : `[${pad(minutes)}:${pad(remainder)}]`;
}

export function isPlaybackCompleted(positionSeconds, durationSeconds, threshold = 0.9) {
  const position = Number(positionSeconds);
  const duration = Number(durationSeconds);
  const ratio = Number(threshold);
  if (!Number.isFinite(position) || !Number.isFinite(duration) ||
      !Number.isFinite(ratio) || duration <= 0 || ratio <= 0 || ratio > 1) {
    return false;
  }
  return position / duration >= ratio;
}

export function isValidYouTubeId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(value);
}

export function normalizeFocusSettings(value = {}) {
  const defaults = {
    enabled: true,
    hideYouTube: true,
    hideRecommendations: true,
    hideShorts: true
  };
  const result = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (typeof value?.[key] === 'boolean') result[key] = value[key];
  }
  return result;
}

export function appendTimestamp(notes, seconds) {
  const timestamp = formatTimestamp(seconds);
  const current = String(notes || '');
  const separator = current && !current.endsWith('\n') ? '\n' : '';
  return `${current}${separator}${timestamp} `;
}


export function filterVideosForFocus(videos, settings = {}) {
  const rows = Array.isArray(videos) ? videos : [];
  if (!settings.enabled || !settings.hideYouTube) return rows;
  return rows.filter(video => Boolean(video?.isLocal || video?.file_path));
}

export function shouldShowRecommendations(settings = {}) {
  return !(Boolean(settings.enabled) && Boolean(settings.hideRecommendations));
}

export function normalizeProgressSample(positionSeconds, durationSeconds) {
  const position = Number(positionSeconds);
  const duration = Number(durationSeconds);
  if (!Number.isFinite(position) || !Number.isFinite(duration) || position < 0 || duration <= 0) return null;
  const safePosition = Math.min(position, duration);
  return { positionSeconds: safePosition, durationSeconds: duration, completed: safePosition / duration >= 0.9 };
}


/** Keep the imported filename visible; never replace a real local filename with a generic label. */
export function getDisplayVideoTitle(video = {}) {
  const title = String(video.title || '').trim();
  if (title) return title;
  const channel = String(video.channel_title || '').trim();
  if (channel) return channel;
  return video.isLocal || video.file_path ? 'Untitled local video' : 'YouTube video';
}

/** Native Android file pickers report user dismissal as a rejected promise on some versions. */
export function isUserCancelledPicker(error) {
  const message = String(error?.message || error || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();
  return /pickfiles?\s+cancelled?|cancelled? by user|user cancelled|user canceled|operation cancelled|operation canceled/.test(message) ||
    /cancelled|canceled/.test(code);
}
