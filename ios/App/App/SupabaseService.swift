import Foundation

// MARK: - Errors
enum SparkError: Error, LocalizedError {
    case network(String)
    case auth(String)
    case notFound
    case unknown
    var errorDescription: String? {
        switch self {
        case .network(let m): return m
        case .auth(let m):    return m
        case .notFound:       return "Not found"
        case .unknown:        return "Something went wrong"
        }
    }
}

// MARK: - Service
final class SupabaseService {
    static let shared = SupabaseService()
    private init() {}

    private var accessToken: String? { AppState.shared.accessToken }

    // MARK: Core Request
    @discardableResult
    func request(
        path: String,
        method: String = "GET",
        body: Data? = nil,
        query: [String: String] = [:],
        useAuth: Bool = true,
        prefer: String? = nil
    ) async throws -> Data {
        var comps = URLComponents(string: "\(Config.supabaseURL)\(path)")!
        if !query.isEmpty {
            comps.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        var req = URLRequest(url: comps.url!)
        req.httpMethod = method
        req.setValue(Config.supabaseAnonKey, forHTTPHeaderField: "apikey")
        req.setValue("application/json",     forHTTPHeaderField: "Content-Type")
        req.setValue("application/json",     forHTTPHeaderField: "Accept")
        if useAuth, let token = accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let prefer { req.setValue(prefer, forHTTPHeaderField: "Prefer") }
        if let body   { req.httpBody = body }

        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw SparkError.unknown }
        guard (200...299).contains(http.statusCode) else {
            let msg = String(data: data, encoding: .utf8) ?? "HTTP \(http.statusCode)"
            throw SparkError.network(msg)
        }
        return data
    }

    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        try JSONDecoder().decode(type, from: data)
    }

    private func encode<T: Encodable>(_ value: T) throws -> Data {
        try JSONEncoder().encode(value)
    }

    private func jsonBody(_ dict: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: dict)
    }

    // MARK: - Auth
    func signIn(email: String, password: String) async throws -> AuthSession {
        let body = try encode(["email": email, "password": password])
        let data = try await request(path: "/auth/v1/token?grant_type=password",
                                     method: "POST", body: body, useAuth: false)
        return try decode(AuthSession.self, from: data)
    }

    func signInWithUsername(_ username: String, password: String) async throws -> AuthSession {
        // Call the SECURITY DEFINER RPC to look up email from auth.users by username
        let body = try jsonBody(["p_username": username])
        let data = try await request(path: "/rest/v1/rpc/get_email_by_username",
                                     method: "POST", body: body, useAuth: false)
        // RPC returns a plain string (the email) or null
        let raw = String(data: data, encoding: .utf8) ?? ""
        let email = raw.trimmingCharacters(in: CharacterSet(charactersIn: "\"").union(.whitespacesAndNewlines))
        guard !email.isEmpty, email != "null" else {
            throw SparkError.auth("Username not found")
        }
        return try await signIn(email: email, password: password)
    }

    func refreshSession(refreshToken: String) async throws -> AuthSession {
        let body = try encode(["refresh_token": refreshToken])
        let data = try await request(path: "/auth/v1/token?grant_type=refresh_token",
                                     method: "POST", body: body, useAuth: false)
        return try decode(AuthSession.self, from: data)
    }

    // Returns a session if email-confirmation is OFF, or nil if confirmation email was sent.
    func signUp(email: String, password: String, username: String, fullName: String) async throws -> AuthSession? {
        let body = try jsonBody([
            "email":    email,
            "password": password,
            "data":     ["username": username, "full_name": fullName] as [String: Any]
        ])
        let data = try await request(path: "/auth/v1/signup",
                                     method: "POST", body: body, useAuth: false)

        // Happy path: confirmation OFF → full session returned
        if let session = try? decode(AuthSession.self, from: data) { return session }

        // Confirmation ON → Supabase returns the user object (no tokens).
        // Verify the response at least has an id/email so we know the signup worked.
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           json["id"] != nil || json["email"] != nil {
            return nil   // caller should show "check your email"
        }
        // Something unexpected
        let msg = String(data: data, encoding: .utf8) ?? "Signup failed"
        throw SparkError.network(msg)
    }

    func signOut() async throws {
        try await request(path: "/auth/v1/logout", method: "POST")
    }

    func checkUsernameAvailable(_ username: String, excludingId: String? = nil) async throws -> Bool {
        let data = try await request(path: "/rest/v1/profiles",
                                     query: ["username": "eq.\(username.lowercased())",
                                             "select": "id"])
        let rows = (try? JSONDecoder().decode([[String: String]].self, from: data)) ?? []
        if rows.isEmpty { return true }
        // Allow if the only match is the current user's own profile
        if let excludingId, rows.count == 1, rows[0]["id"] == excludingId { return true }
        return false
    }

    func deleteAccount() async throws {
        // Delete profile row first (cascade will clean up posts/follows etc via DB)
        if let uid = AppState.shared.currentUser?.id {
            _ = try? await request(path: "/rest/v1/profiles",
                                   method: "DELETE",
                                   query: ["id": "eq.\(uid)"],
                                   prefer: "return=minimal")
        }
        // Delete the auth user
        try await request(path: "/auth/v1/user", method: "DELETE")
    }

    // MARK: - Profiles
    func getProfile(userId: String) async throws -> SparkUser {
        let data = try await request(path: "/rest/v1/profiles",
                                     query: ["id": "eq.\(userId)", "select": "*", "limit": "1"])
        let arr = try decode([SparkUser].self, from: data)
        guard let user = arr.first else { throw SparkError.notFound }
        return user
    }

    func createProfile(id: String, username: String, fullName: String) async throws {
        let body = try jsonBody(["id": id, "username": username,
                                 "full_name": fullName, "is_private": false])
        try await request(path: "/rest/v1/profiles", method: "POST",
                          body: body, prefer: "return=minimal")
    }

    func updateProfile(_ updates: [String: Any]) async throws -> SparkUser {
        guard let uid = AppState.shared.currentUser?.id else { throw SparkError.auth("Not logged in") }
        let body = try jsonBody(updates)
        let data = try await request(path: "/rest/v1/profiles",
                                     method: "PATCH", body: body,
                                     query: ["id": "eq.\(uid)"],
                                     prefer: "return=representation")
        let arr = try decode([SparkUser].self, from: data)
        guard let user = arr.first else { throw SparkError.notFound }
        return user
    }

    func uploadAvatar(data: Data) async throws -> String {
        guard let uid = AppState.shared.currentUser?.id else { throw SparkError.auth("Not logged in") }
        let path = "\(uid)/avatar.jpg"
        var comps = URLComponents(string: "\(Config.supabaseURL)/storage/v1/object/avatars/\(path)")!
        var req = URLRequest(url: comps.url!)
        req.httpMethod = "POST"
        req.setValue(Config.supabaseAnonKey,              forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(accessToken ?? "")",       forHTTPHeaderField: "Authorization")
        req.setValue("image/jpeg",                        forHTTPHeaderField: "Content-Type")
        req.setValue("true",                              forHTTPHeaderField: "x-upsert")
        req.httpBody = data
        let (_, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw SparkError.network("Avatar upload failed")
        }
        // Return the public URL
        let publicUrl = "\(Config.supabaseURL)/storage/v1/object/public/avatars/\(path)"
        return publicUrl
    }

    func searchUsers(query: String) async throws -> [SparkUser] {
        let data = try await request(path: "/rest/v1/profiles",
                                     query: ["or": "(username.ilike.*\(query)*,full_name.ilike.*\(query)*)",
                                             "select": "*", "limit": "30"])
        return try decode([SparkUser].self, from: data)
    }

    // MARK: - Feed
    func getFollowingIds() async throws -> [String] {
        guard let uid = AppState.shared.currentUser?.id else { return [] }
        let data = try await request(path: "/rest/v1/follows",
                                     query: ["follower_id": "eq.\(uid)", "select": "following_id"])
        struct Row: Codable {
            let followingId: String
            enum CodingKeys: String, CodingKey { case followingId = "following_id" }
        }
        return try decode([Row].self, from: data).map { $0.followingId }
    }

    func getFeed() async throws -> [Post] {
        guard let uid = AppState.shared.currentUser?.id else { return [] }
        var ids = try await getFollowingIds()
        ids.append(uid)
        let inClause = "(\(ids.joined(separator: ",")))"
        let data = try await request(path: "/rest/v1/posts",
                                     query: [
                                        "user_id": "in.\(inClause)",
                                        "select":  "*,profiles(*),slaps(*)",
                                        "order":   "created_at.desc",
                                        "limit":   "50"
                                     ])
        return try decode([Post].self, from: data)
    }

    func getExploreFeed() async throws -> [Post] {
        let data = try await request(path: "/rest/v1/posts",
                                     query: ["is_private":  "eq.false",
                                             "select":      "*,profiles(*),slaps(*)",
                                             "order":       "created_at.desc",
                                             "limit":       "60"])
        return try decode([Post].self, from: data)
    }

    func getVideoFeed() async throws -> [Post] {
        let data = try await request(path: "/rest/v1/posts",
                                     query: ["media_type": "eq.video",
                                             "is_private": "eq.false",
                                             "select":     "*,profiles(*),slaps(*)",
                                             "order":      "created_at.desc",
                                             "limit":      "60"])
        return try decode([Post].self, from: data)
    }

    func getSuggestedUsers() async throws -> [SparkUser] {
        guard let uid = AppState.shared.currentUser?.id else { return [] }
        var followingIds = try await getFollowingIds()
        followingIds.append(uid)
        let exclude = "(\(followingIds.joined(separator: ",")))"
        let data = try await request(path: "/rest/v1/profiles",
                                     query: ["id":     "not.in.\(exclude)",
                                             "select": "id,username,full_name,avatar_url,avatar_letter,bio,is_private,is_og,college,industry",
                                             "order":  "created_at.desc",
                                             "limit":  "40"])
        return try decode([SparkUser].self, from: data)
    }

    func getUserPosts(userId: String) async throws -> [Post] {
        let data = try await request(path: "/rest/v1/posts",
                                     query: ["user_id": "eq.\(userId)",
                                             "select": "*,profiles(*),slaps(*)",
                                             "order": "created_at.desc"])
        return try decode([Post].self, from: data)
    }

    func createPost(content: String, feeling: String?, privacy: String,
                    mediaUrl: String? = nil, mediaType: String? = nil) async throws -> Post {
        guard let uid = AppState.shared.currentUser?.id else { throw SparkError.auth("Not logged in") }
        let isPrivate = (privacy == "followers" || privacy == "close_friends")
        let isCF      = (privacy == "close_friends")
        var payload: [String: Any] = ["user_id": uid, "content": content,
                                       "is_private": isPrivate, "is_close_friends": isCF]
        if let f = feeling,   !f.isEmpty  { payload["feeling"]    = f }
        if let u = mediaUrl,  !u.isEmpty  { payload["media_url"]  = u }
        if let t = mediaType, !t.isEmpty  { payload["media_type"] = t }
        let data = try await request(path: "/rest/v1/posts", method: "POST",
                                     body: try jsonBody(payload),
                                     prefer: "return=representation")
        let arr = try decode([Post].self, from: data)
        guard let post = arr.first else { throw SparkError.unknown }
        return post
    }

    func uploadPostMedia(data: Data) async throws -> String {
        guard let uid = AppState.shared.currentUser?.id else { throw SparkError.auth("Not logged in") }
        let filename = "\(uid)/\(UUID().uuidString).jpg"
        var req = URLRequest(url: URL(string: "\(Config.supabaseURL)/storage/v1/object/post-media/\(filename)")!)
        req.httpMethod = "POST"
        req.setValue(Config.supabaseAnonKey,        forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(accessToken ?? "")", forHTTPHeaderField: "Authorization")
        req.setValue("image/jpeg",                  forHTTPHeaderField: "Content-Type")
        req.setValue("true",                        forHTTPHeaderField: "x-upsert")
        req.httpBody = data
        let (_, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw SparkError.network("Media upload failed")
        }
        return "\(Config.supabaseURL)/storage/v1/object/public/post-media/\(filename)"
    }

    func deletePost(postId: String) async throws {
        try await request(path: "/rest/v1/posts", method: "DELETE",
                          query: ["id": "eq.\(postId)"])
    }

    // MARK: - Slaps (reactions)
    func toggleSlap(postId: String) async throws -> Bool {
        guard let uid = AppState.shared.currentUser?.id else { return false }
        let existing = try await request(path: "/rest/v1/slaps",
                                          query: ["post_id": "eq.\(postId)",
                                                  "user_id": "eq.\(uid)", "select": "id"])
        let arr = try? JSONDecoder().decode([[String: String]].self, from: existing)
        if let first = arr?.first, let id = first["id"] {
            try await request(path: "/rest/v1/slaps", method: "DELETE", query: ["id": "eq.\(id)"])
            return false  // unslapped
        } else {
            let body = try jsonBody(["post_id": postId, "user_id": uid])
            try await request(path: "/rest/v1/slaps", method: "POST",
                              body: body, prefer: "return=minimal")
            try? await createNotification(type: "slap", actorId: uid,
                                          userId: try await getPostAuthorId(postId: postId),
                                          postId: postId)
            return true  // slapped
        }
    }

    private func getPostAuthorId(postId: String) async throws -> String {
        let data = try await request(path: "/rest/v1/posts",
                                     query: ["id": "eq.\(postId)", "select": "user_id"])
        struct Row: Codable { let userId: String; enum CodingKeys: String, CodingKey { case userId = "user_id" } }
        return try decode([Row].self, from: data).first?.userId ?? ""
    }

    // MARK: - Follow
    func getFollowStatus(targetId: String) async throws -> String {
        guard let uid = AppState.shared.currentUser?.id else { return "none" }
        let data = try await request(path: "/rest/v1/follows",
                                     query: ["follower_id": "eq.\(uid)",
                                             "following_id": "eq.\(targetId)", "select": "following_id"])
        if let arr = try? JSONDecoder().decode([[String: String]].self, from: data), !arr.isEmpty {
            return "following"
        }
        let reqData = try await request(path: "/rest/v1/follow_requests",
                                        query: ["requester_id": "eq.\(uid)",
                                                "target_id": "eq.\(targetId)", "select": "id"])
        if let reqs = try? JSONDecoder().decode([[String: String]].self, from: reqData), !reqs.isEmpty {
            return "requested"
        }
        return "none"
    }

    func follow(targetId: String, isPrivate: Bool) async throws -> String {
        guard let uid = AppState.shared.currentUser?.id else { throw SparkError.auth("Not logged in") }
        if isPrivate {
            let body = try jsonBody(["requester_id": uid, "target_id": targetId])
            try await request(path: "/rest/v1/follow_requests", method: "POST",
                              body: body, prefer: "return=minimal")
            try? await createNotification(type: "follow_request", actorId: uid, userId: targetId)
            return "requested"
        } else {
            let body = try jsonBody(["follower_id": uid, "following_id": targetId])
            try await request(path: "/rest/v1/follows", method: "POST",
                              body: body, prefer: "return=minimal")
            try? await createNotification(type: "follow", actorId: uid, userId: targetId)
            return "following"
        }
    }

    func unfollow(targetId: String) async throws {
        guard let uid = AppState.shared.currentUser?.id else { return }
        try await request(path: "/rest/v1/follows", method: "DELETE",
                          query: ["follower_id": "eq.\(uid)", "following_id": "eq.\(targetId)"])
    }

    func cancelFollowRequest(targetId: String) async throws {
        guard let uid = AppState.shared.currentUser?.id else { return }
        try await request(path: "/rest/v1/follow_requests", method: "DELETE",
                          query: ["requester_id": "eq.\(uid)", "target_id": "eq.\(targetId)"])
    }

    func getFollowRequests() async throws -> [FollowRequest] {
        guard let uid = AppState.shared.currentUser?.id else { return [] }
        let data = try await request(path: "/rest/v1/follow_requests",
                                     query: ["target_id": "eq.\(uid)",
                                             "select": "*,profiles(*)",
                                             "order": "created_at.desc"])
        return try decode([FollowRequest].self, from: data)
    }

    func acceptFollowRequest(requesterId: String) async throws {
        guard let uid = AppState.shared.currentUser?.id else { return }
        let body = try jsonBody(["follower_id": requesterId, "following_id": uid])
        try await request(path: "/rest/v1/follows", method: "POST", body: body, prefer: "return=minimal")
        try await request(path: "/rest/v1/follow_requests", method: "DELETE",
                          query: ["requester_id": "eq.\(requesterId)", "target_id": "eq.\(uid)"])
    }

    func denyFollowRequest(requesterId: String) async throws {
        guard let uid = AppState.shared.currentUser?.id else { return }
        try await request(path: "/rest/v1/follow_requests", method: "DELETE",
                          query: ["requester_id": "eq.\(requesterId)", "target_id": "eq.\(uid)"])
    }

    func getFollowers(userId: String) async throws -> [SparkUser] {
        let data = try await request(path: "/rest/v1/follows",
                                     query: ["following_id": "eq.\(userId)",
                                             "select": "profiles!follower_id(*)", "limit": "200"])
        struct Row: Codable { let profiles: SparkUser?; enum CodingKeys: String, CodingKey { case profiles } }
        return try decode([Row].self, from: data).compactMap { $0.profiles }
    }

    func getFollowing(userId: String) async throws -> [SparkUser] {
        let data = try await request(path: "/rest/v1/follows",
                                     query: ["follower_id": "eq.\(userId)",
                                             "select": "profiles!following_id(*)", "limit": "200"])
        struct Row: Codable { let profiles: SparkUser?; enum CodingKeys: String, CodingKey { case profiles } }
        return try decode([Row].self, from: data).compactMap { $0.profiles }
    }

    func getFollowerCount(userId: String) async throws -> Int {
        let data = try await request(path: "/rest/v1/follows",
                                     query: ["following_id": "eq.\(userId)", "select": "follower_id"])
        let arr = try? JSONDecoder().decode([[String: String]].self, from: data)
        return arr?.count ?? 0
    }

    func getFollowingCount(userId: String) async throws -> Int {
        let data = try await request(path: "/rest/v1/follows",
                                     query: ["follower_id": "eq.\(userId)", "select": "following_id"])
        let arr = try? JSONDecoder().decode([[String: String]].self, from: data)
        return arr?.count ?? 0
    }

    // MARK: - Messages
    func getMessages(partnerId: String) async throws -> [Message] {
        guard let uid = AppState.shared.currentUser?.id else { return [] }
        let data = try await request(path: "/rest/v1/messages",
                                     query: ["or": "(and(sender_id.eq.\(uid),receiver_id.eq.\(partnerId)),and(sender_id.eq.\(partnerId),receiver_id.eq.\(uid)))",
                                             "order": "created_at.asc", "limit": "200"])
        let msgs = try decode([Message].self, from: data)
        Task {
            let body = try? jsonBody(["read_at": ISO8601DateFormatter().string(from: Date())])
            try? await request(path: "/rest/v1/messages", method: "PATCH", body: body,
                               query: ["sender_id": "eq.\(partnerId)", "receiver_id": "eq.\(uid)", "read_at": "is.null"])
        }
        return msgs
    }

    func sendMessage(to receiverId: String, content: String) async throws -> Message {
        guard let uid = AppState.shared.currentUser?.id else { throw SparkError.auth("Not logged in") }
        let body = try jsonBody(["sender_id": uid, "receiver_id": receiverId, "content": content])
        let data = try await request(path: "/rest/v1/messages", method: "POST",
                                     body: body, prefer: "return=representation")
        let arr = try decode([Message].self, from: data)
        guard let msg = arr.first else { throw SparkError.unknown }
        try? await createNotification(type: "dm", actorId: uid, userId: receiverId)
        return msg
    }

    func getConversations() async throws -> [Conversation] {
        guard let uid = AppState.shared.currentUser?.id else { return [] }
        let data = try await request(path: "/rest/v1/messages",
                                     query: ["or": "(sender_id.eq.\(uid),receiver_id.eq.\(uid))",
                                             "order": "created_at.desc", "limit": "300"])
        let msgs = try decode([Message].self, from: data)
        var seen = Set<String>()
        var partnerMsgs: [(String, Message)] = []
        for msg in msgs {
            let partner = msg.senderId == uid ? msg.receiverId : msg.senderId
            if !seen.contains(partner) { seen.insert(partner); partnerMsgs.append((partner, msg)) }
        }
        var result: [Conversation] = []
        for (partnerId, msg) in partnerMsgs {
            if let partner = try? await getProfile(userId: partnerId) {
                let unread = msgs.filter { $0.senderId == partnerId && $0.receiverId == uid && $0.readAt == nil }.count
                result.append(Conversation(id: partnerId, partner: partner, lastMessage: msg, unreadCount: unread))
            }
        }
        return result
    }

    // MARK: - Contact / Suggestions
    func submitContactForm(name: String, message: String) async throws {
        let uid = AppState.shared.currentUser?.id
        var payload: [String: Any] = ["message": message]
        if !name.isEmpty { payload["name"] = name }
        if let uid { payload["user_id"] = uid }
        try await request(path: "/rest/v1/suggestions", method: "POST",
                          body: try jsonBody(payload),
                          prefer: "return=minimal")
    }

    // MARK: - Notifications
    func getNotifications() async throws -> [SparkNotification] {
        guard let uid = AppState.shared.currentUser?.id else { return [] }
        let data = try await request(path: "/rest/v1/notifications",
                                     query: ["user_id": "eq.\(uid)",
                                             "select": "*,actors:profiles!actor_id(*)",
                                             "order": "created_at.desc", "limit": "50"])
        return try decode([SparkNotification].self, from: data)
    }

    func markNotificationsRead() async throws {
        guard let uid = AppState.shared.currentUser?.id else { return }
        let body = try jsonBody(["read": true])
        try await request(path: "/rest/v1/notifications", method: "PATCH",
                          body: body, query: ["user_id": "eq.\(uid)", "read": "eq.false"])
    }

    private func createNotification(type: String, actorId: String, userId: String, postId: String? = nil) async throws {
        guard actorId != userId else { return }   // don't notify yourself
        var payload: [String: Any] = ["type": type, "actor_id": actorId, "user_id": userId, "read": false]
        if let pid = postId { payload["post_id"] = pid }
        let body = try jsonBody(payload)
        try await request(path: "/rest/v1/notifications", method: "POST", body: body, prefer: "return=minimal")
    }

    // MARK: - Tunes
    func searchTunes(query: String) async throws -> [iTunesSong] {
        // Call iTunes Search API directly — no auth needed, no CORS on native iOS
        let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        guard let url = URL(string: "https://itunes.apple.com/search?term=\(encoded)&media=music&entity=song&limit=25") else {
            throw SparkError.unknown
        }
        let (data, _) = try await URLSession.shared.data(from: url)
        return try decode(iTunesSearchResponse.self, from: data).results
    }

    func setTune(_ song: iTunesSong?) async throws {
        var updates: [String: Any]
        if let s = song {
            updates = ["song_title": s.trackName, "song_artist": s.artistName,
                       "song_artwork_url": s.artworkUrl100,
                       "song_preview_url": s.previewUrl as Any]
        } else {
            updates = ["song_title": NSNull(), "song_artist": NSNull(),
                       "song_artwork_url": NSNull(), "song_preview_url": NSNull()]
        }
        _ = try await updateProfile(updates)
    }

    // MARK: - Stats
    func getMyStats() async throws -> StatsData {
        guard let uid = AppState.shared.currentUser?.id else { return StatsData() }

        async let postsReq     = request(path: "/rest/v1/posts",
                                          query: ["user_id": "eq.\(uid)", "select": "id,content,created_at", "limit": "500"])
        async let followersReq = request(path: "/rest/v1/follows",
                                          query: ["following_id": "eq.\(uid)", "select": "follower_id"])
        async let followingReq = request(path: "/rest/v1/follows",
                                          query: ["follower_id": "eq.\(uid)", "select": "following_id"])

        struct MiniPost: Codable {
            let id: String; let content: String; let createdAt: String
            enum CodingKeys: String, CodingKey { case id, content; case createdAt = "created_at" }
        }

        let posts   = (try? decode([MiniPost].self, from: try await postsReq))   ?? []
        let fwrs    = (try? JSONDecoder().decode([[String:String]].self, from: try await followersReq)) ?? []
        let fwing   = (try? JSONDecoder().decode([[String:String]].self, from: try await followingReq)) ?? []

        // Count slaps on my posts
        let myPostIds = posts.map { $0.id }
        var slapCount = 0
        if !myPostIds.isEmpty {
            let inClause = "(\(myPostIds.joined(separator: ",")))"
            let rxData = try? await request(path: "/rest/v1/slaps",
                                             query: ["post_id": "in.\(inClause)", "select": "id"])
            slapCount = (try? JSONDecoder().decode([[String:String]].self, from: rxData ?? Data()))?.count ?? 0
        }

        var stats = StatsData()
        stats.postCount       = posts.count
        stats.followerCount   = fwrs.count
        stats.followingCount  = fwing.count
        stats.slapsReceived   = slapCount
        if !posts.isEmpty {
            stats.avgPostLength = Double(posts.map { $0.content.count }.reduce(0, +)) / Double(posts.count)
        }

        let cal = Calendar.current
        let now = Date()
        let fmt = ISO8601DateFormatter()
        fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        for post in posts {
            if let date = fmt.date(from: post.createdAt) ?? ISO8601DateFormatter().date(from: post.createdAt) {
                let day = cal.dateComponents([.day], from: date, to: now).day ?? 999
                if day < 7 { stats.weeklyPosts[6 - day] += 1 }
            }
        }
        return stats
    }

    // MARK: - Comments
    func getComments(postId: String) async throws -> [Comment] {
        let data = try await request(
            path: "/rest/v1/comments",
            query: [
                "post_id": "eq.\(postId)",
                "select": "id,post_id,user_id,content,created_at,profiles(id,username,full_name,avatar_url,avatar_letter,is_og,is_private)",
                "order": "created_at.asc",
                "limit": "50"
            ]
        )
        return (try? decode([Comment].self, from: data)) ?? []
    }

    func addComment(postId: String, content: String) async throws -> Comment {
        guard let uid = AppState.shared.currentUser?.id else { throw SparkError.unknown }
        let body = try jsonBody(["post_id": postId, "user_id": uid, "content": content])
        let data = try await request(
            path: "/rest/v1/comments",
            method: "POST",
            body: body,
            prefer: "return=representation"
        )
        struct Bare: Codable {
            let id, postId, userId, content, createdAt: String
            enum CodingKeys: String, CodingKey {
                case id, content
                case postId    = "post_id"
                case userId    = "user_id"
                case createdAt = "created_at"
            }
        }
        let bare = try decode([Bare].self, from: data).first!
        return Comment(id: bare.id, postId: bare.postId, userId: bare.userId,
                       content: bare.content, createdAt: bare.createdAt,
                       author: AppState.shared.currentUser)
    }

    func deleteComment(commentId: String) async throws {
        _ = try await request(path: "/rest/v1/comments",
                              method: "DELETE",
                              query: ["id": "eq.\(commentId)"],
                              prefer: "return=minimal")
    }

    // MARK: - Push Tokens
    func registerPushToken(_ token: String) async throws {
        guard let uid = AppState.shared.currentUser?.id else { return }
        let body = try jsonBody(["user_id": uid, "token": token, "platform": "ios"])
        try await request(path: "/rest/v1/push_tokens", method: "POST",
                          body: body, prefer: "return=minimal,resolution=merge-duplicates")
    }
}
