import ExpoModulesCore
import UIKit

public class SmsFilterModule: Module {
    public func definition() -> ModuleDefinition {
        Name("SmsFilter")

        AsyncFunction("isEnabled") { (promise: Promise) in
            // iOS doesn't provide a direct API to check if our filter is enabled
            // The user must manually enable it in Settings > Messages > Unknown & Spam
            promise.resolve(false)
        }

        AsyncFunction("openSettings") { (promise: Promise) in
            DispatchQueue.main.async {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            promise.resolve(nil)
        }
    }
}
