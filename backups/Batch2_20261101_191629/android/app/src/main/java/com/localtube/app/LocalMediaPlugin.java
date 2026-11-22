package com.localtube.app;

import android.net.Uri;
import android.webkit.MimeTypeMap;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.IOException;

@CapacitorPlugin(name = "LocalMedia")
public class LocalMediaPlugin extends Plugin {

    @PluginMethod
    public void copyVideo(PluginCall call) {
        String source = call.getString("uri");
        String requestedName = call.getString("fileName", "video");

        if (source == null || source.trim().isEmpty()) {
            call.reject("A video URI is required.");
            return;
        }

        try {
            Uri sourceUri = Uri.parse(source);
            File videoDirectory = new File(
                getContext().getFilesDir(),
                "LocalTube/videos"
            );

            if (!videoDirectory.exists() && !videoDirectory.mkdirs()) {
                call.reject("Could not create LocalTube video storage.");
                return;
            }

            String safeName = requestedName
                .replaceAll("[^a-zA-Z0-9._-]", "_");

            if (safeName.isEmpty() || safeName.equals(".")) {
                safeName = "video";
            }

            File destination = new File(videoDirectory, safeName);

            String baseName = safeName;
            int dot = safeName.lastIndexOf('.');
            String extension = "";

            if (dot > 0) {
                baseName = safeName.substring(0, dot);
                extension = safeName.substring(dot);
            }

            int suffix = 1;
            while (destination.exists()) {
                destination = new File(
                    videoDirectory,
                    baseName + "_" + suffix + extension
                );
                suffix++;
            }

            long totalBytes = 0;
            byte[] buffer = new byte[64 * 1024];

            try (
                InputStream input = getContext()
                    .getContentResolver()
                    .openInputStream(sourceUri);
                FileOutputStream output = new FileOutputStream(destination)
            ) {
                if (input == null) {
                    call.reject("Android could not open the selected video.");
                    return;
                }

                int bytesRead;
                while ((bytesRead = input.read(buffer)) != -1) {
                    output.write(buffer, 0, bytesRead);
                    totalBytes += bytesRead;
                }

                output.flush();
            } catch (Exception copyError) {
                if (destination.exists()) {
                    destination.delete();
                }
                throw copyError;
            }

            if (totalBytes == 0) {
                destination.delete();
                call.reject("The selected video is empty.");
                return;
            }

            JSObject result = new JSObject();
            result.put("path", destination.getAbsolutePath());
            result.put("fileName", destination.getName());
            result.put("size", totalBytes);

            call.resolve(result);

        } catch (Exception error) {
            call.reject("Video import failed: " + error.getMessage(), error);
        }
    }
}
