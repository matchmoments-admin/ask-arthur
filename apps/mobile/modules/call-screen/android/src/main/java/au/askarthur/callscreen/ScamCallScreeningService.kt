package au.askarthur.callscreen

import android.net.Uri
import android.os.Build
import android.telecom.Call
import android.telecom.CallScreeningService
import android.util.Log
import java.security.MessageDigest

/**
 * Android CallScreeningService that checks incoming calls against
 * the local offline SQLite database for known scam numbers.
 *
 * Must respond within 5 seconds (system timeout).
 */
class ScamCallScreeningService : CallScreeningService() {

    companion object {
        private const val TAG = "ArthurCallScreen"
    }

    override fun onScreenCall(callDetails: Call.Details) {
        val handle = callDetails.handle
        if (handle == null || handle.scheme != "tel") {
            respondAllow(callDetails)
            return
        }

        val phoneNumber = handle.schemeSpecificPart
        if (phoneNumber.isNullOrBlank()) {
            respondAllow(callDetails)
            return
        }

        // Hash the phone number for privacy-preserving lookup
        val phoneHash = hashPhone(phoneNumber)

        // Query the offline SQLite database
        // Note: This runs on the main thread with a 5-second deadline
        try {
            val db = android.database.sqlite.SQLiteDatabase.openDatabase(
                "${applicationContext.filesDir}/SQLite/arthur_threats.db",
                null,
                android.database.sqlite.SQLiteDatabase.OPEN_READONLY
            )

            val cursor = db.rawQuery(
                "SELECT threat_level FROM phone_reputation WHERE phone_hash = ? AND active = 1",
                arrayOf(phoneHash)
            )

            if (cursor.moveToFirst()) {
                val threatLevel = cursor.getString(0)
                cursor.close()
                db.close()

                if (threatLevel == "HIGH") {
                    Log.i(TAG, "Blocking HIGH-risk call from hashed number")
                    respondReject(callDetails)
                    return
                }
            } else {
                cursor.close()
            }
            db.close()
        } catch (e: Exception) {
            // Database not available — allow the call through
            Log.w(TAG, "Offline DB query failed: ${e.message}")
        }

        respondAllow(callDetails)
    }

    private fun respondAllow(callDetails: Call.Details) {
        respondToCall(
            callDetails,
            CallResponse.Builder()
                .setDisallowCall(false)
                .setRejectCall(false)
                .setSilenceCall(false)
                .setSkipCallLog(false)
                .setSkipNotification(false)
                .build()
        )
    }

    private fun respondReject(callDetails: Call.Details) {
        respondToCall(
            callDetails,
            CallResponse.Builder()
                .setDisallowCall(true)
                .setRejectCall(true)
                .setSilenceCall(false)
                .setSkipCallLog(false)
                .setSkipNotification(false)
                .build()
        )
    }

    private fun hashPhone(phone: String): String {
        // Normalize: strip spaces, dashes, leading country code
        val normalized = phone.replace(Regex("[\\s\\-()]"), "")
            .let { if (it.startsWith("+61")) "0${it.substring(3)}" else it }

        val digest = MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(normalized.toByteArray())
        return hash.joinToString("") { "%02x".format(it) }
    }
}
