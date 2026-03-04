package au.askarthur.deviceattest

import android.content.Context
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.IntegrityTokenRequest
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise

class DeviceAttestModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("DeviceAttest")

        AsyncFunction("requestAttestation") { challenge: String, promise: Promise ->
            val context = appContext.reactContext ?: run {
                promise.reject("ERR_NO_CONTEXT", "React context not available", null)
                return@AsyncFunction
            }

            try {
                val integrityManager = IntegrityManagerFactory.create(context)
                val request = IntegrityTokenRequest.builder()
                    .setNonce(challenge)
                    .build()

                integrityManager.requestIntegrityToken(request)
                    .addOnSuccessListener { response ->
                        val result = mapOf(
                            "token" to response.token(),
                            "platform" to "android"
                        )
                        promise.resolve(result)
                    }
                    .addOnFailureListener { e ->
                        promise.reject(
                            "ERR_INTEGRITY",
                            "Play Integrity request failed: ${e.message}",
                            e
                        )
                    }
            } catch (e: Exception) {
                promise.reject("ERR_INTEGRITY", "Failed to create integrity request: ${e.message}", e)
            }
        }

        AsyncFunction("isSupported") { promise: Promise ->
            // Play Integrity is available on devices with Google Play Services
            val context = appContext.reactContext
            if (context == null) {
                promise.resolve(false)
                return@AsyncFunction
            }
            // Basic check — Play Integrity requires Google Play Services 13+
            promise.resolve(true)
        }
    }
}
