package com.colebeing.ping

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Registered in AndroidManifest.xml to receive all FCM messages instead of the
 * @capacitor/push-notifications plugin's default handling. The backend always sends data-only
 * messages (see backend/src/push.ts sendBlockPush) specifically so this class builds the
 * notification itself — the plugin's default display can't do multi-action buttons or the
 * swap-in-place follow-up flow this needs.
 */
class PingFirebaseMessagingService : FirebaseMessagingService() {
    companion object {
        const val CHANNEL_ID = "ping_checkins"
        const val NOTIFICATION_ID = 1001
    }

    override fun onNewToken(token: String) {
        // The web layer (push-setup.ts) is the source of truth for registration — it fetches a
        // fresh token itself via PushNotifications.register()'s "registration" event and POSTs it
        // to /api/push/register-fcm. Nothing to do here.
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val block = message.data["block"] ?: return
        val title = message.data["title"] ?: "Ping"
        val body = message.data["body"] ?: "Did today go how you wanted?"
        ensureChannel(this)
        showQuestionNotification(this, block, title, body)
    }
}

private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(PingFirebaseMessagingService.CHANNEL_ID) != null) return
    val channel = NotificationChannel(
        PingFirebaseMessagingService.CHANNEL_ID,
        "Check-ins",
        NotificationManager.IMPORTANCE_HIGH,
    )
    manager.createNotificationChannel(channel)
}

private fun actionIntent(context: Context, action: String, extras: Map<String, String>): PendingIntent {
    val intent = Intent(context, NotificationActionReceiver::class.java).apply {
        this.action = action
        for ((key, value) in extras) putExtra(key, value)
    }
    // Distinct request codes so PendingIntents for different actions/categories don't collide and
    // silently overwrite each other's extras.
    val requestCode = extras.values.joinToString("|").hashCode()
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    return PendingIntent.getBroadcast(context, requestCode, intent, flags)
}

fun showQuestionNotification(context: Context, block: String, title: String, body: String) {
    ensureChannel(context)
    val yes = actionIntent(context, NotificationActionReceiver.ACTION_ANSWER, mapOf("block" to block, "answer" to "yes"))
    val no = actionIntent(context, NotificationActionReceiver.ACTION_ANSWER, mapOf("block" to block, "answer" to "no"))

    val notification = NotificationCompat.Builder(context, PingFirebaseMessagingService.CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_dialog_info)
        .setContentTitle(title)
        .setContentText(body)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setAutoCancel(false)
        .setOnlyAlertOnce(false)
        .addAction(0, "Yes", yes)
        .addAction(0, "No", no)
        .build()

    (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
        .notify(PingFirebaseMessagingService.NOTIFICATION_ID, notification)
}

/**
 * Swaps the same notification (yes/no already answered) in for the 4-category WHY follow-up.
 * `answer` and each button's own label are threaded into its PendingIntent's extras so the final
 * confirmation step can render "Logged: Yes — Family" without a second round trip to read them back
 * — /api/followup's response doesn't echo the answer or a display label, only trigger data.
 */
fun showFollowupNotification(context: Context, block: String, answer: String, prompt: String, options: Map<String, String>) {
    ensureChannel(context)
    val builder = NotificationCompat.Builder(context, PingFirebaseMessagingService.CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_dialog_info)
        .setContentTitle(prompt)
        .setContentText("Tap who it was")
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setAutoCancel(false)
        .setOnlyAlertOnce(true)

    // Same order every time (friends/colleagues/family/me) so the buttons don't shuffle between builds.
    for (category in listOf("friends", "colleagues", "family", "me")) {
        val label = options[category] ?: continue
        val extras = mapOf("block" to block, "category" to category, "categoryLabel" to label, "answer" to answer)
        val pending = actionIntent(context, NotificationActionReceiver.ACTION_FOLLOWUP, extras)
        builder.addAction(0, label, pending)
    }

    (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
        .notify(PingFirebaseMessagingService.NOTIFICATION_ID, builder.build())
}

/** Final state after the category is picked — no actions, auto-dismisses on its own. */
fun showConfirmationNotification(context: Context, answerLabel: String, categoryLabel: String) {
    ensureChannel(context)
    val notification = NotificationCompat.Builder(context, PingFirebaseMessagingService.CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_dialog_info)
        .setContentTitle("Logged: $answerLabel")
        .setContentText(categoryLabel)
        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        .setAutoCancel(true)
        .setTimeoutAfter(8000)
        .build()

    (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
        .notify(PingFirebaseMessagingService.NOTIFICATION_ID, notification)
}
