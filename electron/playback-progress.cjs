'use strict';

function normalizeProgressPayload(payload = {}) {
  const videoId = Number(payload.videoId);
  const positionSeconds = Number(payload.positionSeconds);
  const durationSeconds = Number(payload.durationSeconds);

  if (!Number.isInteger(videoId) || videoId <= 0 ||
      !Number.isFinite(positionSeconds) || positionSeconds < 0 ||
      !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return null;
  }

  const safePosition = Math.min(positionSeconds, durationSeconds);
  return {
    videoId,
    positionSeconds: safePosition,
    durationSeconds,
    completed: safePosition / durationSeconds >= 0.9 ? 1 : 0
  };
}

function getSafeResumePosition(progress) {
  if (!progress || Number(progress.completed) === 1) return 0;

  const position = Number(progress.position_seconds);
  const duration = Number(progress.duration_seconds);

  if (!Number.isFinite(position) || !Number.isFinite(duration) ||
      position <= 0 || duration <= 0 || position >= duration) {
    return 0;
  }

  return position;
}

module.exports = { normalizeProgressPayload, getSafeResumePosition };
