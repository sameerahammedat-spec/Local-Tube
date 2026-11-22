
'use strict';

const params = new URLSearchParams(window.location.search);

const type = params.get('type');
const src = params.get('src');
const title = params.get('title') || 'LocalTube Player';
const videoId = Number(params.get('videoId'));
const startSeconds = Math.max(0, Number(params.get('start')) || 0);

const video = document.getElementById('video');
const youtube = document.getElementById('youtube');
const status = document.getElementById('status');
const titleElement = document.getElementById('title');

let youtubePlayer = null;
let progressTimer = null;
let lastSavedAt = 0;
let lastKnownYouTubeProgress = null;

titleElement.textContent = title;

console.log('[LocalTube Player] Initializing:', {
  type,
  src,
  videoId,
  startSeconds
});

function showStatus(message) {
  status.textContent = message;
  status.style.display = 'block';
}

function hideStatus() {
  status.style.display = 'none';
}

function showError(message) {
  console.error('[LocalTube Player]', message);
  showStatus(message);
  video.style.display = 'none';
  youtube.style.display = 'none';
  stopProgressTimer();
}

function saveProgress(position, duration, force = false) {
  if (!Number.isInteger(videoId) || videoId <= 0) return;

  const now = Date.now();

  if (!force && now - lastSavedAt < 1000) return;

  const safePosition = Number(position);
  const safeDuration = Number(duration);
  if (!Number.isFinite(safePosition) || !Number.isFinite(safeDuration) || safeDuration <= 0) return;

  lastSavedAt = now;

  try {
    window.localTubePlayer?.saveProgress?.({
      videoId,
      positionSeconds: Math.max(0, Number(position) || 0),
      durationSeconds: Math.max(0, Number(duration) || 0)
    });
  } catch (error) {
    console.error('[LocalTube Player] Progress save failed:', error);
  }
}

function reportPlayerTime(position) {
  try {
    window.localTubePlayer?.reportTime?.({
      videoId,
      positionSeconds: Math.max(0, Number(position) || 0)
    });
  } catch (error) {
    console.error('[LocalTube Player] Timestamp reporting failed:', error);
  }
}

function stopProgressTimer() {
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
}

function startProgressTimer(callback) {
  stopProgressTimer();
  progressTimer = setInterval(callback, 1000);
}

// ------------------------------------------
// LOCAL VIDEO PLAYER
// ------------------------------------------

function initializeLocalPlayer() {
  if (!src) {
    showError('No local video source was provided.');
    return;
  }

  console.log('[LocalTube Player] Loading local source:', src);

  video.style.display = 'block';
  youtube.style.display = 'none';
  showStatus('Loading local video...');

  video.addEventListener('loadedmetadata', () => {
    console.log('[LocalTube Player] Metadata loaded:', {
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight
    });

    if (
      startSeconds > 0 &&
      Number.isFinite(video.duration) &&
      startSeconds < video.duration
    ) {
      video.currentTime = startSeconds;
    }
  });

  video.addEventListener('loadeddata', () => {
    console.log('[LocalTube Player] Video data loaded.');
    hideStatus();
  });

  video.addEventListener('play', () => {
    startProgressTimer(() => {
      if (!video.paused && !video.ended) {
        saveProgress(video.currentTime, video.duration);
        reportPlayerTime(video.currentTime);
      }
    });
  });

  video.addEventListener('pause', () => {
    stopProgressTimer();
    saveProgress(video.currentTime, video.duration, true);
    reportPlayerTime(video.currentTime);
  });

  video.addEventListener('ended', () => {
    stopProgressTimer();
    saveProgress(video.duration, video.duration, true);
    reportPlayerTime(video.duration);
  });

  video.addEventListener('error', () => {
    const errorCode = video.error?.code || 'unknown';

    showError(
      `Unable to play this video. Media error code: ${errorCode}. Check the file format and file access.`
    );
  });

  video.addEventListener('timeupdate', () => {
    if (!video.paused && !video.ended) {
      reportPlayerTime(video.currentTime);
    }
  });

  window.addEventListener('beforeunload', () => {
    saveProgress(video.currentTime, video.duration, true);
    reportPlayerTime(video.currentTime);
  });

  video.src = src;
  video.load();

  video.play().catch(error => {
    console.warn('[LocalTube Player] Autoplay was blocked:', error);
    // The video controls remain available for manual playback.
  });
}

// ------------------------------------------
// YOUTUBE PLAYER
// ------------------------------------------

function initializeYouTubePlayer() {
  const youtubeVideoId = String(src || '').trim();

  if (!/^[a-zA-Z0-9_-]{11}$/.test(youtubeVideoId)) {
    showError('Invalid YouTube video ID.');
    return;
  }

  console.log('[LocalTube Player] Loading YouTube video:', youtubeVideoId);
  video.style.display = 'none';
  youtube.style.display = 'block';
  showStatus('Loading YouTube player...');

  function captureYouTubeProgress(force = false) {
    if (!youtubePlayer) return;
    try {
      const position = Number(youtubePlayer.getCurrentTime());
      const duration = Number(youtubePlayer.getDuration());

      // YouTube can briefly return 0/NaN while initializing or tearing down.
      // Never overwrite a valid saved position with those transient values.
      if (Number.isFinite(position) && position >= 0 &&
          Number.isFinite(duration) && duration > 0) {
        lastKnownYouTubeProgress = { position, duration };
      }

      if (lastKnownYouTubeProgress) {
        const saved = lastKnownYouTubeProgress;
        saveProgress(saved.position, saved.duration, force);
        reportPlayerTime(saved.position);
      }
    } catch (error) {
      console.warn('[LocalTube Player] Could not capture YouTube progress:', error);
      if (force && lastKnownYouTubeProgress) {
        saveProgress(lastKnownYouTubeProgress.position, lastKnownYouTubeProgress.duration, true);
      }
    }
  }

  window.onYouTubeIframeAPIReady = () => {
    try {
      youtubePlayer = new YT.Player('youtube', {
        videoId: youtubeVideoId,
        playerVars: {
          autoplay: 1,
          controls: 1,
          rel: 0,
          playsinline: 1,
          start: Math.floor(startSeconds),
          enablejsapi: 1,
          origin: 'http://localhost'
        },
        events: {
          onReady: event => {
            console.log('[LocalTube Player] YouTube player ready.');
            hideStatus();
            if (startSeconds > 0) {
              event.target.seekTo(startSeconds, true);
            }
          },
          onStateChange: event => {
            if (event.data === YT.PlayerState.PLAYING) {
              hideStatus();
              startProgressTimer(() => captureYouTubeProgress(false));
            } else {
              stopProgressTimer();
              if (event.data === YT.PlayerState.PAUSED ||
                  event.data === YT.PlayerState.ENDED) {
                captureYouTubeProgress(true);
              }
              if (event.data === YT.PlayerState.ENDED) {
                showStatus('Video completed.');
              }
            }
          },
          onError: event => {
            showError(
              `YouTube playback error (${event.data}). The video may be unavailable or embedding may be disabled.`
            );
          }
        }
      });
    } catch (error) {
      showError(`Could not initialize YouTube player: ${error.message}`);
    }
  };

  const apiScript = document.createElement('script');
  apiScript.src = 'https://www.youtube.com/iframe_api';
  apiScript.onerror = () => {
    showError('Could not load YouTube player API. Check your internet connection.');
  };
  document.head.appendChild(apiScript);

  // pagehide fires for window close as well as normal navigation. The latest
  // valid sample is retained so iframe teardown cannot replace it with zero.
  const persistOnClose = () => captureYouTubeProgress(true);
  window.addEventListener('pagehide', persistOnClose);
  window.addEventListener('beforeunload', persistOnClose);
}

// ------------------------------------------
// INITIALIZE PLAYER
// ------------------------------------------

if (type === 'local') {
  initializeLocalPlayer();
} else if (type === 'youtube') {
  initializeYouTubePlayer();
} else {
  showError(`Unsupported video type: ${type || 'missing'}`);
}

window.addEventListener('error', event => {
  console.error('[LocalTube Player] JavaScript error:', event.message);
});

window.addEventListener('unhandledrejection', event => {
  console.error('[LocalTube Player] Unhandled promise:', event.reason);
});
