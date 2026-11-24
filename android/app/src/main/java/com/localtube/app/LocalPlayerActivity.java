package com.localtube.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.graphics.Color;

import androidx.appcompat.app.AppCompatActivity;
import androidx.media3.common.MediaItem;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;

import java.io.File;

public class LocalPlayerActivity extends AppCompatActivity {

    private static final String PREFS = "localtube_playback";

    private ExoPlayer player;
    private PlayerView playerView;

    private final Handler progressHandler = new Handler(Looper.getMainLooper());

    private String videoId;
    private long lastPositionMs = 0L;
    private long lastDurationMs = 0L;
    private boolean resultSent = false;

    private final Runnable checkpointRunnable = new Runnable() {
        @Override
        public void run() {
            saveCheckpoint();
            progressHandler.postDelayed(this, 5000L);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        String path = getIntent().getStringExtra("videoPath");
        String title = getIntent().getStringExtra("videoTitle");
        videoId = getIntent().getStringExtra("videoId");

        long resumePositionMs =
            getIntent().getLongExtra("resumePositionMs", 0L);

        if (path == null || path.trim().isEmpty() || videoId == null) {
            setResult(RESULT_CANCELED);
            finish();
            return;
        }

        File videoFile = new File(path);

        if (!videoFile.exists() || !videoFile.isFile()) {
            setResult(RESULT_CANCELED);
            finish();
            return;
        }

        getWindow().setStatusBarColor(Color.BLACK);
        getWindow().setNavigationBarColor(Color.BLACK);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        playerView = new PlayerView(this);
        playerView.setUseController(true);
        playerView.setControllerAutoShow(true);
        playerView.setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING);

        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        );

        root.addView(playerView, params);
        setContentView(root);

        setTitle(title == null ? "LocalTube" : title);

        player = new ExoPlayer.Builder(this).build();
        playerView.setPlayer(player);

        player.setMediaItem(MediaItem.fromUri(Uri.fromFile(videoFile)));
        player.prepare();

        if (resumePositionMs > 0L) {
            player.seekTo(resumePositionMs);
        }

        player.play();

        progressHandler.postDelayed(checkpointRunnable, 5000L);
    }

    private void saveCheckpoint() {
        if (player == null || videoId == null) return;

        long position = Math.max(0L, player.getCurrentPosition());
        long duration = Math.max(0L, player.getDuration());

        // Keep the actual playback position for the result returned to SQLite.
        // Only reset the stored resume checkpoint after completion.
        lastPositionMs = position;
        lastDurationMs = duration;

        position = PlaybackProgress.safeResumePosition(position, duration);

        SharedPreferences prefs =
            getSharedPreferences(PREFS, Context.MODE_PRIVATE);

        prefs.edit()
            .putLong("position_" + videoId, position)
            .putLong("duration_" + videoId, duration)
            .apply();
    }

    private void returnPlaybackResult() {
        if (resultSent) return;

        saveCheckpoint();
        resultSent = true;

        Intent result = new Intent();
        result.putExtra("videoId", videoId);
        result.putExtra("positionMs", lastPositionMs);
        result.putExtra("durationMs", lastDurationMs);

        setResult(RESULT_OK, result);
    }

    @Override
    protected void onPause() {
        saveCheckpoint();

        if (player != null) {
            player.pause();
        }

        super.onPause();
    }

    @Override
    public void finish() {
        returnPlaybackResult();
        super.finish();
    }

    @Override
    protected void onDestroy() {
        progressHandler.removeCallbacks(checkpointRunnable);
        returnPlaybackResult();

        if (playerView != null) {
            playerView.setPlayer(null);
        }

        if (player != null) {
            player.release();
            player = null;
        }

        super.onDestroy();
    }
}