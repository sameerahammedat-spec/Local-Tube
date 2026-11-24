
package com.localtube.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.media.MediaMetadataRetriever;
import android.net.Uri;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

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

        File destination = null;

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

            String safeName = requestedName.replaceAll(
                "[^a-zA-Z0-9._-]",
                "_"
            );

            if (safeName.isEmpty() || safeName.equals(".")) {
                safeName = "video";
            }

            destination = new File(videoDirectory, safeName);

            String baseName = safeName;
            String extension = "";

            int dot = safeName.lastIndexOf('.');

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
                FileOutputStream output =
                    new FileOutputStream(destination)
            ) {
                if (input == null) {
                    throw new IOException(
                        "Android could not open the selected video."
                    );
                }

                int bytesRead;

                while ((bytesRead = input.read(buffer)) != -1) {
                    output.write(buffer, 0, bytesRead);
                    totalBytes += bytesRead;
                }

                output.flush();
            }

            if (totalBytes == 0) {
                destination.delete();
                call.reject("The selected video is empty.");
                return;
            }

            JSObject response = new JSObject();
            response.put("path", destination.getAbsolutePath());
            response.put("fileName", destination.getName());
            response.put("size", totalBytes);

            call.resolve(response);

        } catch (Exception error) {
            if (destination != null && destination.exists()) {
                destination.delete();
            }

            call.reject(
                "Video import failed: " + error.getMessage(),
                error
            );
        }
    }


    @PluginMethod
    public void createThumbnail(PluginCall call) {
        String sourcePath = call.getString("path");

        if (sourcePath == null || sourcePath.trim().isEmpty()) {
            call.reject("A local video path is required.");
            return;
        }

        File source = new File(sourcePath);
        if (!source.isFile() || !source.canRead()) {
            call.reject("The local video file is not readable.");
            return;
        }

        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        Bitmap frame = null;

        try {
            retriever.setDataSource(source.getAbsolutePath());
            try {
                frame = retriever.getFrameAtTime(
                    1_000_000L,
                    MediaMetadataRetriever.OPTION_CLOSEST_SYNC
                );
            } catch (Exception ignored) {
                // Some containers do not support seeking to a one-second frame.
            }

            if (frame == null) {
                frame = retriever.getFrameAtTime();
            }

            if (frame == null) {
                throw new IOException("No video frame could be decoded.");
            }

            File thumbnailDirectory = new File(
                getContext().getFilesDir(),
                "LocalTube/thumbnails"
            );

            if (!thumbnailDirectory.exists() && !thumbnailDirectory.mkdirs()) {
                throw new IOException("Could not create thumbnail cache.");
            }

            String cacheKey = Integer.toHexString(
                (source.getAbsolutePath() + ":" + source.length() + ":" + source.lastModified()).hashCode()
            );
            File outputFile = new File(thumbnailDirectory, cacheKey + ".jpg");

            if (!outputFile.isFile() || outputFile.length() == 0) {
                int maxWidth = 640;
                int maxHeight = 360;
                float scale = Math.min(
                    1f,
                    Math.min(
                        (float) maxWidth / frame.getWidth(),
                        (float) maxHeight / frame.getHeight()
                    )
                );

                int width = Math.max(1, Math.round(frame.getWidth() * scale));
                int height = Math.max(1, Math.round(frame.getHeight() * scale));
                Bitmap scaled = Bitmap.createScaledBitmap(frame, width, height, true);

                try (FileOutputStream output = new FileOutputStream(outputFile)) {
                    if (!scaled.compress(Bitmap.CompressFormat.JPEG, 84, output)) {
                        throw new IOException("Could not encode video thumbnail.");
                    }
                    output.flush();
                }

                if (scaled != frame) {
                    scaled.recycle();
                }
            }

            JSObject response = new JSObject();
            response.put("path", outputFile.getAbsolutePath());
            call.resolve(response);

        } catch (Exception error) {
            call.reject(
                "Could not generate video thumbnail: " + error.getMessage(),
                error
            );
        } finally {
            try {
                retriever.release();
            } catch (Exception ignored) {
            }
            if (frame != null && !frame.isRecycled()) {
                frame.recycle();
            }
        }
    }

    @PluginMethod
    public void fileExists(PluginCall call) {
        String path = call.getString("path");

        boolean exists = false;

        if (path != null && !path.trim().isEmpty()) {
            File file = new File(path);
            exists = file.exists() && file.isFile() && file.canRead();
        }

        JSObject response = new JSObject();
        response.put("exists", exists);

        call.resolve(response);
    }

    @PluginMethod
    public void exportText(PluginCall call) {
        String fileName = call.getString(
            "fileName",
            "LocalTube-Notes.txt"
        );

        String content = call.getString("content", "");

        if (fileName == null || fileName.trim().isEmpty()) {
            fileName = "LocalTube-Notes.txt";
        }

        fileName = fileName.replaceAll(
            "[\\\\/:*?\"<>|]",
            "_"
        );

        if (!fileName.toLowerCase().endsWith(".txt")) {
            fileName += ".txt";
        }

        // Preserve content in the PluginCall before launching
        // Android's document picker.
        call.getData().put("content", content);

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("text/plain");
        intent.putExtra(Intent.EXTRA_TITLE, fileName);

        startActivityForResult(
            call,
            intent,
            "handleNotesExportResult"
        );
    }

    @ActivityCallback
    private void handleNotesExportResult(
        PluginCall call,
        ActivityResult result
    ) {
        if (call == null) {
            return;
        }

        if (result.getResultCode() != Activity.RESULT_OK ||
            result.getData() == null ||
            result.getData().getData() == null) {

            JSObject response = new JSObject();
            response.put("canceled", true);

            call.resolve(response);
            return;
        }

        Uri uri = result.getData().getData();

        String content = call.getString("content", "");

        try (
            OutputStream output = getContext()
                .getContentResolver()
                .openOutputStream(uri, "wt")
        ) {
            if (output == null) {
                call.reject("Could not open the selected text file.");
                return;
            }

            output.write(
                content.getBytes(StandardCharsets.UTF_8)
            );

            output.flush();

            JSObject response = new JSObject();
            response.put("canceled", false);
            response.put("filePath", uri.toString());
            response.put("fileName", uri.getLastPathSegment());

            call.resolve(response);

        } catch (Exception error) {
            call.reject(
                "Could not export notes: " + error.getMessage(),
                error
            );
        }
    }
}
