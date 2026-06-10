import SwiftUI

struct AccountSwitcherView: View {
    @EnvironmentObject var state: AppState
    @Environment(\.dismiss) var dismiss

    @State private var showAddAccount = false
    @State private var removingId: String?

    var otherAccounts: [SavedAccount] {
        state.savedAccounts.filter { $0.id != state.currentUser?.id }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.sparkBg.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 12) {

                        // Current account
                        if let user = state.currentUser {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Active")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundColor(Color.sparkSubtext)
                                    .padding(.horizontal, 4)

                                currentAccountRow(user: user)
                            }
                        }

                        // Other saved accounts
                        if !otherAccounts.isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Saved Accounts")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundColor(Color.sparkSubtext)
                                    .padding(.horizontal, 4)

                                ForEach(otherAccounts) { account in
                                    savedAccountRow(account: account)
                                }
                            }
                        }

                        // Add account button
                        Button {
                            showAddAccount = true
                        } label: {
                            HStack(spacing: 14) {
                                ZStack {
                                    Circle()
                                        .stroke(Color.sparkPurple, lineWidth: 1.5)
                                        .frame(width: 44, height: 44)
                                    Image(systemName: "plus")
                                        .font(.system(size: 16, weight: .semibold))
                                        .foregroundColor(Color.sparkPurple)
                                }
                                Text("Add Account")
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundColor(Color.sparkPurple)
                                Spacer()
                            }
                            .padding(14)
                            .background(Color.sparkCard)
                            .cornerRadius(14)
                            .overlay(RoundedRectangle(cornerRadius: 14)
                                .stroke(Color.sparkBorder, lineWidth: 1))
                        }
                    }
                    .padding(16)
                }
            }
            .navigationTitle("Accounts")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                        .foregroundColor(Color.sparkPurple)
                }
            }
            .sheet(isPresented: $showAddAccount) {
                AddAccountView()
            }
        }
    }

    // MARK: - Current account row
    private func currentAccountRow(user: SparkUser) -> some View {
        HStack(spacing: 14) {
            AvatarView(url: user.avatarUrl, size: 44)

            VStack(alignment: .leading, spacing: 2) {
                Text(user.displayName)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.white)
                Text("@\(user.username)")
                    .font(.caption)
                    .foregroundColor(Color.sparkSubtext)
            }

            Spacer()

            // Active indicator
            HStack(spacing: 4) {
                Circle()
                    .fill(Color.green)
                    .frame(width: 7, height: 7)
                Text("Active")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.green)
            }
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(Color.green.opacity(0.1))
            .cornerRadius(10)
        }
        .padding(14)
        .background(Color.sparkCard)
        .cornerRadius(14)
        .overlay(RoundedRectangle(cornerRadius: 14)
            .stroke(Color.sparkPurple.opacity(0.4), lineWidth: 1.5))
    }

    // MARK: - Saved account row
    private func savedAccountRow(account: SavedAccount) -> some View {
        HStack(spacing: 14) {
            AvatarView(url: account.avatarUrl, size: 44)

            VStack(alignment: .leading, spacing: 2) {
                Text(account.displayName)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.white)
                Text("@\(account.username)")
                    .font(.caption)
                    .foregroundColor(Color.sparkSubtext)
            }

            Spacer()

            // Remove button
            Button {
                withAnimation { state.removeAccount(id: account.id) }
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(Color.sparkSubtext)
                    .padding(7)
                    .background(Color.sparkBorder)
                    .clipShape(Circle())
            }
        }
        .padding(14)
        .background(Color.sparkCard)
        .cornerRadius(14)
        .overlay(RoundedRectangle(cornerRadius: 14)
            .stroke(Color.sparkBorder, lineWidth: 1))
        .onTapGesture {
            state.switchToAccount(account)
            dismiss()
        }
    }
}

// MARK: - Add Account Login Sheet
struct AddAccountView: View {
    @EnvironmentObject var state: AppState
    @Environment(\.dismiss) var dismiss

    @State private var username = ""
    @State private var password = ""
    @State private var loading  = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ZStack {
                Color.sparkBg.ignoresSafeArea()
                VStack(spacing: 24) {
                    VStack(spacing: 6) {
                        Image(systemName: "person.badge.plus")
                            .font(.system(size: 40))
                            .foregroundStyle(LinearGradient(
                                colors: [Color.sparkPurple, Color(hex: "EC4899")],
                                startPoint: .topLeading, endPoint: .bottomTrailing))
                        Text("Add Another Account")
                            .font(.system(size: 22, weight: .bold))
                            .foregroundColor(.white)
                        Text("Sign in to a different account.\nYou can switch between them anytime.")
                            .font(.subheadline)
                            .foregroundColor(Color.sparkSubtext)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.top, 32)

                    VStack(spacing: 14) {
                        TextField("", text: $username,
                                  prompt: Text("Username").foregroundColor(Color.sparkSubtext))
                            .autocapitalization(.none)
                            .disableAutocorrection(true)
                            .sparkInput()

                        SecureField("", text: $password,
                                    prompt: Text("Password").foregroundColor(Color.sparkSubtext))
                            .sparkInput()

                        if let err = error {
                            Text(err).font(.caption).foregroundColor(.red)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }

                        PurpleButton(title: "Sign In", loading: loading) { addAccount() }
                    }
                    .padding(.horizontal, 24)

                    Spacer()
                }
            }
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.foregroundColor(Color.sparkSubtext)
                }
            }
            .scrollDismissesKeyboard(.interactively)
        }
    }

    private func addAccount() {
        let u = username.trimmingCharacters(in: .whitespaces)
        guard !u.isEmpty, !password.isEmpty else { error = "Please fill in all fields"; return }

        // Don't allow signing into the same account that's already active
        if u.lowercased() == state.currentUser?.username.lowercased() {
            error = "That account is already active"; return
        }
        // Don't allow signing into an account already in the saved list
        if state.savedAccounts.contains(where: { $0.username.lowercased() == u.lowercased() }) {
            error = "That account is already saved"; return
        }

        loading = true; error = nil
        Task {
            do {
                let session = try await SupabaseService.shared.signInWithUsername(u, password: password)
                await state.addAccount(session: session)
                await MainActor.run { dismiss() }
            } catch {
                await MainActor.run {
                    self.error = "Wrong username or password"
                    loading = false
                }
            }
        }
    }
}
