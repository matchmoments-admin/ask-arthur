package au.askarthur.callscreen

import android.app.role.RoleManager
import android.content.Context
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise

class CallScreenModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("CallScreen")

        AsyncFunction("enable") { promise: Promise ->
            val context = appContext.reactContext ?: run {
                promise.resolve(false)
                return@AsyncFunction
            }

            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                promise.resolve(false)
                return@AsyncFunction
            }

            val roleManager = context.getSystemService(Context.ROLE_SERVICE) as? RoleManager
            if (roleManager == null) {
                promise.resolve(false)
                return@AsyncFunction
            }

            // Check if we already hold the role
            if (roleManager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)) {
                promise.resolve(true)
                return@AsyncFunction
            }

            // Request the call screening role — this requires Activity context
            // For now, resolve false and guide user to settings
            promise.resolve(false)
        }

        AsyncFunction("disable") { promise: Promise ->
            // Call screening can be disabled by the user in system settings
            promise.resolve(null)
        }

        AsyncFunction("isActive") { promise: Promise ->
            val context = appContext.reactContext ?: run {
                promise.resolve(false)
                return@AsyncFunction
            }

            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                promise.resolve(false)
                return@AsyncFunction
            }

            val roleManager = context.getSystemService(Context.ROLE_SERVICE) as? RoleManager
            val isHeld = roleManager?.isRoleHeld(RoleManager.ROLE_CALL_SCREENING) ?: false
            promise.resolve(isHeld)
        }
    }
}
