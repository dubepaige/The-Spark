import SwiftUI

struct ProfileView: View {
    @EnvironmentObject var state: AppState
    @State private var posts:    [Post] = []
    @State private var loading   = true
    @State private var showEdit  = false
    @State private var showTunes = false
    @State private var showStats = false
    @State private var showReqs  = false
    @State private var showGames         = false
    @State private var showContact       = false
    @State private var showDeleteConfirm = false
    @State private var deleteError: String?
    @State private var showAccounts      = false
    @State private var followRequests: [FollowRequest] = []
    @State private var followerCount  = 0
    @State private var followingCount = 0

    var user: SparkUser? { state.currentUser }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.sparkBg.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 0) {
                        profileHeader
                        if let song = user?.songTitle { tuneCard(song: song) }
                        postsSection
                    }
                }
            }
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    NavigationLink(destination: NotificationsView()) {
                        ZStack(alignment: .topTrailing) {
                            Image(systemName: state.unreadNotifications > 0 ? "bell.badge.fill" : "bell")
                                .foregroundColor(state.unreadNotifications > 0 ? Color(hex: "EC4899") : .white)
                                .font(.system(size: 18))
                            if state.unreadNotifications > 0 {
                                Text(state.unreadNotifications > 9 ? "9+" : "\(state.unreadNotifications)")
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundColor(.white)
                                    .padding(.horizontal, 4).padding(.vertical, 2)
                                    .background(Color(hex: "EC4899"))
                                    .clipShape(Capsule())
                                    .offset(x: 12, y: -6)
                            }
                        }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { showEdit     = true } label: { Label("Edit Profile",   systemImage: "pencil") }
                        Button { showStats   = true } label: { Label("My Stats",       systemImage: "chart.bar.fill") }
                        Button { showTunes   = true } label: { Label("Set Tune",       systemImage: "music.note") }
                        Button { showGames   = true } label: { Label("Games 🎮",        systemImage: "gamecontroller.fill") }
                        Button { showContact = true } label: { Label("Contact Us ⚡",   systemImage: "envelope.fill") }
                        Button { showAccounts = true } label: {
                            Label("Switch Account", systemImage: "person.2.circle")
                        }
                        if user?.isPrivate == true {
                            Button { showReqs = true } label: {
                                Label("Follow Requests\(followRequests.isEmpty ? "" : " (\(followRequests.count))")",
                                      systemImage: "person.badge.clock")
                            }
                        }
                        Divider()
                        Button(role: .destructive) { signOut() } label: {
                            Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                        }
                        Button(role: .destructive) { showDeleteConfirm = true } label: {
                            Label("Delete Account", systemImage: "trash.fill")
                        }
                    } label: {
                        Image(systemName: "line.3.horizontal").foregroundColor(.white)
                    }
                }
            }
            .sheet(isPresented: $showEdit)  { EditProfileView() }
            .sheet(isPresented: $showTunes) { TunesPickerView() }
            .sheet(isPresented: $showStats) { StatsView() }
            .sheet(isPresented: $showReqs)  { FollowRequestsView(requests: $followRequests) }
            .sheet(isPresented: $showGames)    { NavigationStack { GamesView() } }
            .sheet(isPresented: $showContact)  { ContactView() }
            .sheet(isPresented: $showAccounts) { AccountSwitcherView() }
            .alert("Delete Account", isPresented: $showDeleteConfirm) {
                Button("Cancel", role: .cancel) { }
                Button("Delete Forever", role: .destructive) { deleteAccount() }
            } message: {
                Text("This will permanently delete your account and all your posts. This cannot be undone.")
            }
            .alert("Couldn't delete account", isPresented: Binding(
                get: { deleteError != nil },
                set: { if !$0 { deleteError = nil } }
            )) {
                Button("OK", role: .cancel) { deleteError = nil }
            } message: {
                Text(deleteError ?? "")
            }
        }
        .task { await loadData() }
    }

    // MARK: Header
    private var profileHeader: some View {
        VStack(spacing: 0) {
            VStack(spacing: 14) {
                AvatarView(url: user?.avatarUrl, size: 84)
                    .shadow(color: Color.sparkPurple.opacity(0.4), radius: 12)

                VStack(spacing: 4) {
                    HStack(spacing: 8) {
                        Text(user?.displayName ?? "")
                            .font(.system(size: 22, weight: .bold)).foregroundColor(.white)
                        if user?.isOg == true {
                            OGBadge()
                        }
                    }
                    Text("@\(user?.username ?? "")").foregroundColor(Color.sparkSubtext)
                    if let bio = user?.bio, !bio.isEmpty {
                        Text(bio).font(.subheadline).foregroundColor(.white.opacity(0.8))
                            .multilineTextAlignment(.center).padding(.top, 2)
                    }
                    // College / Industry tags
                    HStack(spacing: 12) {
                        if let college = user?.college, !college.isEmpty {
                            Label(college, systemImage: "graduationcap.fill")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundColor(Color.sparkSubtext)
                        }
                        if let industry = user?.industry, !industry.isEmpty {
                            Label(industry, systemImage: "briefcase.fill")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundColor(Color.sparkSubtext)
                        }
                    }
                    if let url = user?.websiteUrl, !url.isEmpty,
                       let link = URL(string: url.hasPrefix("http") ? url : "https://\(url)") {
                        Link(url.replacingOccurrences(of: "https://", with: "").replacingOccurrences(of: "http://", with: ""),
                             destination: link)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundColor(Color.sparkPurple)
                    }
                }

                // Stats row
                HStack(spacing: 32) {
                    statItem(value: posts.count,    label: "Posts")
                    NavigationLink(destination: FollowListView(userId: user?.id ?? "", mode: .followers)) {
                        statItem(value: followerCount,  label: "Followers")
                    }
                    NavigationLink(destination: FollowListView(userId: user?.id ?? "", mode: .following)) {
                        statItem(value: followingCount, label: "Following")
                    }
                }
                .padding(.top, 4)

                Button { showEdit = true } label: {
                    Text("Edit Profile")
                        .font(.system(size: 14, weight: .semibold)).foregroundColor(.white)
                        .frame(maxWidth: .infinity).frame(height: 38)
                        .background(Color.sparkBorder).cornerRadius(10)
                }
                .padding(.horizontal, 48)
            }
            .padding(.vertical, 24).padding(.horizontal, 20)
            Divider().background(Color.sparkBorder)
        }
    }

    private func tuneCard(song: String) -> some View {
        HStack(spacing: 12) {
            if let art = user?.songArtworkUrl, let url = URL(string: art) {
                AsyncImage(url: url) { img in img.resizable().scaledToFill() }
                    placeholder: { Color.sparkBorder }
                    .frame(width: 44, height: 44).cornerRadius(8)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("Song of the Moment").font(.system(size: 10, weight: .medium)).foregroundColor(Color.sparkPurple)
                Text(song).font(.system(size: 13, weight: .semibold)).foregroundColor(.white)
                if let a = user?.songArtist { Text(a).font(.caption).foregroundColor(Color.sparkSubtext) }
            }
            Spacer()
            Image(systemName: "music.note").foregroundColor(Color.sparkPurple)
        }
        .padding(12)
        .background(Color.sparkCard)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.sparkBorder, lineWidth: 1))
        .padding(.horizontal, 16).padding(.vertical, 10)
    }

    private var postsSection: some View {
        Group {
            if loading {
                ProgressView().tint(Color.sparkPurple).padding(40)
            } else if posts.isEmpty {
                SparkEmptyView(icon: "photo.on.rectangle", title: "No posts yet",
                               subtitle: "Share your first moment")
            } else {
                LazyVStack(spacing: 1) {
                    ForEach(posts) { post in
                        PostCardView(post: post,
                                     onSlap: { slapPost(post) },
                                     onDelete: { deletePost(post) })
                    }
                }
            }
        }
    }

    private func statItem(value: Int, label: String) -> some View {
        VStack(spacing: 2) {
            Text("\(value)").font(.system(size: 18, weight: .bold)).foregroundColor(.white)
            Text(label).font(.caption).foregroundColor(Color.sparkSubtext)
        }
    }

    // MARK: Load
    private func loadData() async {
        guard let uid = user?.id else { return }
        async let postsTask    = SupabaseService.shared.getUserPosts(userId: uid)
        async let reqsTask     = SupabaseService.shared.getFollowRequests()
        async let fwrsTask     = SupabaseService.shared.getFollowerCount(userId: uid)
        async let fwingTask    = SupabaseService.shared.getFollowingCount(userId: uid)
        let posts    = (try? await postsTask)   ?? []
        let requests = (try? await reqsTask)    ?? []
        let fwrs     = (try? await fwrsTask)    ?? 0
        let fwing    = (try? await fwingTask)   ?? 0
        await MainActor.run {
            self.posts          = posts
            self.followRequests = requests
            self.followerCount  = fwrs
            self.followingCount = fwing
            loading = false
        }
    }

    private func slapPost(_ post: Post) {
        Task { try? await SupabaseService.shared.toggleSlap(postId: post.id); await loadData() }
    }
    private func deletePost(_ post: Post) {
        Task {
            try? await SupabaseService.shared.deletePost(postId: post.id)
            await MainActor.run { posts.removeAll { $0.id == post.id } }
        }
    }
    private func signOut() {
        Task { try? await SupabaseService.shared.signOut(); await MainActor.run { state.clearSession() } }
    }

    private func deleteAccount() {
        Task {
            do {
                try await SupabaseService.shared.deleteAccount()
                await MainActor.run { state.clearSession() }
            } catch {
                await MainActor.run { deleteError = error.localizedDescription }
            }
        }
    }
}

// MARK: - Follow List
enum FollowListMode { case followers, following }

struct FollowListView: View {
    let userId: String
    let mode: FollowListMode
    @State private var users:   [SparkUser] = []
    @State private var loading  = true
    var title: String { mode == .followers ? "Followers" : "Following" }

    var body: some View {
        ZStack {
            Color.sparkBg.ignoresSafeArea()
            if loading { SparkLoadingView() }
            else if users.isEmpty { SparkEmptyView(icon: "person.2", title: "Nobody yet", subtitle: "") }
            else {
                List(users) { u in
                    NavigationLink(destination: OtherProfileView(user: u)) { UserRowView(user: u) }
                        .listRowBackground(Color.sparkCard)
                }
                .listStyle(.plain).scrollContentBackground(.hidden)
            }
        }
        .navigationTitle(title)
        .task {
            users = (try? await (mode == .followers
                ? SupabaseService.shared.getFollowers(userId: userId)
                : SupabaseService.shared.getFollowing(userId: userId))) ?? []
            loading = false
        }
    }
}

// MARK: - Follow Requests
struct FollowRequestsView: View {
    @Binding var requests: [FollowRequest]
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                Color.sparkBg.ignoresSafeArea()
                if requests.isEmpty {
                    SparkEmptyView(icon: "person.badge.clock", title: "No requests", subtitle: "")
                } else {
                    List(requests) { req in
                        HStack(spacing: 12) {
                            AvatarView(url: req.requester?.avatarUrl, size: 40)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(req.requester?.displayName ?? "User")
                                    .font(.system(size: 14, weight: .semibold)).foregroundColor(.white)
                                Text("@\(req.requester?.username ?? "")")
                                    .font(.caption).foregroundColor(Color.sparkSubtext)
                            }
                            Spacer()
                            Button("Accept") { accept(req) }
                                .buttonStyle(.borderedProminent).tint(Color.sparkPurple).font(.caption)
                            Button("Deny") { deny(req) }
                                .buttonStyle(.bordered).tint(.red).font(.caption)
                        }
                        .listRowBackground(Color.sparkCard)
                    }
                    .listStyle(.plain).scrollContentBackground(.hidden)
                }
            }
            .navigationTitle("Follow Requests").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
        }
    }

    private func accept(_ req: FollowRequest) {
        Task {
            try? await SupabaseService.shared.acceptFollowRequest(requesterId: req.requesterId)
            await MainActor.run { requests.removeAll { $0.id == req.id } }
        }
    }
    private func deny(_ req: FollowRequest) {
        Task {
            try? await SupabaseService.shared.denyFollowRequest(requesterId: req.requesterId)
            await MainActor.run { requests.removeAll { $0.id == req.id } }
        }
    }
}
