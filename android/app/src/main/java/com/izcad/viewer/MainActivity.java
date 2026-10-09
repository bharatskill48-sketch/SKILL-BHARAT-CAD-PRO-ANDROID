package com.izcad.viewer;

import android.os.Bundle;
import android.content.Intent;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(IncomingDrawingPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        // Keep the most recent file intent for Android activity recreation.
        if (intent != null) {
            setIntent(intent);
        }
        super.onNewIntent(intent);
    }
}
