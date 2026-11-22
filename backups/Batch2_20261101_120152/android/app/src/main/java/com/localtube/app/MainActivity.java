package com.localtube.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(LocalMediaPlugin.class);
        registerPlugin(LocalPlayerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
