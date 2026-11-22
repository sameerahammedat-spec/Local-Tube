
package com.localtube.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Build;
import android.content.Intent;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.PermissionRequest;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

public class YouTubePlayerActivity extends Activity {

    private WebView webView;
    private TextView statusView;
    private ProgressBar progressBar;

    private String videoId;
    private String videoTitle;
    private double startPositionSeconds = 0;

    private double lastPositionSeconds = 0;
    private double lastDurationSeconds = 0;
    private boolean completed = false;
    private boolean resultSent = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        videoId = getIntent().getStringExtra("videoId");
        videoTitle = getIntent().getStringExtra("title");
        startPositionSeconds = Math.max(0, getIntent().getDoubleExtra("startPositionSeconds", 0));

        if (videoTitle == null || videoTitle.trim().isEmpty()) {
            videoTitle = "LocalTube";
        }

        if (videoId == null ||
            !videoId.matches("[a-zA-Z0-9_-]{11}")) {
            finishWithProgress();
            return;
        }

        if (savedInstanceState != null) {
            lastPositionSeconds =
                savedInstanceState.getDouble("position", 0);
            lastDurationSeconds =
                savedInstanceState.getDouble("duration", 0);
            completed =
                savedInstanceState.getBoolean("completed", false);
            startPositionSeconds = Math.max(0, lastPositionSeconds);
        }

        buildScreen();
        configureWebView();

        webView.loadDataWithBaseURL(
            "https://localhost/",
            buildPlayerHtml(videoId, startPositionSeconds),
            "text/html",
            "UTF-8",
            null
        );
    }

    private void buildScreen() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xFF101010);

        TextView titleView = new TextView(this);
        titleView.setText(videoTitle);
        titleView.setTextColor(0xFFFFFFFF);
        titleView.setTextSize(18);
        titleView.setPadding(18, 16, 18, 12);
        titleView.setMaxLines(2);

        root.addView(titleView, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        statusView = new TextView(this);
        statusView.setText("Connecting to YouTube...");
        statusView.setTextColor(0xFFE0E0E0);
        statusView.setTextSize(14);
        statusView.setGravity(Gravity.CENTER);
        statusView.setPadding(12, 8, 12, 8);

        root.addView(statusView, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        progressBar = new ProgressBar(this);

        root.addView(progressBar, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        webView = new WebView(this);

        root.addView(webView, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            0,
            1
        ));

        setContentView(root);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();

        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);

        webView.addJavascriptInterface(
            new PlayerBridge(),
            "LocalTubeBridge"
        );

        // The embedded player must never create a browser-like browsing surface.
        // Pop-up windows (including YouTube logo links) are always denied.
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onCreateWindow(
                WebView view,
                boolean isDialog,
                boolean isUserGesture,
                android.os.Message resultMsg
            ) {
                return false;
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.deny();
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            private boolean isLocalTubeDocument(String url) {
                if (url == null) return false;
                return url.equals("https://localhost/") ||
                    url.startsWith("https://localhost/");
            }

            private boolean shouldBlockTopLevel(String url) {
                // The top-level document is only the generated LocalTube player.
                // YouTube remains available inside its single-video iframe.
                return !isLocalTubeDocument(url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(
                WebView view,
                WebResourceRequest request
            ) {
                if (!request.isForMainFrame()) {
                    return false; // Allow the embedded YouTube player resources.
                }

                String url = request.getUrl() == null
                    ? ""
                    : request.getUrl().toString();

                if (shouldBlockTopLevel(url)) {
                    android.util.Log.w(
                        "LocalTube",
                        "Blocked top-level player navigation: " + url
                    );
                    updateStatus("Navigation is disabled in LocalTube.");
                    return true;
                }

                return false;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (shouldBlockTopLevel(url)) {
                    android.util.Log.w(
                        "LocalTube",
                        "Blocked legacy player navigation: " + url
                    );
                    updateStatus("Navigation is disabled in LocalTube.");
                    return true;
                }
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (isLocalTubeDocument(url)) {
                    updateStatus("Loading YouTube player...");
                }
            }

            @Override
            public void onReceivedError(
                WebView view,
                WebResourceRequest request,
                WebResourceError error
            ) {
                if (request.isForMainFrame()) {
                    updateStatus(
                        "Unable to load player. Check your internet connection."
                    );

                    runOnUiThread(() -> {
                        if (progressBar != null) {
                            progressBar.setVisibility(View.GONE);
                        }
                    });
                }
            }
        });
    }

    private String buildPlayerHtml(String id, double startSeconds) {
        return "<!doctype html>"
            + "<html><head>"
            + "<meta name='viewport' content='width=device-width,"
            + "initial-scale=1,maximum-scale=1,user-scalable=no'>"
            + "<style>"
            + "html,body{margin:0;padding:0;background:#000;width:100%;height:100%;}"
            + "#player{width:100%;height:100%;}"
            + "</style></head><body>"
            + "<div id='player'></div>"
            + "<script>"
            + "var player;"
            + "var progressTimer=null;"
            + "function report(s){"
            + "try{LocalTubeBridge.onPlayerStatus(String(s));}catch(e){}"
            + "}"
            + "function reportProgress(){"
            + "try{"
            + "if(player&&player.getCurrentTime&&player.getDuration){"
            + "var p=player.getCurrentTime()||0;"
            + "var d=player.getDuration()||0;"
            + "LocalTubeBridge.onProgress(p,d);"
            + "}"
            + "}catch(e){}"
            + "}"
            + "function onYouTubeIframeAPIReady(){"
            + "player=new YT.Player('player',{"
            + "width:'100%',height:'100%',"
            + "videoId:'" + id + "',"
            + "playerVars:{autoplay:0,controls:1,playsinline:1,rel:0,start:" + Math.floor(startSeconds) + ","
            + "fs:1,enablejsapi:1,origin:'https://localhost'},"
            + "events:{"
            + "onReady:function(){"
            + "if(" + Math.floor(startSeconds) + ">0){player.seekTo(" + Math.floor(startSeconds) + ",true);}"
            + "report('ready');"
            + "if(progressTimer===null){"
            + "progressTimer=setInterval(reportProgress,1000);"
            + "}"
            + "},"
            + "onStateChange:function(e){"
            + "reportProgress();"
            + "if(e.data===1)report('playing');"
            + "else if(e.data===2)report('paused');"
            + "else if(e.data===0){"
            + "report('ended');reportProgress();"
            + "}"
            + "},"
            + "onError:function(e){report('error:'+e.data);}"
            + "}"
            + "});"
            + "}"
            + "</script>"
            + "<script src='https://www.youtube.com/iframe_api'></script>"
            + "</body></html>";
    }

    private void updateStatus(String message) {
        runOnUiThread(() -> {
            if (statusView != null) {
                statusView.setText(message);
            }
        });
    }

    private class PlayerBridge {

        @JavascriptInterface
        public void onProgress(double position, double duration) {
            if (Double.isNaN(position) ||
                Double.isInfinite(position) ||
                Double.isNaN(duration) ||
                Double.isInfinite(duration)) {
                return;
            }

            synchronized (YouTubePlayerActivity.this) {
                lastPositionSeconds = Math.max(0, position);
                lastDurationSeconds = Math.max(0, duration);

                if (lastDurationSeconds > 0 &&
                    lastPositionSeconds / lastDurationSeconds >= 0.9) {
                    completed = true;
                }
            }
        }

        @JavascriptInterface
        public void onPlayerStatus(String status) {
            if ("ready".equals(status)) {
                updateStatus("YouTube player ready. Press Play to start.");

                runOnUiThread(() -> {
                    if (progressBar != null) {
                        progressBar.setVisibility(View.GONE);
                    }
                });

            } else if ("playing".equals(status)) {
                updateStatus("Playing");

            } else if ("paused".equals(status)) {
                updateStatus("Paused");

            } else if ("ended".equals(status)) {
                synchronized (YouTubePlayerActivity.this) {
                    completed = true;

                    if (lastDurationSeconds > 0) {
                        lastPositionSeconds = lastDurationSeconds;
                    }
                }

                updateStatus("Video finished");

            } else if (status != null && status.startsWith("error:")) {
                String code = status.substring("error:".length());
                updateStatus(errorMessage(code));

                runOnUiThread(() -> {
                    if (progressBar != null) {
                        progressBar.setVisibility(View.GONE);
                    }
                });
            }
        }
    }

    private String errorMessage(String code) {
        switch (code) {
            case "2":
                return "YouTube rejected the video ID or player request.";
            case "5":
                return "This video cannot be played in the HTML5 player.";
            case "100":
                return "This video is unavailable or has been removed.";
            case "101":
            case "150":
                return "The video owner does not allow embedded playback.";
            case "153":
                return "YouTube requires valid client identification.";
            default:
                return "YouTube playback error (" + code + ").";
        }
    }

    private void finishWithProgress() {
        if (resultSent) return;
        resultSent = true;

        Intent result = new Intent();
        result.putExtra("videoId", videoId);
        result.putExtra("positionSeconds", lastPositionSeconds);
        result.putExtra("durationSeconds", lastDurationSeconds);
        result.putExtra("completed", completed);

        setResult(Activity.RESULT_OK, result);
        finish();
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            finishWithProgress();
            return;
        }

        // evaluateJavascript is asynchronous. Finish only after the JavaScript
        // bridge has delivered the final position to PlayerBridge; otherwise
        // the Activity result can contain the previous one-second checkpoint.
        webView.evaluateJavascript(
            "(function(){try{"
            + "if(player&&player.getCurrentTime&&player.getDuration){"
            + "LocalTubeBridge.onProgress("
            + "player.getCurrentTime()||0,"
            + "player.getDuration()||0);"
            + "}}catch(e){}})();",
            value -> {
                if (webView != null) {
                    webView.stopLoading();
                }
                finishWithProgress();
            }
        );
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        outState.putDouble("position", lastPositionSeconds);
        outState.putDouble("duration", lastDurationSeconds);
        outState.putBoolean("completed", completed);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.loadUrl("about:blank");
            webView.removeJavascriptInterface("LocalTubeBridge");
            webView.destroy();
            webView = null;
        }

        super.onDestroy();
    }
}
