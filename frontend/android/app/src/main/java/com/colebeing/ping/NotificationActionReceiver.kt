package com.colebeing.ping

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Handles a tap on one of the notification's action buttons. Runs the network call on a
 * background thread via goAsync() — onReceive() itself must return immediately, and this needs to
 * keep working even if the app process isn't currently alive.
 *
 * Mirrors what frontend/public/sw.js's notificationclick handler does for Web Push, plus the
 * second hop (the 4-option WHY follow-up) the browser's 2-action cap can't fit.
 */
class NotificationActionReceiver : BroadcastReceiver() {
    companion object {
        const val ACTION_ANSWER = "com.colebeing.ping.ACTION_ANSWER"
        const val ACTION_FOLLOWUP = "com.colebeing.ping.ACTION_FOLLOWUP"

        // Keep in sync with frontend/public/sw.js's API_BASE.
        private const val API_BASE = "https://ping-backend.colebeing.workers.dev"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val pendingResult = goAsync()
        val appContext = context.applicationContext
        Thread {
            try {
                when (intent.action) {
                    ACTION_ANSWER -> handleAnswer(appContext, intent)
                    ACTION_FOLLOWUP -> handleFollowup(appContext, intent)
                }
            } catch (err: Exception) {
                // Best-effort — the notification just stays as-is; the user can still open the app.
                err.printStackTrace()
            } finally {
                pendingResult.finish()
            }
        }.start()
    }

    private fun handleAnswer(context: Context, intent: Intent) {
        val block = intent.getStringExtra("block") ?: return
        val answer = intent.getStringExtra("answer") ?: return

        val body = JSONObject().put("block", block).put("answer", answer)
        val response = post(context, "/api/answer", body) ?: return

        val followup = response.optJSONObject("followup") ?: return
        val prompt = followup.optString("prompt", "Who was it?")
        val optionsJson = followup.optJSONObject("options") ?: JSONObject()
        val options = mutableMapOf<String, String>()
        for (key in optionsJson.keys()) options[key] = optionsJson.getString(key)

        showFollowupNotification(context, block, answer, prompt, options)
    }

    private fun handleFollowup(context: Context, intent: Intent) {
        val block = intent.getStringExtra("block") ?: return
        val category = intent.getStringExtra("category") ?: return
        val categoryLabel = intent.getStringExtra("categoryLabel") ?: category
        val answer = intent.getStringExtra("answer") ?: ""

        val body = JSONObject().put("block", block).put("category", category)
        post(context, "/api/followup", body) ?: return

        val answerLabel = if (answer == "yes") "Yes" else "No"
        showConfirmationNotification(context, answerLabel, categoryLabel)
    }

    /** Returns the parsed JSON body on success (2xx), or null on any failure — callers just leave the notification as-is. */
    private fun post(context: Context, path: String, body: JSONObject): JSONObject? {
        val deviceToken = DeviceTokenStore.read(context) ?: return null
        val connection = URL("$API_BASE$path").openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Authorization", "Bearer $deviceToken")
            connection.outputStream.use { it.write(body.toString().toByteArray()) }

            if (connection.responseCode !in 200..299) return null
            val text = connection.inputStream.bufferedReader().use { it.readText() }
            JSONObject(text)
        } catch (err: Exception) {
            err.printStackTrace()
            null
        } finally {
            connection.disconnect()
        }
    }
}
