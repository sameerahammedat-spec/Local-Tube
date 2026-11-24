package com.localtube.app;

import com.getcapacitor.BridgeActivity;
import androidx.core.splashscreen.SplashScreen;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        registerPlugin(LocalMediaPlugin.class);
        registerPlugin(LocalPlayerPlugin.class);
        registerPlugin(YouTubePlayerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
