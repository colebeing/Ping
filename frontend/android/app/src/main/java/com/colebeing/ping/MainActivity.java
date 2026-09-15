package com.colebeing.ping;

import android.os.Bundle;
import android.util.Log;
import com.getcapacitor.BridgeActivity;
import com.google.firebase.appdistribution.FirebaseAppDistribution;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "PingUpdateCheck";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PingAuthPlugin.class);
        super.onCreate(savedInstanceState);
        checkForUpdate();
    }

    @Override
    public void onResume() {
        super.onResume();
        // Re-checked on resume too, per Firebase's own guidance — covers returning to the app after
        // granting the "install unknown apps" permission mid-flow, which onCreate alone would miss.
        checkForUpdate();
    }

    /**
     * A no-op in any build but debug (see app/build.gradle's debugImplementation vs. the always-on
     * -api stub) — App Distribution only ever ships debug builds to testers, so there's nothing to
     * check for anywhere else. When a newer release exists, this shows Firebase's own built-in
     * sign-in/update UI: a concrete "download this build" prompt with a real action, not just a bare
     * notice — the user still has to tap through it (Android doesn't allow a silent background
     * install outside enterprise MDM), but nothing further needs to be built here for that.
     */
    private void checkForUpdate() {
        FirebaseAppDistribution.getInstance()
            .updateIfNewReleaseAvailable()
            .addOnFailureListener(e -> Log.w(TAG, "App Distribution update check failed", e));
    }
}
