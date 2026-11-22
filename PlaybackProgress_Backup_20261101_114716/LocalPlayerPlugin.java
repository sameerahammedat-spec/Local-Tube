package com.localtube.app;

import android.content.Intent;
import android.text.TextUtils;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

@CapacitorPlugin(name = "LocalPlayer")
public class LocalPlayerPlugin extends Plugin {

    @PluginMethod
    public void play(PluginCall call) {
        String path = call.getString("path");
        String title = call.getString("title", "LocalTube");

        if (TextUtils.isEmpty(path)) {
            call.reject("Video path is missing.");
            return;
        }

        File videoFile = new File(path);

        if (!videoFile.exists() || !videoFile.isFile()) {
            call.reject("The imported video file could not be found.");
            return;
        }

        try {
            Intent intent = new Intent(
                getActivity(),
                LocalPlayerActivity.class
            );

            intent.putExtra("videoPath", videoFile.getAbsolutePath());
            intent.putExtra("videoTitle", title);

            getActivity().startActivity(intent);

            call.resolve();
        } catch (Exception error) {
            call.reject(
                "Could not open the native video player: " +
                error.getMessage(),
                error
            );
        }
    }
}
