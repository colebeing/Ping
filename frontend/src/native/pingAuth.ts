import { registerPlugin } from "@capacitor/core";

interface PingAuthPlugin {
  storeDeviceToken(options: { value: string }): Promise<void>;
}

// Backed by android/app/src/main/java/com/colebeing/ping/PingAuthPlugin.kt — a local, unpublished
// plugin, not an npm package. On web (no native implementation registered) calls just reject, which
// callers only ever reach after already checking Capacitor.isNativePlatform().
export const PingAuth = registerPlugin<PingAuthPlugin>("PingAuth");
