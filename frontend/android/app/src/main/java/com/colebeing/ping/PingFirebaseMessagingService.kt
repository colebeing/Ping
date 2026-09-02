package com.colebeing.ping

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

// Matches the web app's --accent CSS variable — chosen there for contrast against its own dark
// background, which happens to match most notification shades (light or dark, on this and other
// OEM skins) far better than the ambient button styles' resolved colors did.
private val BUTTON_TEXT_COLOR = Color.parseColor("#6ea8fe")

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

/**
 * Custom-view Yes/No buttons rather than NotificationCompat.addAction() — a plain 2-action
 * notification wasn't reliably showing its actions inline without an expand tap on this OEM skin,
 * so this uses the same known-working pattern as the WHY follow-up below: the same compact row
 * for both the collapsed and expanded slot, so both buttons are visible immediately.
 */
fun showQuestionNotification(context: Context, block: String, title: String, body: String) {
    ensureChannel(context)
    val yes = actionIntent(context, NotificationActionReceiver.ACTION_ANSWER, mapOf("block" to block, "answer" to "yes"))
    val no = actionIntent(context, NotificationActionReceiver.ACTION_ANSWER, mapOf("block" to block, "answer" to "no"))

    fun buildButtonRow(): RemoteViews {
        val view = RemoteViews(context.packageName, R.layout.notification_yesno_buttons)
        view.setTextViewText(R.id.yesno_title, body)
        view.setOnClickPendingIntent(R.id.yesno_btn_yes, yes)
        view.setOnClickPendingIntent(R.id.yesno_btn_no, no)
        view.setTextColor(R.id.yesno_btn_yes, BUTTON_TEXT_COLOR)
        view.setTextColor(R.id.yesno_btn_no, BUTTON_TEXT_COLOR)
        return view
    }

    val notification = NotificationCompat.Builder(context, PingFirebaseMessagingService.CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_dialog_info)
        .setContentTitle(title)
        .setStyle(NotificationCompat.DecoratedCustomViewStyle())
        .setCustomContentView(buildButtonRow())
        .setCustomBigContentView(buildButtonRow())
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setAutoCancel(false)
        .setOnlyAlertOnce(false)
        .build()

    (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
        .notify(PingFirebaseMessagingService.NOTIFICATION_ID, notification)
}

/**
 * Swaps the same notification (yes/no already answered) in for the 4-category WHY follow-up.
 *
 * Uses a custom RemoteViews layout instead of NotificationCompat.addAction() — the standard
 * action row only reliably renders about 3 buttons before the platform starts silently dropping
 * the rest, which isn't enough for all 4 categories. The prompt text is drawn inside that same
 * view (not via setContentTitle) since DecoratedCustomViewStyle's own title chrome wasn't
 * reliably rendering above the custom content on device.
 *
 * The SAME compact single-row layout is used for both the collapsed and expanded view (built as
 * two separate RemoteViews instances, since each slot needs its own), so all 4 buttons are visible
 * immediately — nothing extra to reveal, no "expand for options" tap required.
 *
 * `answer` and each button's own label are threaded into its PendingIntent's extras so the final
 * confirmation step can render "Logged: Yes — Family" without a second round trip to read them back
 * — /api/followup's response doesn't echo the answer or a display label, only trigger data.
 */
fun showFollowupNotification(context: Context, block: String, answer: String, prompt: String, options: Map<String, String>) {
    ensureChannel(context)

    // Same order every time (friends/colleagues/family/me) so the buttons don't shuffle between builds.
    val categories = listOf("friends", "colleagues", "family", "me")
    val buttonIds = listOf(R.id.followup_btn1, R.id.followup_btn2, R.id.followup_btn3, R.id.followup_btn4)

    fun buildButtonRow(): RemoteViews {
        val view = RemoteViews(context.packageName, R.layout.notification_followup_buttons)
        view.setTextViewText(R.id.followup_title, prompt)
        for ((category, buttonId) in categories.zip(buttonIds)) {
            val label = options[category] ?: continue
            val extras = mapOf("block" to block, "category" to category, "categoryLabel" to label, "answer" to answer)
            val pending = actionIntent(context, NotificationActionReceiver.ACTION_FOLLOWUP, extras)
            view.setTextViewText(buttonId, label)
            view.setTextColor(buttonId, BUTTON_TEXT_COLOR)
            view.setOnClickPendingIntent(buttonId, pending)
        }
        return view
    }

    val notification = NotificationCompat.Builder(context, PingFirebaseMessagingService.CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_dialog_info)
        .setContentTitle(prompt)
        .setStyle(NotificationCompat.DecoratedCustomViewStyle())
        .setCustomContentView(buildButtonRow())
        .setCustomBigContentView(buildButtonRow())
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setAutoCancel(false)
        .setOnlyAlertOnce(true)
        .build()

    (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
        .notify(PingFirebaseMessagingService.NOTIFICATION_ID, notification)
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
