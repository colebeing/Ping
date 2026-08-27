package com.colebeing.ping

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Holds the long-lived device token the backend mints when the app registers its FCM token
 * (see /api/push/register-fcm). Encrypted at rest since it authenticates as the full user
 * identity with no expiry — read by NotificationActionReceiver, written by PingAuthPlugin.
 */
object DeviceTokenStore {
    private const val FILE_NAME = "ping_device_token"
    private const val KEY = "device_token"

    private fun prefs(context: Context): SharedPreferences {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            context,
            FILE_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    fun store(context: Context, token: String) {
        prefs(context).edit().putString(KEY, token).apply()
    }

    fun read(context: Context): String? {
        return prefs(context).getString(KEY, null)
    }
}
