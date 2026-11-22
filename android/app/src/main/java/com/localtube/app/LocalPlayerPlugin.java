package com.localtube.app;

import android.content.Intent;
import android.text.TextUtils;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

@CapacitorPlugin(name = "LocalPlayer")
public class LocalPlayerPlugin extends Plugin {

    private static final String PREFS = "localtube_playback";

    @PluginMethod
    public void play(PluginCall call) {
        String path = call.getString("path");
        String title = call.getString("title", "LocalTube");
        String videoId = call.getString("videoId");
        long resumePositionMs = call.getLong("resumePositionMs", 0L);

        if (TextUtils.isEmpty(path)) {
            call.reject("Video path is missing.");
            return;
        }

        if (TextUtils.isEmpty(videoId)) {
            call.reject("Video ID is missing.");
            return;
        }

        File videoFile = new File(path);

        if (!videoFile.exists() || !videoFile.isFile()) {
            call.reject("The imported video file could not be found.");
            return;
        }

        try {
            Intent intent = new Intent(getActivity(), LocalPlayerActivity.class);

            intent.putExtra("videoPath", videoFile.getAbsolutePath());
            intent.putExtra("videoTitle", title);
            intent.putExtra("videoId", videoId);
            intent.putExtra("resumePositionMs", Math.max(0L, resumePositionMs));

            startActivityForResult(call, intent, "handlePlayerResult");
        } catch (Exception error) {
            call.reject("Could not open the native video player: " + error.getMessage(), error);
        }
    }

    @PluginMethod
    public void getCheckpoint(PluginCall call) {
        String videoId = call.getString("videoId");

        if (TextUtils.isEmpty(videoId)) {
            call.reject("Video ID is missing.");
            return;
        }

        android.content.SharedPreferences prefs =
            getContext().getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE);

        long position = prefs.getLong("position_" + videoId, 0L);
        long duration = prefs.getLong("duration_" + videoId, 0L);

        if (duration > 0L && position >= duration * 0.9) {
            position = 0L;
        }

        JSObject response = new JSObject();
        response.put("positionMs", position);
        response.put("durationMs", duration);
        call.resolve(response);
    }

    @PluginMethod
    public void clearCheckpoint(PluginCall call) {
        String videoId = call.getString("videoId");

        if (TextUtils.isEmpty(videoId)) {
            call.reject("Video ID is missing.");
            return;
        }

        android.content.SharedPreferences prefs =
            getContext().getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE);

        prefs.edit()
            .remove("position_" + videoId)
            .remove("duration_" + videoId)
            .apply();

        call.resolve();
    }

    @ActivityCallback
    private void handlePlayerResult(PluginCall call, ActivityResult result) {
        if (call == null) return;

        Intent data = result.getData();

        if (data == null) {
            call.resolve();
            return;
        }

        String videoId = data.getStringExtra("videoId");
        long positionMs = Math.max(0L, data.getLongExtra("positionMs", 0L));
        long durationMs = Math.max(0L, data.getLongExtra("durationMs", 0L));

        JSObject response = new JSObject();
        response.put("videoId", videoId);
        response.put("positionSeconds", positionMs / 1000.0);
        response.put("durationSeconds", durationMs / 1000.0);
        response.put("completed", durationMs > 0L && positionMs >= durationMs * 0.9);

        call.resolve(response);
    }
}