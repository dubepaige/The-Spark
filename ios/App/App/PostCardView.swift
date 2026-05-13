import SwiftUI

struct PostCardView: View {
    let post: Post
    var onSlap:   (() -> Void)?
    var onDelete: (() -> Void)?

    @EnvironmentObject var state: AppState
    @State private var showComments  = false
    @State private var comments:    [Comment] = []
    @State private var commentText  = ""
    @State private var loadingComments = false
    @State private var submitting   = false
    @FocusState private var commentFocused: Bool

    var slapCount: Int { post.slaps?.count ?? 0 }
    var myId: String? { state.currentUser?.id }
    var hasSlapped: Bool { post.slaps?.contains { $0.userId == myId } ?? false }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // ── Header ─────────────────────────────────────────────────────
            HStack(spacing: 10) {
                AvatarView(url: post.author?.avatarUrl, size: 38)

                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 4) {
                        Text(post.author?.displayName ?? "User")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(.white)
                        if post.author?.isOg == true { OGBadge() }
                    }
                    HStack(spacing: 4) {
                        Text("@\(post.author?.username ?? "")")
                            .font(.caption).foregroundColor(Color.sparkSubtext)
                        Text("·").foregroundColor(Color.sparkSubtext.opacity(0.5))
                        Text(post.createdAt.relativeTime())
                            .font(.caption).foregroundColor(Color.sparkSubtext)
                        if post.isCloseFriends {
                            Image(systemName: "star.fill").font(.system(size: 9)).foregroundColor(.yellow)
                        } else if post.isPrivate {
                            Image(systemName: "person.2.fill").font(.system(size: 9)).foregroundColor(Color.sparkSubtext)
                        }
                    }
                }

                Spacer()

                if onDelete != nil {
                    Menu {
                        Button(role: .destructive) { onDelete?() } label: {
                            Label("Delete Post", systemImage: "trash")
                        }
                    } label: {
                        Image(systemName: "ellipsis").foregroundColor(Color.sparkSubtext).padding(8)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)

            // ── Feeling badge ──────────────────────────────────────────────
            if let feeling = post.feeling, !feeling.isEmpty {
                Text(feeling)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(Color.sparkPurple)
                    .padding(.horizontal, 10).padding(.vertical, 3)
                    .background(Color.sparkPurple.opacity(0.12))
                    .cornerRadius(10)
                    .padding(.horizontal, 16).padding(.top, 8)
            }

            // ── Content ────────────────────────────────────────────────────
            Text(post.content)
                .font(.system(size: 15))
                .foregroundColor(.white)
                .lineSpacing(3)
                .padding(.horizontal, 16).padding(.top, 8)
                .frame(maxWidth: .infinity, alignment: .leading)

            // ── Media ──────────────────────────────────────────────────────
            if let mediaUrl = post.mediaUrl, let url = URL(string: mediaUrl) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let img):
                        img.resizable().scaledToFill()
                            .frame(maxWidth: .infinity).frame(height: 240).clipped()
                    default:
                        Color.sparkBorder.frame(height: 240)
                    }
                }
                .padding(.top, 10)
            }

            // ── Actions row ────────────────────────────────────────────────
            HStack(spacing: 12) {
                // Spark / like button
                Button {
                    withAnimation(.spring(response: 0.25, dampingFraction: 0.55)) { onSlap?() }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: hasSlapped ? "bolt.fill" : "bolt")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(
                                hasSlapped
                                    ? LinearGradient(colors: [Color(hex:"9B5CF5"), Color(hex:"EC4899")],
                                                     startPoint: .top, endPoint: .bottom)
                                    : LinearGradient(colors: [Color.sparkSubtext, Color.sparkSubtext],
                                                     startPoint: .top, endPoint: .bottom)
                            )
                            .scaleEffect(hasSlapped ? 1.1 : 1.0)

                        if slapCount > 0 {
                            Text("\(slapCount)")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundColor(hasSlapped ? Color(hex:"9B5CF5") : Color.sparkSubtext)
                        }
                    }
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .background(
                        hasSlapped
                            ? Color(hex:"9B5CF5").opacity(0.12)
                            : Color.sparkBorder.opacity(0.5)
                    )
                    .cornerRadius(20)
                    .overlay(
                        RoundedRectangle(cornerRadius: 20)
                            .stroke(
                                hasSlapped ? Color(hex:"9B5CF5").opacity(0.35) : Color.clear,
                                lineWidth: 1
                            )
                    )
                }
                .disabled(onSlap == nil)

                // Comment button
                Button {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.75)) {
                        showComments.toggle()
                        if showComments && comments.isEmpty { loadComments() }
                    }
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "bubble.left")
                            .font(.system(size: 15))
                            .foregroundColor(showComments ? Color.sparkPurple : Color.sparkSubtext)
                        if !comments.isEmpty {
                            Text("\(comments.count)")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundColor(Color.sparkSubtext)
                        }
                    }
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(Color.sparkBorder.opacity(0.5))
                    .cornerRadius(20)
                }

                Spacer()
            }
            .padding(.horizontal, 16).padding(.vertical, 10)

            // ── Comments section ───────────────────────────────────────────
            if showComments {
                VStack(alignment: .leading, spacing: 0) {
                    Divider().background(Color.sparkBorder)

                    if loadingComments {
                        ProgressView().tint(Color.sparkPurple)
                            .frame(maxWidth: .infinity).padding(.vertical, 12)
                    } else {
                        // Comment list
                        ForEach(comments) { comment in
                            CommentRowView(comment: comment, myId: myId) {
                                deleteComment(comment)
                            }
                        }

                        if comments.isEmpty {
                            Text("No comments yet. Be the first! ⚡")
                                .font(.system(size: 13))
                                .foregroundColor(Color.sparkSubtext)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                        }
                    }

                    Divider().background(Color.sparkBorder)

                    // Input row
                    HStack(spacing: 10) {
                        AvatarView(url: state.currentUser?.avatarUrl, size: 28)

                        TextField("Add a comment…", text: $commentText)
                            .font(.system(size: 14))
                            .foregroundColor(.white)
                            .focused($commentFocused)
                            .submitLabel(.send)
                            .onSubmit { submitComment() }

                        if !commentText.trimmingCharacters(in: .whitespaces).isEmpty {
                            Button {
                                submitComment()
                            } label: {
                                if submitting {
                                    ProgressView().tint(Color.sparkPurple).scaleEffect(0.8)
                                } else {
                                    Image(systemName: "arrow.up.circle.fill")
                                        .font(.system(size: 24))
                                        .foregroundColor(Color.sparkPurple)
                                }
                            }
                            .disabled(submitting)
                            .transition(.scale.combined(with: .opacity))
                        }
                    }
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .animation(.easeInOut(duration: 0.15), value: commentText.isEmpty)
                }
                .background(Color.sparkCard.opacity(0.5))
                .transition(.opacity.combined(with: .move(edge: .top)))
            }

            Divider().background(Color.sparkBorder)
        }
        .background(Color.sparkBg)
    }

    // MARK: - Helpers
    private func loadComments() {
        loadingComments = true
        Task {
            let fetched = (try? await SupabaseService.shared.getComments(postId: post.id)) ?? []
            await MainActor.run {
                comments = fetched
                loadingComments = false
            }
        }
    }

    private func submitComment() {
        let text = commentText.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty, !submitting else { return }
        submitting = true
        commentFocused = false
        Task {
            if let newComment = try? await SupabaseService.shared.addComment(postId: post.id, content: text) {
                await MainActor.run {
                    comments.append(newComment)
                    commentText = ""
                    submitting = false
                }
            } else {
                await MainActor.run { submitting = false }
            }
        }
    }

    private func deleteComment(_ comment: Comment) {
        Task {
            try? await SupabaseService.shared.deleteComment(commentId: comment.id)
            await MainActor.run {
                comments.removeAll { $0.id == comment.id }
            }
        }
    }
}

// MARK: - Comment Row
struct CommentRowView: View {
    let comment: Comment
    let myId: String?
    let onDelete: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            AvatarView(url: comment.author?.avatarUrl, size: 28)

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(comment.author?.displayName ?? "User")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.white)
                    Text(comment.createdAt.relativeTime())
                        .font(.system(size: 11))
                        .foregroundColor(Color.sparkSubtext)
                }
                Text(comment.content)
                    .font(.system(size: 13))
                    .foregroundColor(.white.opacity(0.9))
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer()

            if comment.userId == myId || comment.author?.id == myId {
                Button {
                    withAnimation { onDelete() }
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(Color.sparkSubtext)
                        .padding(5)
                }
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
    }
}
