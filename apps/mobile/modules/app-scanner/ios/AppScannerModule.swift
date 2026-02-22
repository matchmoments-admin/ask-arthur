import ExpoModulesCore

public class AppScannerModule: Module {
    public func definition() -> ModuleDefinition {
        Name("AppScanner")

        // iOS has no API for listing installed apps.
        // Return an empty array.
        AsyncFunction("scanInstalledApps") { () -> [[String: Any]] in
            return []
        }
    }
}
