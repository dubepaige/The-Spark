import Foundation

// MARK: - Auth
struct AuthSession: Codable {
    let accessToken: String
    let refreshToken: String
    let user: AuthUser
    enum CodingKeys: String, CodingKey {
        case accessToken  = "access_token"
        case refreshToken = "refresh_token"
        case user
    }
}
struct AuthUser: Codable {
    let id: String
    let email: String?
}

// MARK: - Profile  (table: profiles)
struct SparkUser: Codable, Identifiable, Equatable, Hashable {
    let id: String
    var username: String
    var fullName: String
    var avatarLetter: String?
    var avatarUrl: String?
    var isPrivate: Bool
    var songTitle: String?
    var songArtist: String?
    var songArtworkUrl: String?
    var songPreviewUrl: String?
    var college: String?
    var industry: String?
    var bio: String?
    var websiteUrl: String?
    var isOg: Bool
    var birthdayRaw: String?

    var birthday: Date? {
        guard let s = birthdayRaw else { return nil }
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        return f.date(from: s)
    }

    // Computed helper so UI can use a single display name field
    var displayName: String { fullName.isEmpty ? username : fullName }

    enum CodingKeys: String, CodingKey {
        case id, username, bio, college, industry
        case fullName       = "full_name"
        case avatarLetter   = "avatar_letter"
        case avatarUrl      = "avatar_url"
        case isPrivate      = "is_private"
        case isOg           = "is_og"
        case websiteUrl     = "website_url"
        case birthdayRaw    = "birthday"
        case songTitle      = "song_title"
        case songArtist     = "song_artist"
        case songArtworkUrl = "song_artwork_url"
        case songPreviewUrl = "song_preview_url"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id           = try c.decode(String.self,  forKey: .id)
        username     = try c.decode(String.self,  forKey: .username)
        fullName     = try c.decodeIfPresent(String.self, forKey: .fullName) ?? ""
        avatarLetter = try c.decodeIfPresent(String.self, forKey: .avatarLetter)
        avatarUrl    = try c.decodeIfPresent(String.self, forKey: .avatarUrl)
        isPrivate    = try c.decodeIfPresent(Bool.self,   forKey: .isPrivate) ?? false
        isOg         = try c.decodeIfPresent(Bool.self,   forKey: .isOg)      ?? false
        bio          = try c.decodeIfPresent(String.self, forKey: .bio)
        websiteUrl   = try c.decodeIfPresent(String.self, forKey: .websiteUrl)
        birthdayRaw  = try c.decodeIfPresent(String.self, forKey: .birthdayRaw)
        college      = try c.decodeIfPresent(String.self, forKey: .college)
        industry     = try c.decodeIfPresent(String.self, forKey: .industry)
        songTitle      = try c.decodeIfPresent(String.self, forKey: .songTitle)
        songArtist     = try c.decodeIfPresent(String.self, forKey: .songArtist)
        songArtworkUrl = try c.decodeIfPresent(String.self, forKey: .songArtworkUrl)
        songPreviewUrl = try c.decodeIfPresent(String.self, forKey: .songPreviewUrl)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id,             forKey: .id)
        try c.encode(username,       forKey: .username)
        try c.encode(fullName,       forKey: .fullName)
        try c.encodeIfPresent(avatarLetter,   forKey: .avatarLetter)
        try c.encodeIfPresent(avatarUrl,      forKey: .avatarUrl)
        try c.encode(isPrivate,      forKey: .isPrivate)
        try c.encode(isOg,           forKey: .isOg)
        try c.encodeIfPresent(bio,          forKey: .bio)
        try c.encodeIfPresent(websiteUrl,   forKey: .websiteUrl)
        try c.encodeIfPresent(birthdayRaw,  forKey: .birthdayRaw)
        try c.encodeIfPresent(college,      forKey: .college)
        try c.encodeIfPresent(industry,     forKey: .industry)
        try c.encodeIfPresent(songTitle,      forKey: .songTitle)
        try c.encodeIfPresent(songArtist,     forKey: .songArtist)
        try c.encodeIfPresent(songArtworkUrl, forKey: .songArtworkUrl)
        try c.encodeIfPresent(songPreviewUrl, forKey: .songPreviewUrl)
    }

    static func == (l: SparkUser, r: SparkUser) -> Bool { l.id == r.id }
    func hash(into h: inout Hasher) { h.combine(id) }
}

// MARK: - Posts  (table: posts)
struct Post: Codable, Identifiable {
    let id: String
    let userId: String
    var content: String
    var feeling: String?
    var mediaUrl: String?
    var mediaType: String?   // "image" | "video"
    var isPrivate: Bool
    var isCloseFriends: Bool
    let createdAt: String
    var author: SparkUser?
    var slaps: [Slap]?

    enum CodingKeys: String, CodingKey {
        case id, content, feeling, slaps
        case userId         = "user_id"
        case mediaUrl       = "media_url"
        case mediaType      = "media_type"
        case isPrivate      = "is_private"
        case isCloseFriends = "is_close_friends"
        case createdAt      = "created_at"
        case author         = "profiles"
    }
}

// MARK: - Slaps  (table: slaps — the reaction equivalent)
struct Slap: Codable, Identifiable {
    let id: String
    let postId: String
    let userId: String
    enum CodingKeys: String, CodingKey {
        case id
        case postId = "post_id"
        case userId = "user_id"
    }
}

// MARK: - Messages  (table: messages)
struct Message: Codable, Identifiable {
    let id: String
    let senderId: String
    let receiverId: String
    var content: String
    let createdAt: String
    var readAt: String?
    enum CodingKeys: String, CodingKey {
        case id, content
        case senderId   = "sender_id"
        case receiverId = "receiver_id"
        case createdAt  = "created_at"
        case readAt     = "read_at"
    }
}

struct Conversation: Identifiable {
    let id: String   // partner user id
    let partner: SparkUser
    var lastMessage: Message?
    var unreadCount: Int
}

// MARK: - Notifications  (table: notifications)
struct SparkNotification: Codable, Identifiable {
    let id: String
    let userId: String
    let type: String   // "follow" | "slap" | "dm" | "follow_request"
    let actorId: String
    let postId: String?
    let createdAt: String
    var actor: SparkUser?
    var read: Bool
    enum CodingKeys: String, CodingKey {
        case id, type, read
        case userId    = "user_id"
        case actorId   = "actor_id"
        case postId    = "post_id"
        case createdAt = "created_at"
        case actor     = "actors"
    }
}

// MARK: - Follow Request  (table: follow_requests)
struct FollowRequest: Codable, Identifiable {
    let id: String
    let requesterId: String
    let targetId: String
    let createdAt: String
    var requester: SparkUser?
    enum CodingKeys: String, CodingKey {
        case id
        case requesterId = "requester_id"
        case targetId    = "target_id"
        case createdAt   = "created_at"
        case requester   = "profiles"
    }
}

// MARK: - Tunes (iTunes Search API)
struct iTunesSearchResponse: Codable {
    let results: [iTunesSong]
}
struct iTunesSong: Codable, Identifiable {
    var id: Int { trackId }
    let trackId: Int
    let trackName: String
    let artistName: String
    let artworkUrl100: String
    let previewUrl: String?
}

// MARK: - Comments  (table: comments)
struct Comment: Codable, Identifiable {
    let id: String
    let postId: String
    let userId: String
    var content: String
    let createdAt: String
    var author: SparkUser?

    enum CodingKeys: String, CodingKey {
        case id, content
        case postId    = "post_id"
        case userId    = "user_id"
        case createdAt = "created_at"
        case author    = "profiles"
    }
}

// MARK: - Stats
struct StatsData {
    var postCount: Int        = 0
    var followerCount: Int    = 0
    var followingCount: Int   = 0
    var avgPostLength: Double = 0
    var slapsReceived: Int    = 0
    var weeklyPosts: [Int]    = Array(repeating: 0, count: 7)
}

// MARK: - Date helper
extension String {
    func relativeTime() -> String {
        let fmt = ISO8601DateFormatter()
        fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = fmt.date(from: self) ?? ISO8601DateFormatter().date(from: self) else { return "" }
        let diff = Date().timeIntervalSince(date)
        switch diff {
        case ..<60:      return "now"
        case ..<3600:    return "\(Int(diff / 60))m"
        case ..<86400:   return "\(Int(diff / 3600))h"
        case ..<604800:  return "\(Int(diff / 86400))d"
        default:
            let comps = Calendar.current.dateComponents([.weekOfYear], from: date, to: Date())
            return "\(comps.weekOfYear ?? 1)w"
        }
    }
}
