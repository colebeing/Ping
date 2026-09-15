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
        const val ACTION_RECOMMENDATION = "com.colebeing.ping.ACTION_RECOMMENDATION"

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
                    ACTION_RECOMMENDATION -> handleRecommendation(appContext, intent)
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
        val response = post(context, "/api/answer", body)
        // TEMPORARY: diagnosing a real-device report of blank follow-up category buttons that couldn't
        // be reproduced from server-side data alone — remove once resolved.
        android.util.Log.d("PingFollowupDebug", "raw /api/answer response: $response")
        if (response == null) return

        val followup = response.optJSONObject("followup")
        android.util.Log.d("PingFollowupDebug", "followup object: $followup")
        if (followup == null) return
        val prompt = followup.optString("prompt", "Who was it?")
        val optionsJson = followup.optJSONObject("options") ?: JSONObject()
        val options = mutableMapOf<String, String>()
        for (key in optionsJson.keys()) options[key] = optionsJson.getString(key)
        android.util.Log.d("PingFollowupDebug", "parsed options map: $options")

        showFollowupNotification(context, block, answer, prompt, options)
    }

    private fun handleFollowup(context: Context, intent: Intent) {
        val block = intent.getStringExtra("block") ?: return
        val category = intent.getStringExtra("category") ?: return
        val categoryLabel = intent.getStringExtra("categoryLabel") ?: category
        val answer = intent.getStringExtra("answer") ?: ""

        val body = JSONObject().put("block", block).put("category", category)
        val response = post(context, "/api/followup", body) ?: return

        // A streak just crossed threshold for THIS block — swap straight into the invite's own yes/no
        // confirmation instead of the plain "Logged" state, so a native install never needs the app
        // opened to resolve it (unlike Chrome push, where the user's already in the app for the
        // follow-up anyway). At most one recommendation is ever proposed per block per call.
        val recommendation = findRecommendationForBlock(response, block)
        if (recommendation != null) {
            showRecommendationNotification(
                context,
                recommendation.id,
                recommendation.inviteQuestion,
                recommendation.digInPrompt,
                recommendation.digInOptions,
            )
        } else {
            val answerLabel = if (answer == "yes") "Yes" else "No"
            showConfirmationNotification(context, answerLabel, categoryLabel)
        }
    }

    /** `digInOptions` pairs each non-blank option with its ORIGINAL slot index (0-3) — the index the
     * backend's digIn.options array expects back, not the filtered list's own position. */
    private data class RecommendationInfo(
        val id: String,
        val inviteQuestion: String,
        val digInPrompt: String?,
        val digInOptions: List<Pair<Int, String>>?,
    )

    private fun findRecommendationForBlock(response: JSONObject, block: String): RecommendationInfo? {
        val recs = response.optJSONArray("newRecommendations") ?: return null
        for (i in 0 until recs.length()) {
            val rec = recs.getJSONObject(i)
            if (rec.optString("block") != block) continue
            val id = rec.optString("id").takeIf { it.isNotEmpty() } ?: continue
            val node = rec.optJSONObject("node") ?: continue
            val inviteQuestion = node.optString("inviteQuestion").takeIf { it.isNotEmpty() } ?: continue
            val digIn = node.optJSONObject("digIn")
            val digInPrompt = digIn?.optString("prompt")?.takeIf { it.isNotEmpty() }
            val digInOptions = digIn?.optJSONArray("options")?.let { opts ->
                (0 until opts.length()).mapNotNull { idx ->
                    opts.optJSONObject(idx)?.optString("label")?.takeIf { it.isNotEmpty() }?.let { idx to it }
                }
            }
            return RecommendationInfo(id, inviteQuestion, digInPrompt, digInOptions)
        }
        return null
    }

    private fun handleRecommendation(context: Context, intent: Intent) {
        val recommendationId = intent.getStringExtra("recommendationId") ?: return
        val accept = intent.getBooleanExtra("accept", false)
        val digInChoice = if (intent.hasExtra("digInChoice")) intent.getIntExtra("digInChoice", -1) else null

        if (accept && digInChoice == null && intent.hasExtra("digInPrompt")) {
            // "Yes" tapped on an invite whose node has its own follow-up — show the chooser instead of
            // accepting yet; the actual accept only happens once a specific option is picked below.
            val prompt = intent.getStringExtra("digInPrompt") ?: return
            val options = (0..3).mapNotNull { idx -> intent.getStringExtra("digInLabel$idx")?.let { idx to it } }
            showRecommendationDigInNotification(context, recommendationId, prompt, options)
            return
        }

        val path = "/api/recommendations/$recommendationId/${if (accept) "accept" else "decline"}"
        val body = JSONObject()
        if (digInChoice != null) body.put("digInChoice", digInChoice)
        post(context, path, body) ?: return
        showRecommendationConfirmationNotification(context, accept)
    }

    /** Returns the parsed JSON body on success (2xx), or null on any failure — callers just leave the notification as-is. */
    private fun post(context: Context, path: String, body: JSONObject): JSONObject? {
        val deviceToken = DeviceTokenStore.read(context)
        android.util.Log.d("PingFollowupDebug", "post $path, deviceToken present: ${deviceToken != null}")
        if (deviceToken == null) return null
        val connection = URL("$API_BASE$path").openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Authorization", "Bearer $deviceToken")
            connection.outputStream.use { it.write(body.toString().toByteArray()) }

            android.util.Log.d("PingFollowupDebug", "$path responded with status ${connection.responseCode}")
            if (connection.responseCode !in 200..299) return null
            val text = connection.inputStream.bufferedReader().use { it.readText() }
            JSONObject(text)
        } catch (err: Exception) {
            android.util.Log.e("PingFollowupDebug", "post $path threw", err)
            err.printStackTrace()
            null
        } finally {
            connection.disconnect()
        }
    }
}
