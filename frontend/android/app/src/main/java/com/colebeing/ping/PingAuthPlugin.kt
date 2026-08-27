package com.colebeing.ping

import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Local, unpublished plugin — just a JS-to-native handoff for the device token returned by
 * /api/push/register-fcm. Not distributed via npm; registered directly in MainActivity.
 */
@CapacitorPlugin(name = "PingAuth")
class PingAuthPlugin : Plugin() {
    @PluginMethod
    fun storeDeviceToken(call: PluginCall) {
        val value = call.getString("value")
        if (value.isNullOrEmpty()) {
            call.reject("value is required")
            return
        }
        DeviceTokenStore.store(context, value)
        call.resolve()
    }
}
