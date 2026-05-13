import SwiftUI

struct SignupView: View {
    @Binding var showSignup: Bool
    @EnvironmentObject var state: AppState

    @State private var email    = ""
    @State private var password = ""
    @State private var username = ""
    @State private var fullName = ""
    @State private var loading            = false
    @State private var error: String?
    @State private var needsConfirmation  = false

    // Username availability
    @State private var usernameStatus: UsernameStatus = .idle
    @State private var usernameCheckTask: Task<Void, Never>?

    enum UsernameStatus {
        case idle, checking, available, taken, invalid
        var message: String? {
            switch self {
            case .checking:  return "Checking…"
            case .available: return "✓ Available"
            case .taken:     return "Already taken"
            case .invalid:   return "Letters, numbers and _ only"
            default: return nil
            }
        }
        var color: Color {
            switch self {
            case .available: return .green
            case .taken, .invalid: return .red
            case .checking: return Color.sparkSubtext
            default: return .clear
            }
        }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                HStack {
                    Button { showSignup = false } label: {
                        Image(systemName: "chevron.left")
                            .foregroundColor(Color.sparkPurple)
                            .font(.system(size: 18, weight: .semibold))
                    }
                    Spacer()
                }
                .padding(.horizontal, 24).padding(.top, 56)

                VStack(spacing: 8) {
                    Text("Create Account")
                        .font(.system(size: 28, weight: .bold)).foregroundColor(.white)
                    Text("Join the community").foregroundColor(Color.sparkSubtext)
                }
                .padding(.top, 24).padding(.bottom, 36)

                VStack(spacing: 14) {
                    TextField("", text: $fullName,
                              prompt: Text("Full name").foregroundColor(Color.sparkSubtext))
                        .sparkInput()

                    // Username field with live status
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            TextField("", text: $username,
                                      prompt: Text("Username").foregroundColor(Color.sparkSubtext))
                                .autocapitalization(.none)
                                .autocorrectionDisabled()
                                .sparkInput()
                                .onChange(of: username) { newVal in
                                    scheduleUsernameCheck(newVal)
                                }

                            if usernameStatus == .checking {
                                ProgressView()
                                    .tint(Color.sparkSubtext)
                                    .scaleEffect(0.8)
                                    .padding(.trailing, 4)
                            } else if usernameStatus == .available {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundColor(.green)
                                    .padding(.trailing, 4)
                            } else if usernameStatus == .taken || usernameStatus == .invalid {
                                Image(systemName: "xmark.circle.fill")
                                    .foregroundColor(.red)
                                    .padding(.trailing, 4)
                            }
                        }

                        if let msg = usernameStatus.message {
                            Text(msg)
                                .font(.caption)
                                .foregroundColor(usernameStatus.color)
                                .padding(.horizontal, 4)
                                .transition(.opacity)
                        }
                    }
                    .animation(.easeInOut(duration: 0.15), value: usernameStatus.message)

                    TextField("", text: $email,
                              prompt: Text("Email").foregroundColor(Color.sparkSubtext))
                        .keyboardType(.emailAddress).autocapitalization(.none).sparkInput()

                    SecureField("", text: $password,
                                prompt: Text("Password (6+ characters)").foregroundColor(Color.sparkSubtext))
                        .sparkInput()

                    if let err = error {
                        Text(err).font(.caption).foregroundColor(.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    if needsConfirmation {
                        VStack(spacing: 8) {
                            Image(systemName: "envelope.badge.fill")
                                .font(.system(size: 36)).foregroundColor(Color.sparkPurple)
                            Text("Check your email!")
                                .font(.system(size: 17, weight: .bold)).foregroundColor(.white)
                            Text("We sent a confirmation link to \(email). Tap it to finish creating your account, then log in.")
                                .font(.caption).foregroundColor(Color.sparkSubtext)
                                .multilineTextAlignment(.center)
                            Button("Back to Login") { showSignup = false }
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundColor(Color.sparkPurple)
                                .padding(.top, 4)
                        }
                        .padding(16)
                        .background(Color.sparkCard)
                        .cornerRadius(14)
                        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.sparkBorder, lineWidth: 1))
                    } else {
                        PurpleButton(title: "Create Account", loading: loading) { signUp() }
                            .padding(.top, 8)
                            .disabled(usernameStatus == .taken || usernameStatus == .invalid || usernameStatus == .checking)
                            .opacity(usernameStatus == .taken || usernameStatus == .invalid ? 0.5 : 1)
                    }
                }
                .padding(.horizontal, 24)

                Spacer()
            }
        }
        .background(Color.sparkBg.ignoresSafeArea())
        .scrollDismissesKeyboard(.interactively)
    }

    // MARK: - Username check
    private func scheduleUsernameCheck(_ value: String) {
        usernameCheckTask?.cancel()
        let clean = value.trimmingCharacters(in: .whitespaces)
        guard !clean.isEmpty else { usernameStatus = .idle; return }

        // Validate format
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_"))
        guard clean.unicodeScalars.allSatisfy({ allowed.contains($0) }) else {
            usernameStatus = .invalid; return
        }

        usernameStatus = .checking
        usernameCheckTask = Task {
            try? await Task.sleep(nanoseconds: 500_000_000) // 0.5s debounce
            guard !Task.isCancelled else { return }
            let available = (try? await SupabaseService.shared.checkUsernameAvailable(clean)) ?? true
            await MainActor.run {
                guard !Task.isCancelled else { return }
                usernameStatus = available ? .available : .taken
            }
        }
    }

    // MARK: - Sign up
    private func signUp() {
        guard !email.isEmpty, !password.isEmpty, !username.isEmpty, !fullName.isEmpty else {
            error = "Please fill in all fields"; return
        }
        guard password.count >= 6 else { error = "Password must be at least 6 characters"; return }
        guard usernameStatus != .taken   else { error = "That username is already taken"; return }
        guard usernameStatus != .invalid else { error = "Username can only contain letters, numbers and _"; return }
        loading = true; error = nil
        Task {
            do {
                let session = try await SupabaseService.shared.signUp(
                    email: email, password: password,
                    username: username, fullName: fullName)
                if let session {
                    await MainActor.run { state.setSession(session) }
                } else {
                    await MainActor.run { needsConfirmation = true; loading = false }
                }
            } catch {
                await MainActor.run { self.error = error.localizedDescription; loading = false }
            }
        }
    }
}
