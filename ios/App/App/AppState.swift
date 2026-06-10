import SwiftUI
import Combine

// A lightweight record of a signed-in account stored locally
struct SavedAccount: Codable, Identifiable, Equatable {
    let id: String          // Supabase user UUID
    var username: String
    var displayName: String
    var avatarUrl: String?
    var accessToken: String
    var refreshToken: String
}

final class AppState: ObservableObject {
    static let shared = AppState()

    @Published var currentUser: SparkUser?
    @Published var accessToken: String?
    @Published var refreshToken: String?
    @Published var isLoggedIn: Bool = false
    @Published var unreadNotifications: Int = 0
    @Published var unreadMessages: Int = 0
    @Published var savedAccounts: [SavedAccount] = []

    private let defaults        = UserDefaults.standard
    private let tokenKey        = "spark_access_token"
    private let refreshKey      = "spark_refresh_token"
    private let userIdKey       = "spark_user_id"
    private let tokenExpKey     = "spark_token_exp"
    private let savedAccountsKey = "spark_saved_accounts"

    private init() {
        loadSavedAccounts()
        loadStoredSession()
    }

    // MARK: - Session Management

    func setSession(_ session: AuthSession) {
        accessToken  = session.accessToken
        refreshToken = session.refreshToken
        defaults.set(session.accessToken,  forKey: tokenKey)
        defaults.set(session.refreshToken, forKey: refreshKey)
        defaults.set(session.user.id,      forKey: userIdKey)
        defaults.set(Date().addingTimeInterval(3500), forKey: tokenExpKey)
        isLoggedIn = true
        Task { await loadCurrentUser(id: session.user.id) }
    }

    func clearSession() {
        // Remove this account from saved list if present
        if let uid = currentUser?.id ?? defaults.string(forKey: userIdKey) {
            savedAccounts.removeAll { $0.id == uid }
            persistSavedAccounts()
        }
        currentUser  = nil
        accessToken  = nil
        refreshToken = nil
        isLoggedIn   = false
        defaults.removeObject(forKey: tokenKey)
        defaults.removeObject(forKey: refreshKey)
        defaults.removeObject(forKey: userIdKey)
        defaults.removeObject(forKey: tokenExpKey)

        // Auto-switch to another saved account if available
        if let next = savedAccounts.first {
            switchToAccount(next)
        }
    }

    private func loadStoredSession() {
        guard let token = defaults.string(forKey: tokenKey),
              let uid   = defaults.string(forKey: userIdKey) else { return }
        accessToken  = token
        refreshToken = defaults.string(forKey: refreshKey)
        isLoggedIn   = true
        Task {
            let exp = defaults.object(forKey: tokenExpKey) as? Date ?? Date()
            if Date() >= exp {
                await tryRefreshToken()
            } else {
                await loadCurrentUser(id: uid)
            }
        }
    }

    @MainActor
    private func tryRefreshToken() async {
        guard let refresh = refreshToken else { clearSession(); return }
        do {
            let session = try await SupabaseService.shared.refreshSession(refreshToken: refresh)
            setSession(session)
        } catch {
            clearSession()
        }
    }

    @MainActor
    func loadCurrentUser(id: String) async {
        do {
            let user = try await SupabaseService.shared.getProfile(userId: id)
            currentUser = user
            // Keep the saved account record up to date
            upsertSavedAccount(user: user)
        } catch {
            await tryRefreshToken()
        }
    }

    func refreshCurrentUser() async {
        guard let id = currentUser?.id else { return }
        await loadCurrentUser(id: id)
    }

    // MARK: - Multi-Account

    /// Call after a successful login for an ADDITIONAL account (don't wipe current session).
    func addAccount(session: AuthSession) async {
        // Temporarily set tokens to load the new user's profile
        let prevAccess  = accessToken
        let prevRefresh = refreshToken
        accessToken  = session.accessToken
        refreshToken = session.refreshToken

        if let user = try? await SupabaseService.shared.getProfile(userId: session.user.id) {
            let acct = SavedAccount(
                id:           user.id,
                username:     user.username,
                displayName:  user.displayName,
                avatarUrl:    user.avatarUrl,
                accessToken:  session.accessToken,
                refreshToken: session.refreshToken
            )
            await MainActor.run {
                savedAccounts.removeAll { $0.id == acct.id }
                savedAccounts.append(acct)
                persistSavedAccounts()
            }
        }

        // Restore previous session
        accessToken  = prevAccess
        refreshToken = prevRefresh
    }

    func switchToAccount(_ account: SavedAccount) {
        // Save current account's tokens back before switching
        if let cur = currentUser, let at = accessToken, let rt = refreshToken {
            upsertSavedAccountTokens(id: cur.id, accessToken: at, refreshToken: rt)
        }

        accessToken  = account.accessToken
        refreshToken = account.refreshToken
        defaults.set(account.accessToken,  forKey: tokenKey)
        defaults.set(account.refreshToken, forKey: refreshKey)
        defaults.set(account.id,           forKey: userIdKey)
        defaults.set(Date().addingTimeInterval(3500), forKey: tokenExpKey)
        isLoggedIn = true

        Task {
            // Try to refresh if needed, then load profile
            do {
                let session = try await SupabaseService.shared.refreshSession(refreshToken: account.refreshToken)
                await MainActor.run {
                    self.accessToken  = session.accessToken
                    self.refreshToken = session.refreshToken
                    self.upsertSavedAccountTokens(id: account.id,
                                                  accessToken: session.accessToken,
                                                  refreshToken: session.refreshToken)
                }
                await loadCurrentUser(id: account.id)
            } catch {
                // Token might still be valid, try loading profile directly
                await loadCurrentUser(id: account.id)
            }
        }
    }

    func removeAccount(id: String) {
        savedAccounts.removeAll { $0.id == id }
        persistSavedAccounts()
    }

    // MARK: - Persistence

    private func loadSavedAccounts() {
        guard let data = defaults.data(forKey: savedAccountsKey),
              let accounts = try? JSONDecoder().decode([SavedAccount].self, from: data) else { return }
        savedAccounts = accounts
    }

    func persistSavedAccounts() {
        if let data = try? JSONEncoder().encode(savedAccounts) {
            defaults.set(data, forKey: savedAccountsKey)
        }
    }

    private func upsertSavedAccount(user: SparkUser) {
        guard let at = accessToken, let rt = refreshToken else { return }
        let acct = SavedAccount(
            id: user.id, username: user.username,
            displayName: user.displayName, avatarUrl: user.avatarUrl,
            accessToken: at, refreshToken: rt
        )
        savedAccounts.removeAll { $0.id == acct.id }
        savedAccounts.append(acct)
        persistSavedAccounts()
    }

    private func upsertSavedAccountTokens(id: String, accessToken: String, refreshToken: String) {
        if let idx = savedAccounts.firstIndex(where: { $0.id == id }) {
            savedAccounts[idx].accessToken  = accessToken
            savedAccounts[idx].refreshToken = refreshToken
            persistSavedAccounts()
        }
    }

    // MARK: - Badge Counts
    func refreshBadges() async {
        do {
            async let notifs = SupabaseService.shared.getNotifications()
            async let convos = SupabaseService.shared.getConversations()
            let n = (try? await notifs) ?? []
            let c = (try? await convos) ?? []
            await MainActor.run {
                unreadNotifications = n.filter { !$0.read }.count
                unreadMessages      = c.filter { $0.unreadCount > 0 }.count
            }
        }
    }
}
