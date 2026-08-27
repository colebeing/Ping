package com.colebeing.ping;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PingAuthPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
