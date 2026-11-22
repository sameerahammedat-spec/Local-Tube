
const params = new URLSearchParams(window.location.search);

const type = params.get('type');
const src = params.get('src');
const title = params.get('title') || 'LocalTube Player';

const video = document.getElementById('video');
const youtube = document.getElementById('youtube');
const status = document.getElementById('status');
const titleElement = document.getElementById('title');

titleElement.textContent = title;

function showError(message) {
  status.textContent = message;
  status.style.display = 'block';
  video.style.display = 'none';
  youtube.style.display = 'none';
}

if (type === 'local' && src) {
  video.style.display = 'block';
  status.style.display = 'none';

  video.src = src;

  video.addEventListener('error', () => {
    showError('Unable to play this local video. Check whether the file exists and is supported.');
  });

  video.play().catch(() => {
    // User can start playback using the local video controls.
  });

} else if (type === 'youtube' && src) {
  const videoId = src.trim();

  // Accept only a YouTube video ID, never a URL.
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    showError('Invalid YouTube video ID.');
  } else {
    youtube.style.display = 'block';
    status.style.display = 'none';

    // Official embedded player, with unnecessary navigation controls reduced.
    youtube.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');

    youtube.src =
      `https://www.youtube-nocookie.com/embed/${videoId}` +
      '?autoplay=1&controls=1&modestbranding=1&rel=0' +
      '&fs=0&disablekb=1&iv_load_policy=3&playsinline=1';
  }

} else {
  showError('No playable video source was provided.');
}
