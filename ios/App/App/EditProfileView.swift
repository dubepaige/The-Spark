import SwiftUI
import PhotosUI

struct EditProfileView: View {
    @EnvironmentObject var state: AppState
    @Environment(\.dismiss) var dismiss

    @State private var fullName   = ""
    @State private var username   = ""
    @State private var bio        = ""
    @State private var college    = ""
    @State private var industry   = ""
    @State private var websiteUrl = ""
    @State private var birthday: Date = Calendar.current.date(byAdding: .year, value: -18, to: Date()) ?? Date()
    @State private var hasBirthday = false
    @State private var isPrivate  = false

    @State private var selectedPhoto: PhotosPickerItem?
    @State private var avatarImage:   Image?
    @State private var avatarData:    Data?

    @State private var loading  = false
    @State private var error: String?

    // Username availability
    @State private var usernameStatus: UsernameStatus = .idle
    @State private var usernameCheckTask: Task<Void, Never>?

    enum UsernameStatus {
        case idle, checking, available, taken, invalid, unchanged
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
        NavigationStack {
            ZStack {
                Color.sparkBg.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 20) {

                        // Avatar picker
                        PhotosPicker(selection: $selectedPhoto, matching: .images) {
                            ZStack(alignment: .bottomTrailing) {
                                if let avatarImage {
                                    avatarImage
                                        .resizable().scaledToFill()
                                        .frame(width: 90, height: 90)
                                        .clipShape(Circle())
                                } else {
                                    AvatarView(url: state.currentUser?.avatarUrl, size: 90)
                                }
                                Circle()
                                    .fill(Color.sparkPurple)
                                    .frame(width: 28, height: 28)
                                    .overlay(Image(systemName: "camera.fill")
                                        .font(.system(size: 12)).foregroundColor(.white))
                            }
                        }
                        .onChange(of: selectedPhoto) { item in
                            Task {
                                if let data = try? await item?.loadTransferable(type: Data.self),
                                   let uiImg = UIImage(data: data) {
                                    avatarData  = uiImg.jpegData(compressionQuality: 0.8)
                                    avatarImage = Image(uiImage: uiImg)
                                }
                            }
                        }
                        .padding(.top, 20)

                        VStack(spacing: 14) {

                            field(label: "Full Name") {
                                TextField("", text: $fullName,
                                          prompt: Text("Your name").foregroundColor(Color.sparkSubtext))
                                    .sparkInput()
                            }

                            field(label: "Username") {
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack {
                                        TextField("", text: $username,
                                                  prompt: Text("username").foregroundColor(Color.sparkSubtext))
                                            .autocapitalization(.none)
                                            .autocorrectionDisabled()
                                            .sparkInput()
                                            .onChange(of: username) { newVal in
                                                scheduleUsernameCheck(newVal)
                                            }
                                        if usernameStatus == .checking {
                                            ProgressView().tint(Color.sparkSubtext).scaleEffect(0.8)
                                                .padding(.trailing, 4)
                                        } else if usernameStatus == .available {
                                            Image(systemName: "checkmark.circle.fill")
                                                .foregroundColor(.green).padding(.trailing, 4)
                                        } else if usernameStatus == .taken || usernameStatus == .invalid {
                                            Image(systemName: "xmark.circle.fill")
                                                .foregroundColor(.red).padding(.trailing, 4)
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
                            }

                            field(label: "Bio") {
                                TextField("", text: $bio,
                                          prompt: Text("Tell people about yourself…").foregroundColor(Color.sparkSubtext),
                                          axis: .vertical)
                                    .lineLimit(4)
                                    .sparkInput()
                            }

                            field(label: "College / School") {
                                TextField("", text: $college,
                                          prompt: Text("e.g. NYU, Michigan State…").foregroundColor(Color.sparkSubtext))
                                    .sparkInput()
                            }

                            field(label: "Career / Industry") {
                                TextField("", text: $industry,
                                          prompt: Text("e.g. Music, Fashion, Tech…").foregroundColor(Color.sparkSubtext))
                                    .sparkInput()
                            }

                            field(label: "Website") {
                                TextField("", text: $websiteUrl,
                                          prompt: Text("https://…").foregroundColor(Color.sparkSubtext))
                                    .keyboardType(.URL)
                                    .autocapitalization(.none)
                                    .autocorrectionDisabled()
                                    .sparkInput()
                            }

                            // Birthday
                            VStack(alignment: .leading, spacing: 6) {
                                Text("Birthday")
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundColor(Color.sparkSubtext)
                                HStack {
                                    DatePicker("",
                                               selection: $birthday,
                                               in: ...Date(),
                                               displayedComponents: .date)
                                        .labelsHidden()
                                        .colorScheme(.dark)
                                    Spacer()
                                    if hasBirthday {
                                        Button("Clear") {
                                            hasBirthday = false
                                        }
                                        .font(.caption)
                                        .foregroundColor(Color.sparkSubtext)
                                    } else {
                                        Button("Set") {
                                            hasBirthday = true
                                        }
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundColor(Color.sparkPurple)
                                    }
                                }
                                .padding(14)
                                .background(Color.sparkCard)
                                .cornerRadius(12)
                                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.sparkBorder, lineWidth: 1))
                                .opacity(hasBirthday ? 1.0 : 0.5)
                            }

                            // Private toggle
                            Toggle(isOn: $isPrivate) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Private Account").foregroundColor(.white)
                                    Text("Only approved followers see your posts")
                                        .font(.caption).foregroundColor(Color.sparkSubtext)
                                }
                            }
                            .tint(Color.sparkPurple)
                            .padding(14)
                            .background(Color.sparkCard)
                            .cornerRadius(12)
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.sparkBorder, lineWidth: 1))
                        }
                        .padding(.horizontal, 20)

                        if let err = error {
                            Text(err).font(.caption).foregroundColor(.red)
                                .padding(.horizontal, 20)
                        }

                        PurpleButton(title: "Save Changes", loading: loading) { save() }
                            .padding(.horizontal, 20)
                            .padding(.bottom, 40)
                    }
                }
            }
            .navigationTitle("Edit Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.foregroundColor(Color.sparkSubtext)
                }
            }
        }
        .onAppear { prefill() }
    }

    private func field<C: View>(label: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.system(size: 12, weight: .medium)).foregroundColor(Color.sparkSubtext)
            content()
        }
    }

    private func scheduleUsernameCheck(_ value: String) {
        usernameCheckTask?.cancel()
        let clean = value.trimmingCharacters(in: .whitespaces)
        // If unchanged from original, no need to check
        if clean == state.currentUser?.username { usernameStatus = .idle; return }
        guard !clean.isEmpty else { usernameStatus = .idle; return }
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_"))
        guard clean.unicodeScalars.allSatisfy({ allowed.contains($0) }) else {
            usernameStatus = .invalid; return
        }
        usernameStatus = .checking
        let myId = state.currentUser?.id
        usernameCheckTask = Task {
            try? await Task.sleep(nanoseconds: 500_000_000)
            guard !Task.isCancelled else { return }
            let available = (try? await SupabaseService.shared.checkUsernameAvailable(clean, excludingId: myId)) ?? true
            await MainActor.run {
                guard !Task.isCancelled else { return }
                usernameStatus = available ? .available : .taken
            }
        }
    }

    private func prefill() {
        guard let u = state.currentUser else { return }
        fullName   = u.fullName
        username   = u.username
        bio        = u.bio ?? ""
        college    = u.college ?? ""
        industry   = u.industry ?? ""
        websiteUrl = u.websiteUrl ?? ""
        isPrivate  = u.isPrivate
        if let bd = u.birthday {
            birthday    = bd
            hasBirthday = true
        }
    }

    private func save() {
        guard usernameStatus != .taken   else { error = "That username is already taken"; return }
        guard usernameStatus != .invalid else { error = "Username can only contain letters, numbers and _"; return }
        loading = true; error = nil
        Task {
            do {
                // 1. Upload avatar if a new photo was picked
                var newAvatarUrl: String? = nil
                if let data = avatarData {
                    newAvatarUrl = try await SupabaseService.shared.uploadAvatar(data: data)
                }

                // 2. Build update payload
                var payload: [String: Any] = [
                    "full_name":   fullName,
                    "username":    username,
                    "bio":         bio.isEmpty ? NSNull() : bio,
                    "college":     college.isEmpty ? NSNull() : college,
                    "industry":    industry.isEmpty ? NSNull() : industry,
                    "website_url": websiteUrl.isEmpty ? NSNull() : websiteUrl,
                    "is_private":  isPrivate,
                    "birthday":    hasBirthday ? formatDate(birthday) : NSNull()
                ]
                if let url = newAvatarUrl { payload["avatar_url"] = url }

                let updated = try await SupabaseService.shared.updateProfile(payload)
                await MainActor.run { state.currentUser = updated; loading = false }
                try? await Task.sleep(nanoseconds: 300_000_000)
                await MainActor.run { dismiss() }
            } catch {
                await MainActor.run { self.error = error.localizedDescription; loading = false }
            }
        }
    }

    private func formatDate(_ date: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f.string(from: date)
    }
}

