import ExpoModulesCore
import DeviceCheck

public class DeviceAttestModule: Module {
    public func definition() -> ModuleDefinition {
        Name("DeviceAttest")

        AsyncFunction("requestAttestation") { (challenge: String, promise: Promise) in
            guard #available(iOS 14.0, *) else {
                promise.reject("ERR_UNSUPPORTED", "App Attest requires iOS 14+")
                return
            }

            let service = DCAppAttestService.shared

            guard service.isSupported else {
                promise.reject("ERR_UNSUPPORTED", "App Attest is not supported on this device")
                return
            }

            service.generateKey { keyId, error in
                guard let keyId = keyId, error == nil else {
                    promise.reject("ERR_KEY_GEN", "Failed to generate attestation key: \(error?.localizedDescription ?? "unknown")")
                    return
                }

                guard let challengeData = challenge.data(using: .utf8) else {
                    promise.reject("ERR_CHALLENGE", "Invalid challenge string")
                    return
                }

                // Hash the challenge for attestation
                let hash = Data(SHA256.hash(data: challengeData))

                service.attestKey(keyId, clientDataHash: hash) { attestation, error in
                    guard let attestation = attestation, error == nil else {
                        promise.reject("ERR_ATTEST", "Attestation failed: \(error?.localizedDescription ?? "unknown")")
                        return
                    }

                    let token = attestation.base64EncodedString()
                    promise.resolve([
                        "token": token,
                        "platform": "ios"
                    ])
                }
            }
        }

        AsyncFunction("isSupported") { (promise: Promise) in
            if #available(iOS 14.0, *) {
                promise.resolve(DCAppAttestService.shared.isSupported)
            } else {
                promise.resolve(false)
            }
        }
    }
}
