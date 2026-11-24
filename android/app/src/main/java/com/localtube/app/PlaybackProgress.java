package com.localtube.app;

/** Pure playback calculations shared by the Android player and unit tests. */
public final class PlaybackProgress {
    private PlaybackProgress() {}

    public static boolean isCompleted(long positionMs, long durationMs) {
        return durationMs > 0L && positionMs >= durationMs * 0.9d;
    }

    public static long safeResumePosition(long positionMs, long durationMs) {
        if (positionMs <= 0L || durationMs <= 0L ||
            isCompleted(positionMs, durationMs)) {
            return 0L;
        }
        return Math.min(positionMs, durationMs);
    }
}
