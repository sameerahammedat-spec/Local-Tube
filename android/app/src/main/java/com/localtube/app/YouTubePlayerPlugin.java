package com.localtube.app;

import android.content.Intent;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "YouTubePlayer")
public class YouTubePlayerPlugin extends Plugin {

    @PluginMethod
    public void play(PluginCall call) {
        String videoId = call.getString("videoId");
        String title = call.getString("title", "LocalTube");

        if (videoId == null ||
            !videoId.matches("[a-zA-Z0-9_-]{11}")) {
            call.reject("Invalid YouTube video ID.");
            return;
        }

        Intent intent = new Intent(
            getActivity(),
            YouTubePlayerActivity.class
        );

        intent.putExtra("videoId", videoId);
        intent.putExtra("title", title);

        startActivityForResult(
            call,
            intent,
            "handleYouTubePlayerResult"
        );
    }

    @ActivityCallback
    private void handleYouTubePlayerResult(
        PluginCall call,
        ActivityResult result
    ) {
        if (call == null) return;

        Intent data = result.getData();

        if (result.getResultCode() != android.app.Activity.RESULT_OK ||
            data == null) {
            JSObject cancelled = new JSObject();
            cancelled.put("cancelled", true);
            call.resolve(cancelled);
            return;
        }

        JSObject response = new JSObject();

        response.put(
            "videoId",
            data.getStringExtra("videoId")
        );

        response.put(
            "positionSeconds",
            data.getDoubleExtra("positionSeconds", 0)
        );

        response.put(
            "durationSeconds",
            data.getDoubleExtra("durationSeconds", 0)
        );

        response.put(
            "completed",
            data.getBooleanExtra("completed", false)
        );

        response.put("cancelled", false);

        call.resolve(response);
    }
}