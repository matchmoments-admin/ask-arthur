package au.askarthur.appscanner

import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise

class AppScannerModule : Module() {

    override fun definition() = ModuleDefinition {
        Name("AppScanner")

        AsyncFunction("scanInstalledApps") { promise: Promise ->
            try {
                val results = performScan()
                promise.resolve(results)
            } catch (e: Exception) {
                promise.reject("SCAN_ERROR", "Failed to scan installed apps: ${e.message}", e)
            }
        }
    }

    private fun performScan(): List<Map<String, Any?>> {
        val pm = appContext.reactContext?.packageManager
            ?: return emptyList()

        val packages = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pm.getInstalledPackages(
                    PackageManager.PackageInfoFlags.of(PackageManager.GET_PERMISSIONS.toLong())
                )
            } else {
                @Suppress("DEPRECATION")
                pm.getInstalledPackages(PackageManager.GET_PERMISSIONS)
            }
        } catch (e: Exception) {
            // TransactionTooLargeException fallback: query apps individually
            return scanIndividually(pm)
        }

        return packages
            .filter { !isSystemApp(it) }
            .map { toScanResult(it, pm) }
    }

    /**
     * Fallback for TransactionTooLargeException — query each package individually.
     */
    private fun scanIndividually(pm: PackageManager): List<Map<String, Any?>> {
        val installedApps = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            pm.getInstalledApplications(PackageManager.ApplicationInfoFlags.of(0))
        } else {
            @Suppress("DEPRECATION")
            pm.getInstalledApplications(0)
        }

        return installedApps
            .filter { it.flags and ApplicationInfo.FLAG_SYSTEM == 0 }
            .mapNotNull { appInfo ->
                try {
                    val pkgInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        pm.getPackageInfo(
                            appInfo.packageName,
                            PackageManager.PackageInfoFlags.of(PackageManager.GET_PERMISSIONS.toLong())
                        )
                    } else {
                        @Suppress("DEPRECATION")
                        pm.getPackageInfo(appInfo.packageName, PackageManager.GET_PERMISSIONS)
                    }
                    toScanResult(pkgInfo, pm)
                } catch (e: Exception) {
                    null
                }
            }
    }

    private fun isSystemApp(pkg: PackageInfo): Boolean {
        return pkg.applicationInfo?.let {
            it.flags and ApplicationInfo.FLAG_SYSTEM != 0
        } ?: true
    }

    private fun toScanResult(pkg: PackageInfo, pm: PackageManager): Map<String, Any?> {
        val requestedPerms = pkg.requestedPermissions ?: emptyArray()
        val requestedFlags = pkg.requestedPermissionsFlags ?: IntArray(0)

        val dangerousPermissions = mutableListOf<Map<String, Any>>()
        val grantedDangerous = mutableSetOf<String>()

        for (i in requestedPerms.indices) {
            val permName = requestedPerms[i]
            val granted = if (i < requestedFlags.size) {
                requestedFlags[i] and PackageInfo.REQUESTED_PERMISSION_GRANTED != 0
            } else {
                false
            }

            // Check if this is a dangerous (runtime) permission
            val protectionLevel = try {
                val permInfo = pm.getPermissionInfo(permName, 0)
                when (permInfo.protectionLevel and 0xf) { // mask base protection level
                    1 -> "dangerous"
                    0 -> "normal"
                    2 -> "signature"
                    else -> "unknown"
                }
            } catch (e: Exception) {
                "unknown"
            }

            if (protectionLevel == "dangerous") {
                dangerousPermissions.add(
                    mapOf(
                        "name" to permName,
                        "granted" to granted,
                        "protectionLevel" to protectionLevel,
                    )
                )
                if (granted) {
                    grantedDangerous.add(permName)
                }
            }
        }

        val assessment = RiskScorer.assess(grantedDangerous)
        val appName = pkg.applicationInfo?.let { pm.getApplicationLabel(it).toString() }
            ?: pkg.packageName

        return mapOf(
            "packageName" to pkg.packageName,
            "appName" to appName,
            "versionName" to (pkg.versionName ?: "unknown"),
            "dangerousPermissions" to dangerousPermissions,
            "riskLevel" to assessment.level,
            "riskReasons" to assessment.reasons,
        )
    }
}
