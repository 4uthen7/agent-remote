import CommonCrypto
import LocalAuthentication
import Security
import SwiftUI

@MainActor
final class AppLock: ObservableObject {
    static let shared = AppLock()

    @Published private(set) var isLocked: Bool
    @Published private(set) var isEnabled: Bool
    @Published private(set) var biometricEnabled: Bool
    @Published private(set) var biometryAvailable: Bool = false
    @Published private(set) var biometryName: String = "生体認証"

    private let defaults = UserDefaults.standard
    private let service = "com.4uthent.agentremote.applock"
    private let account = "password"
    private let enabledKey = "appLock.enabled"
    private let biometricKey = "appLock.biometric"
    private let saltLength = 16
    private let hashLength = 32
    private let iterations: UInt32 = 120_000

    private init() {
        let enabled = defaults.bool(forKey: enabledKey)
        let hasSecret = Self.readKeychain(service: service, account: account) != nil
        isEnabled = enabled && hasSecret
        isLocked = enabled && hasSecret
        biometricEnabled = defaults.bool(forKey: biometricKey)
        refreshBiometry()
        if enabled && !hasSecret {
            defaults.set(false, forKey: enabledKey)
        }
    }

    var hasPassword: Bool {
        Self.readKeychain(service: service, account: account) != nil
    }

    func refreshBiometry() {
        let context = LAContext()
        var error: NSError?
        biometryAvailable = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
        switch context.biometryType {
        case .faceID: biometryName = "Face ID"
        case .touchID: biometryName = "Touch ID"
        case .opticID: biometryName = "Optic ID"
        default: biometryName = "生体認証"
        }
    }

    func enable(password: String) throws {
        guard password.count >= 6 else { throw AppLockError.tooShort }
        guard password.count <= 128 else { throw AppLockError.tooLong }
        var salt = Data(count: saltLength)
        let status = salt.withUnsafeMutableBytes { bytes in
            SecRandomCopyBytes(kSecRandomDefault, saltLength, bytes.baseAddress!)
        }
        guard status == errSecSuccess, let hash = Self.derive(password: password, salt: salt, iterations: iterations) else {
            throw AppLockError.crypto
        }
        Self.saveKeychain(salt + hash, service: service, account: account)
        defaults.set(true, forKey: enabledKey)
        isEnabled = true
        isLocked = false
        refreshBiometry()
        if biometryAvailable {
            biometricEnabled = true
            defaults.set(true, forKey: biometricKey)
        }
    }

    func disable() {
        defaults.set(false, forKey: enabledKey)
        defaults.set(false, forKey: biometricKey)
        Self.deleteKeychain(service: service, account: account)
        isEnabled = false
        isLocked = false
        biometricEnabled = false
    }

    func setBiometricEnabled(_ enabled: Bool) {
        guard isEnabled else { return }
        guard !enabled || biometryAvailable else { return }
        biometricEnabled = enabled
        defaults.set(enabled, forKey: biometricKey)
    }

    func lockIfNeeded() {
        if isEnabled { isLocked = true }
    }

    func unlock(password: String) -> Bool {
        guard let data = Self.readKeychain(service: service, account: account),
              data.count == saltLength + hashLength else { return false }
        let salt = data.prefix(saltLength)
        let expected = data.suffix(hashLength)
        guard let actual = Self.derive(password: password, salt: salt, iterations: iterations) else { return false }
        guard Self.constantTimeEqual(actual, expected) else { return false }
        isLocked = false
        return true
    }

    func unlockWithBiometrics() async -> Bool {
        guard isEnabled, biometricEnabled else { return false }
        let context = LAContext()
        context.localizedCancelTitle = "アプリパスワード"
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            refreshBiometry()
            return false
        }
        do {
            let success = try await context.evaluatePolicy(
                .deviceOwnerAuthenticationWithBiometrics,
                localizedReason: "Agent Remote のロックを解除します"
            )
            if success { isLocked = false }
            return success
        } catch {
            return false
        }
    }

    // MARK: - Crypto

    private static func derive(password: String, salt: Data, iterations: UInt32) -> Data? {
        let passwordData = Data(password.utf8)
        guard !passwordData.isEmpty, !salt.isEmpty else { return nil }
        var derived = Data(count: 32)
        let status = derived.withUnsafeMutableBytes { derivedBytes in
            salt.withUnsafeBytes { saltBytes in
                passwordData.withUnsafeBytes { passwordBytes in
                    CCKeyDerivationPBKDF(
                        CCPBKDFAlgorithm(kCCPBKDF2),
                        passwordBytes.bindMemory(to: Int8.self).baseAddress,
                        passwordData.count,
                        saltBytes.bindMemory(to: UInt8.self).baseAddress,
                        salt.count,
                        CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
                        iterations,
                        derivedBytes.bindMemory(to: UInt8.self).baseAddress,
                        32
                    )
                }
            }
        }
        return status == kCCSuccess ? derived : nil
    }

    private static func constantTimeEqual(_ lhs: Data, _ rhs: Data) -> Bool {
        guard lhs.count == rhs.count else { return false }
        var difference: UInt8 = 0
        for index in 0..<lhs.count {
            difference |= lhs[index] ^ rhs[index]
        }
        return difference == 0
    }

    // MARK: - Keychain

    private static func readKeychain(service: String, account: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess else { return nil }
        return item as? Data
    }

    private static func saveKeychain(_ data: Data, service: String, account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        SecItemDelete(query as CFDictionary)
        var add = query
        add.merge(attributes) { _, new in new }
        SecItemAdd(add as CFDictionary, nil)
    }

    private static func deleteKeychain(service: String, account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

enum AppLockError: LocalizedError {
    case tooShort
    case tooLong
    case crypto

    var errorDescription: String? {
        switch self {
        case .tooShort: return "アプリパスワードは6文字以上にしてください。"
        case .tooLong: return "アプリパスワードは128文字以内にしてください。"
        case .crypto: return "パスワードを保存できませんでした。"
        }
    }
}
