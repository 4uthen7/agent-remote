import SwiftUI

struct AppLockView: View {
    @ObservedObject var lock: AppLock
    @State private var password = ""
    @State private var errorMessage: String?
    @State private var isAuthenticating = false
    @State private var didAutoPrompt = false

    var body: some View {
        ZStack {
            Color(.systemGroupedBackground).ignoresSafeArea()
            VStack(spacing: 0) {
                Spacer(minLength: 40)

                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .fill(.black)
                    .frame(width: 82, height: 82)
                    .overlay(
                        Image(systemName: "terminal.fill")
                            .font(.system(size: 32, weight: .semibold))
                            .foregroundStyle(.white)
                    )
                    .shadow(color: .black.opacity(0.12), radius: 18, y: 8)

                Text("Agent Remote")
                    .font(.system(size: 26, weight: .bold))
                    .padding(.top, 20)
                Text("ロック中")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.secondary)
                    .padding(.top, 4)

                Spacer(minLength: 28)

                VStack(spacing: 14) {
                    if lock.biometricEnabled && lock.biometryAvailable {
                        Button {
                            Task { await unlockBiometrics() }
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: biometryIcon)
                                    .font(.system(size: 18, weight: .medium))
                                Text("\(lock.biometryName)で解除")
                                    .font(.system(size: 16, weight: .semibold))
                            }
                            .frame(maxWidth: .infinity)
                            .frame(height: 52)
                        }
                        .buttonStyle(.borderedProminent)
                        .buttonBorderShape(.roundedRectangle(radius: 15))
                        .disabled(isAuthenticating)

                        HStack {
                            Rectangle().fill(.quaternary).frame(height: 1)
                            Text("または").font(.caption).foregroundStyle(.secondary)
                            Rectangle().fill(.quaternary).frame(height: 1)
                        }
                        .padding(.horizontal, 8)
                    }

                    SecureField("アプリパスワード", text: $password)
                        .textContentType(.password)
                        .submitLabel(.go)
                        .onSubmit { unlockWithPassword() }
                        .padding(.horizontal, 16)
                        .frame(height: 52)
                        .background(.background, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 15, style: .continuous)
                                .stroke(.quaternary, lineWidth: 1)
                        )

                    if let errorMessage {
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundStyle(.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 4)
                    }

                    Button("アプリパスワードで解除") {
                        unlockWithPassword()
                    }
                    .font(.system(size: 16, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .background(.background, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 15, style: .continuous)
                            .stroke(.quaternary, lineWidth: 1)
                    )
                    .disabled(password.isEmpty)
                }
                .padding(.horizontal, 28)

                Spacer(minLength: 24)

                Text("パスワードを忘れた場合は、アプリを再インストールする必要があります。")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 36)
                    .padding(.bottom, 24)
            }
        }
        .task {
            guard !didAutoPrompt else { return }
            didAutoPrompt = true
            if lock.biometricEnabled && lock.biometryAvailable {
                await unlockBiometrics()
            }
        }
    }

    private var biometryIcon: String {
        if lock.biometryName == "Touch ID" { return "touchid" }
        if lock.biometryName == "Optic ID" { return "opticid" }
        return "faceid"
    }

    private func unlockWithPassword() {
        errorMessage = nil
        guard !password.isEmpty else { return }
        if lock.unlock(password: password) {
            password = ""
        } else {
            errorMessage = "パスワードが違います。"
            password = ""
        }
    }

    private func unlockBiometrics() async {
        guard !isAuthenticating else { return }
        isAuthenticating = true
        errorMessage = nil
        let success = await lock.unlockWithBiometrics()
        isAuthenticating = false
        if !success {
            errorMessage = "生体認証をキャンセルしました。アプリパスワードを入力してください。"
        }
    }
}
