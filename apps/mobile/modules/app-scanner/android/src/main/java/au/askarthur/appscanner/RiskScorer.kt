package au.askarthur.appscanner

import android.content.pm.PackageInfo

/**
 * Traffic-light risk scoring for installed apps based on their requested permissions.
 */
object RiskScorer {

    // Permissions that are almost always suspicious unless the app category justifies them
    private val HIGH_RISK_PERMISSIONS = setOf(
        "android.permission.READ_SMS",
        "android.permission.RECEIVE_SMS",
        "android.permission.SEND_SMS",
        "android.permission.READ_CALL_LOG",
        "android.permission.REQUEST_INSTALL_PACKAGES",
        "android.permission.BIND_ACCESSIBILITY_SERVICE",
        "android.permission.BIND_DEVICE_ADMIN",
        "android.permission.SYSTEM_ALERT_WINDOW",
        "android.permission.READ_CONTACTS",
    )

    // Permissions that warrant attention but are common in legitimate apps
    private val MEDIUM_RISK_PERMISSIONS = setOf(
        "android.permission.CAMERA",
        "android.permission.RECORD_AUDIO",
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.ACCESS_BACKGROUND_LOCATION",
        "android.permission.READ_PHONE_STATE",
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE",
        "android.permission.READ_MEDIA_IMAGES",
        "android.permission.READ_MEDIA_VIDEO",
    )

    // Suspicious permission combinations
    private data class SuspiciousCombination(
        val permissions: Set<String>,
        val reason: String,
    )

    private val SUSPICIOUS_COMBOS = listOf(
        SuspiciousCombination(
            setOf("android.permission.CAMERA", "android.permission.RECORD_AUDIO", "android.permission.READ_SMS"),
            "Can access camera, microphone, and read SMS — potential spyware pattern"
        ),
        SuspiciousCombination(
            setOf("android.permission.READ_SMS", "android.permission.SEND_SMS"),
            "Can read and send SMS — may intercept verification codes"
        ),
        SuspiciousCombination(
            setOf("android.permission.READ_CONTACTS", "android.permission.SEND_SMS"),
            "Can read contacts and send SMS — potential spam/scam spreader"
        ),
        SuspiciousCombination(
            setOf("android.permission.REQUEST_INSTALL_PACKAGES", "android.permission.SYSTEM_ALERT_WINDOW"),
            "Can install apps and draw overlays — potential dropper/clickjacker"
        ),
    )

    data class RiskAssessment(
        val level: String, // "red", "yellow", "green"
        val reasons: List<String>,
    )

    fun assess(grantedPermissions: Set<String>): RiskAssessment {
        val reasons = mutableListOf<String>()
        var highCount = 0
        var mediumCount = 0

        // Check individual high-risk permissions
        for (perm in HIGH_RISK_PERMISSIONS) {
            if (grantedPermissions.contains(perm)) {
                highCount++
                val shortName = perm.substringAfterLast(".")
                reasons.add("Granted: $shortName")
            }
        }

        // Check medium-risk permissions
        for (perm in MEDIUM_RISK_PERMISSIONS) {
            if (grantedPermissions.contains(perm)) {
                mediumCount++
            }
        }

        // Check suspicious combinations
        for (combo in SUSPICIOUS_COMBOS) {
            if (grantedPermissions.containsAll(combo.permissions)) {
                reasons.add(combo.reason)
                highCount += 2 // Weight combos heavily
            }
        }

        // Score
        val level = when {
            highCount >= 2 -> "red"
            highCount == 1 || mediumCount >= 4 -> "yellow"
            else -> "green"
        }

        return RiskAssessment(level, reasons)
    }
}
