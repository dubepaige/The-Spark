import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Cropper from 'https://esm.sh/cropperjs@1.6.1'

// ===== CONFIG =====
const SUPABASE_URL      = 'https://jqrefxdumksvddrohmts.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_hcJBTW3HNyFHd1pBEczxwA_PE0BJs62'
const supabase          = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ===== STATE =====
let currentUser    = null
let currentProfile = null
let activePage     = 'feed'
let sparkedPosts   = new Set()
let pendingFile     = null   // file selected for upload
let cropperInstance = null   // Cropper.js instance
let followingIds    = new Set() // profile IDs currentUser follows
let activeHashtag   = null   // hashtag currently filtering the feed
let activeConvoId   = null   // profile ID of open DM conversation
let msgChannel      = null   // Supabase Realtime channel
let postIsPrivate   = false  // privacy state for the composer
let feedTab         = 'explore' // 'explore' | 'following'

// ===== INIT =====
async function init() {
  const { data: { session } } = await supabase.auth.getSession()
  if (session) await setUser(session.user)

  supabase.auth.onAuthStateChange(async (_event, session) => {
    if (session) await setUser(session.user)
    else         clearUser()
  })

  setupComposer()
  setupAuthModal()
  setupNav()
  setupHamburger()
  setupCropModal()
  setupSuggestionsModal()
  setupSearch()
  setupFeedTabs()
  await navigateTo('feed')
  await loadWhoList()
}

// ===== NAV / ROUTING =====
function setupNav() {
  document.querySelectorAll('[data-page]').forEach(link => {
    link.addEventListener('click', async e => {
      e.preventDefault()
      closeMobileNav()
      await navigateTo(link.dataset.page)
    })
  })
}

async function navigateTo(page) {
  activePage = page

  document.querySelectorAll('.nav-link, .mobile-nav-link').forEach(l => {
    l.classList.toggle('active', l.dataset.page === page)
  })

  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'))
  const pageEl = document.getElementById(`page-${page}`)
  if (pageEl) pageEl.classList.remove('hidden')

  if (page === 'feed')      await loadFeed()
  if (page === 'videos')    await loadVideos()
  if (page === 'profiles')  await loadProfiles()
  if (page === 'myprofile') await loadMyProfile()
  if (page === 'messages')  await loadMessages()
  if (page === 'games')     loadGames()
  // 'about' is static HTML — nothing to load
}

// ===== HAMBURGER (mobile) =====
function setupHamburger() {
  const btn = document.getElementById('hamburger')
  btn.addEventListener('click', () => {
    btn.classList.toggle('open')
    document.getElementById('mobileNav').classList.toggle('hidden')
  })
}
function closeMobileNav() {
  document.getElementById('hamburger').classList.remove('open')
  document.getElementById('mobileNav').classList.add('hidden')
}

// ===== AUTH =====
async function setUser(user) {
  currentUser = user
  const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  currentProfile = data

  // Show My Profile nav link
  document.querySelectorAll('.nav-myprofile, .mobile-myprofile').forEach(el => el.classList.remove('hidden'))

  // Header
  const headerUser = document.getElementById('headerUser')
  const avatarHTML = avatarEl(currentProfile, 'header-avatar')
  headerUser.innerHTML = `
    <div class="header-user-info" id="headerUserInfo">
      ${avatarHTML}
      <span class="header-username">@${currentProfile?.username || user.email}</span>
    </div>
    <button class="btn btn-logout" id="logoutBtn">Log Out</button>
  `
  document.getElementById('logoutBtn').addEventListener('click', signOut)
  document.getElementById('headerUserInfo').addEventListener('click', () => navigateTo('myprofile'))

  setEl('sidebarName',   currentProfile?.full_name || currentProfile?.username || '')
  setEl('sidebarHandle', `@${currentProfile?.username || ''}`)
  document.querySelectorAll('.nav-messages, .mobile-messages').forEach(el => el.classList.remove('hidden'))
  refreshAvatarDisplays()
  document.getElementById('postBtn').disabled = false
  await Promise.all([loadUserStats(), loadSparkedPosts(), loadFollowingIds()])
}

function clearUser() {
  currentUser = null; currentProfile = null
  followingIds.clear(); activeHashtag = null; activeConvoId = null
  if (msgChannel) { supabase.removeChannel(msgChannel); msgChannel = null }

  document.querySelectorAll('.nav-myprofile, .mobile-myprofile').forEach(el => el.classList.add('hidden'))
  document.querySelectorAll('.nav-messages, .mobile-messages').forEach(el => el.classList.add('hidden'))

  const headerUser = document.getElementById('headerUser')
  headerUser.innerHTML = `
    <button class="btn btn-login"  id="loginBtn">Log In</button>
    <button class="btn btn-signup" id="signupBtn">Sign Up</button>
  `
  document.getElementById('loginBtn').addEventListener('click',  () => openModal('login'))
  document.getElementById('signupBtn').addEventListener('click', () => openModal('signup'))

  setEl('composerAvatar', '?')
  setEl('sidebarAvatar',  '?')
  setEl('sidebarName',    'Guest')
  setEl('sidebarHandle',  '@thespark')
  setEl('statPosts',      '0')
  setEl('statLikes',      '0')
  document.getElementById('postBtn').disabled = true
  sparkedPosts.clear()
}

async function signOut() { await supabase.auth.signOut() }

function refreshAvatarDisplays() {
  if (!currentProfile) return
  const letter = currentProfile.avatar_letter || '?'
  const url    = currentProfile.avatar_url

  const applyAvatar = (el, size) => {
    if (!el) return
    if (url) {
      el.innerHTML = `<img src="${url}" alt="${letter}" />`
    } else {
      el.textContent = letter
    }
    el.style.background = url ? 'none' : colorFromLetter(letter)
  }

  applyAvatar(document.getElementById('composerAvatar'))
  applyAvatar(document.getElementById('sidebarAvatar'))
  applyAvatar(document.getElementById('myAvatar'))

  // Header avatar
  const ha = document.querySelector('.header-avatar')
  if (ha) {
    ha.innerHTML = url ? `<img src="${url}" alt="${letter}" />` : letter
    ha.style.background = url ? 'none' : colorFromLetter(letter)
  }
}

async function loadUserStats() {
  if (!currentUser) return
  const [{ count: postCount }, { count: sparkCount }] = await Promise.all([
    supabase.from('posts').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id),
    supabase.from('slaps').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id),
  ])
  setEl('statPosts', postCount ?? 0)
  setEl('statLikes', sparkCount ?? 0)
}

async function loadSparkedPosts() {
  if (!currentUser) return
  const { data } = await supabase.from('slaps').select('post_id').eq('user_id', currentUser.id)
  sparkedPosts = new Set((data || []).map(s => s.post_id))
}

async function loadFollowingIds() {
  if (!currentUser) return
  const { data } = await supabase.from('follows').select('following_id').eq('follower_id', currentUser.id)
  followingIds = new Set((data || []).map(f => f.following_id))
}

// ===== AUTH MODAL =====
function setupAuthModal() {
  document.getElementById('loginBtn')?.addEventListener('click',  () => openModal('login'))
  document.getElementById('signupBtn')?.addEventListener('click', () => openModal('signup'))
  document.getElementById('modalClose').addEventListener('click', closeModal)
  document.getElementById('authModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal() })
  document.getElementById('tabLogin').addEventListener('click',  () => switchModalTab('login'))
  document.getElementById('tabSignup').addEventListener('click', () => switchModalTab('signup'))

  // Login
  document.getElementById('loginForm').addEventListener('submit', async e => {
    e.preventDefault()
    const username = document.getElementById('loginUsername').value.trim()
    const password = document.getElementById('loginPassword').value
    const errEl    = document.getElementById('loginError')
    errEl.classList.add('hidden')

    const { data: profile, error: lookupErr } = await supabase
      .from('profiles').select('email').eq('username', username).maybeSingle()

    if (lookupErr || !profile?.email) {
      showError(errEl, 'Invalid username or password'); return
    }
    const { error } = await supabase.auth.signInWithPassword({ email: profile.email, password })
    if (error) showError(errEl, 'Invalid username or password')
    else closeModal()
  })

  // Signup
  document.getElementById('signupForm').addEventListener('submit', async e => {
    e.preventDefault()
    const fullName = document.getElementById('signupFullName').value.trim()
    const username = document.getElementById('signupUsername').value.trim()
    const email    = document.getElementById('signupEmail').value.trim()
    const birthday = document.getElementById('signupBirthday').value
    const password = document.getElementById('signupPassword').value
    const confirm  = document.getElementById('signupPasswordConfirm').value
    const errEl    = document.getElementById('signupError')
    errEl.classList.add('hidden')

    if (!fullName)                              { showError(errEl, 'Please enter your full name'); return }
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) { showError(errEl, 'Username: 3–30 chars, letters/numbers/underscores'); return }
    if (password !== confirm)                   { showError(errEl, 'Passwords do not match'); return }
    if (!birthday)                              { showError(errEl, 'Please enter your birthday'); return }

    const { data: existing } = await supabase.from('profiles').select('id').eq('username', username).maybeSingle()
    if (existing) { showError(errEl, 'That username is already taken'); return }

    const { error } = await supabase.auth.signUp({
      email, password, options: { data: { username, full_name: fullName, birthday } }
    })
    if (error) showError(errEl, error.message)
    else closeModal()
  })
}

function openModal(tab = 'login') {
  document.getElementById('authModal').classList.remove('hidden')
  switchModalTab(tab)
}
function closeModal() { document.getElementById('authModal').classList.add('hidden') }
function switchModalTab(tab) {
  const isLogin = tab === 'login'
  document.getElementById('tabLogin').classList.toggle('active', isLogin)
  document.getElementById('tabSignup').classList.toggle('active', !isLogin)
  document.getElementById('loginForm').classList.toggle('hidden', !isLogin)
  document.getElementById('signupForm').classList.toggle('hidden', isLogin)
}

// ===== COMPOSER =====
function setupComposer() {
  const input      = document.getElementById('composerInput')
  const select     = document.getElementById('feelingSelect')
  const charCount  = document.getElementById('charCount')
  const postBtn    = document.getElementById('postBtn')
  const fileInput  = document.getElementById('mediaFileInput')
  const preview    = document.getElementById('mediaPreview')
  const removeBtn  = document.getElementById('mediaRemove')

  const customRow   = document.getElementById('customFeelingRow')
  const customInput = document.getElementById('customFeelingInput')
  const emojiBtn    = document.getElementById('emojiPickerBtn')
  const emojiPicker = document.getElementById('emojiPicker')
  const privacyBtn  = document.getElementById('postPrivacyBtn')

  const checkReady = () => {
    const isCustom = select.value === '__custom__'
    const feeling  = isCustom ? customInput.value.trim() : select.value
    postBtn.disabled = !currentUser || !feeling
  }

  // Emoji picker
  const EMOJIS = ['😊','😂','😍','🥰','😎','🤩','🥳','😜','🤪','😴','😢','😤','😬','😅','🤔','😈','🤓','👑','💅','⚡','✨','🌟','💕','💀','🔥','🎉','🎭','🎵','🎨','🏆','🍕','☕','🌈','🫶','💪','👀','😏','🤭','🫠','🙃']
  emojiPicker.innerHTML = EMOJIS.map(e => `<button type="button" class="emoji-opt">${e}</button>`).join('')
  emojiPicker.querySelectorAll('.emoji-opt').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      customInput.value += btn.textContent
      emojiPicker.classList.add('hidden')
      customInput.focus()
      checkReady()
    })
  })
  emojiBtn.addEventListener('click', e => { e.stopPropagation(); emojiPicker.classList.toggle('hidden') })
  document.addEventListener('click', () => emojiPicker.classList.add('hidden'))
  customInput.addEventListener('input', checkReady)

  select.addEventListener('change', () => {
    const isCustom = select.value === '__custom__'
    customRow.classList.toggle('hidden', !isCustom)
    if (isCustom) customInput.focus()
    checkReady()
  })

  // Post privacy toggle
  privacyBtn.addEventListener('click', () => {
    postIsPrivate = !postIsPrivate
    privacyBtn.textContent = postIsPrivate ? '🔒 Followers only' : '🌍 Public'
    privacyBtn.classList.toggle('privacy-private', postIsPrivate)
  })

  input.addEventListener('input', () => {
    const rem = 280 - input.value.length
    charCount.textContent = rem
    charCount.className   = 'char-count' + (rem < 20 ? ' danger' : rem < 60 ? ' warning' : '')
    checkReady()
  })

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0]
    if (!file) return
    pendingFile = file

    const previewImg = document.getElementById('mediaPreviewImg')
    const previewVid = document.getElementById('mediaPreviewVid')
    const url        = URL.createObjectURL(file)

    if (file.type.startsWith('image/')) {
      previewImg.src = url; previewImg.classList.remove('hidden')
      previewVid.classList.add('hidden')
    } else {
      previewVid.src = url; previewVid.classList.remove('hidden')
      previewImg.classList.add('hidden')
    }
    preview.classList.remove('hidden')
    checkReady()
  })

  removeBtn.addEventListener('click', () => {
    pendingFile = null
    fileInput.value = ''
    preview.classList.add('hidden')
    document.getElementById('mediaPreviewImg').classList.add('hidden')
    document.getElementById('mediaPreviewVid').classList.add('hidden')
  })

  postBtn.addEventListener('click', submitPost)
}

async function submitPost() {
  if (!currentUser) return
  const isCustom = document.getElementById('feelingSelect').value === '__custom__'
  const feeling  = isCustom
    ? document.getElementById('customFeelingInput').value.trim()
    : document.getElementById('feelingSelect').value
  const content  = document.getElementById('composerInput').value.trim()
  if (!feeling) return

  const postBtn = document.getElementById('postBtn')
  postBtn.disabled = true; postBtn.textContent = 'Sparking…'

  let media_url  = null
  let media_type = null

  // Upload media if present
  if (pendingFile) {
    const ext  = pendingFile.name.split('.').pop()
    const path = `${currentUser.id}/${Date.now()}.${ext}`
    const { error: uploadErr } = await supabase.storage
      .from('post-media').upload(path, pendingFile)

    if (uploadErr) {
      postBtn.disabled = false; postBtn.textContent = 'Spark it!'
      alert('Upload failed: ' + uploadErr.message); return
    }
    const { data: { publicUrl } } = supabase.storage.from('post-media').getPublicUrl(path)
    media_url  = publicUrl
    media_type = pendingFile.type.startsWith('image/') ? 'image' : 'video'
  }

  const { error } = await supabase.from('posts').insert({
    user_id: currentUser.id, feeling, content, media_url, media_type, is_private: postIsPrivate
  })

  postBtn.textContent = 'Spark it!'

  if (!error) {
    document.getElementById('feelingSelect').value = ''
    document.getElementById('customFeelingRow').classList.add('hidden')
    document.getElementById('customFeelingInput').value = ''
    document.getElementById('postPrivacyBtn').textContent = '🌍 Public'
    document.getElementById('postPrivacyBtn').classList.remove('privacy-private')
    postIsPrivate = false
    document.getElementById('composerInput').value = ''
    document.getElementById('mediaPreview').classList.add('hidden')
    document.getElementById('mediaRemove').click()
    document.getElementById('charCount').textContent = '280'
    postBtn.disabled = true
    pendingFile = null
    await loadFeed()
    await loadUserStats()
  } else {
    postBtn.disabled = false
    console.error('Post error:', error)
  }
}

// ===== FEED TABS =====
function setupFeedTabs() {
  document.querySelectorAll('.feed-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.feed-tab').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      feedTab = btn.dataset.tab
      activeHashtag = null
      loadFeed()
    })
  })
}

// ===== FEED PAGE =====
async function loadFeed(tag = activeHashtag) {
  activeHashtag = tag
  const feed = document.getElementById('postsFeed')
  feed.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>'

  // Following tab: gate on login
  if (feedTab === 'following' && !currentUser) {
    feed.innerHTML = ''
    feed.appendChild(document.createRange().createContextualFragment(
      emptyState('👥', 'Log in to see your Following feed', "Follow people to see their posts here.")
    ))
    return
  }

  const { data: posts, error } = await supabase
    .from('posts')
    .select('*, profiles(id, username, full_name, avatar_letter, avatar_url, is_private, birthday, college, industry)')
    .order('created_at', { ascending: false })
    .limit(150)

  feed.innerHTML = ''

  // Hashtag filter bar
  if (tag) {
    const bar = document.createElement('div')
    bar.className = 'hashtag-filter-bar'
    bar.innerHTML = `<span class="hashtag-filter-label">#${escapeHtml(tag)}</span>
      <button class="hashtag-filter-clear" id="clearHashtag">✕ Clear filter</button>`
    bar.querySelector('#clearHashtag').addEventListener('click', () => loadFeed(null))
    feed.appendChild(bar)
  }

  let visible = posts || []

  // Filter private accounts
  visible = visible.filter(post => {
    if (!post.profiles?.is_private)      return true
    if (!currentUser)                    return false
    if (post.user_id === currentUser.id) return true
    return followingIds.has(post.user_id)
  })

  // Filter private posts
  visible = visible.filter(post => {
    if (!post.is_private)                return true
    if (!currentUser)                    return false
    if (post.user_id === currentUser.id) return true
    return followingIds.has(post.user_id)
  })

  // Following tab: only posts from followed users + own
  if (feedTab === 'following') {
    visible = visible.filter(post =>
      post.user_id === currentUser.id || followingIds.has(post.user_id)
    )
    if (!visible.length) {
      feed.appendChild(document.createRange().createContextualFragment(
        emptyState('👥', 'Nothing here yet', "Follow some people to see their posts.")
      ))
      return
    }
  }

  // Explore tab: sort by relevance (same college/industry first), then newest
  if (feedTab === 'explore' && currentProfile) {
    visible.sort((a, b) => {
      const score = p => {
        let s = 0
        if (currentProfile.college  && p.profiles?.college  === currentProfile.college)  s += 2
        if (currentProfile.industry && p.profiles?.industry === currentProfile.industry) s += 1
        return s
      }
      const diff = score(b) - score(a)
      return diff !== 0 ? diff : new Date(b.created_at) - new Date(a.created_at)
    })
  }

  // Filter by hashtag
  if (tag) {
    const re = new RegExp(`#${tag}\\b`, 'i')
    visible = visible.filter(p => re.test(p.content || '') || re.test(p.feeling || ''))
  }

  if (error || !visible.length) {
    feed.appendChild(document.createRange().createContextualFragment(
      emptyState('⚡', tag ? `No posts tagged #${tag}` : 'No sparks yet!',
        currentUser ? 'Be the first to post.' : "Log in to start sparkin'.")
    ))
    return
  }
  visible.forEach(post => feed.appendChild(renderPost(post)))
}

// ===== VIDEOS PAGE =====
async function loadVideos() {
  const grid = document.getElementById('videosGrid')
  grid.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>'

  const { data: posts } = await supabase
    .from('posts')
    .select('*, profiles(username, full_name, avatar_letter, avatar_url)')
    .eq('media_type', 'video')
    .order('created_at', { ascending: false })
    .limit(40)

  grid.innerHTML = ''
  if (!posts?.length) {
    grid.innerHTML = `<div class="empty-state card" style="grid-column:1/-1">${emptyState('🎬','No videos yet!','Upload a video to be first.')}</div>`
    return
  }

  posts.forEach(post => {
    const profile = post.profiles || {}
    const letter  = profile.avatar_letter || '?'
    const card    = document.createElement('div')
    card.className = 'video-card'
    card.innerHTML = `
      <div class="video-card-thumb">
        <video src="${post.media_url}" preload="metadata"></video>
      </div>
      <div class="video-card-info">
        <div class="video-card-feeling">${escapeHtml(post.feeling || '')}</div>
        ${post.content ? `<div class="video-card-caption">"${escapeHtml(post.content)}"</div>` : ''}
        <div class="video-card-user">
          <div class="avatar-circle video-card-avatar" style="background:${colorFromLetter(letter)}">${letter}</div>
          <span class="video-card-username">${escapeHtml(profile.full_name || profile.username || 'Unknown')}</span>
          <span class="video-card-time">${timeAgo(post.created_at)}</span>
        </div>
      </div>
    `
    // Click → open full post in feed
    card.addEventListener('click', () => navigateTo('feed'))
    grid.appendChild(card)
  })
}

// ===== PROFILES PAGE =====
async function loadProfiles() {
  const grid   = document.getElementById('profilesGrid')
  const detail = document.getElementById('profileDetail')
  grid.classList.remove('hidden'); detail.classList.add('hidden')
  grid.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>'

  const { data: profiles } = await supabase
    .from('profiles')
    .select('*, posts(count)')
    .order('created_at', { ascending: false })

  grid.innerHTML = ''
  if (!profiles?.length) {
    grid.innerHTML = `<div class="empty-state card" style="grid-column:1/-1">${emptyState('✨','No profiles yet!','Sign up to be first.')}</div>`
    return
  }

  // Sort: same college (2pts) + same industry (1pt) first, then everyone else
  if (currentProfile?.college || currentProfile?.industry) {
    profiles.sort((a, b) => {
      const score = p => {
        let s = 0
        if (currentProfile.college  && p.college  === currentProfile.college)  s += 2
        if (currentProfile.industry && p.industry === currentProfile.industry) s += 1
        return s
      }
      return score(b) - score(a)
    })
  }

  profiles.forEach(p => {
    const postCount = p.posts?.[0]?.count ?? 0
    const letter    = p.avatar_letter || '?'
    const card      = document.createElement('div')
    card.className  = 'profile-card'

    const avatarInner = p.avatar_url
      ? `<img src="${p.avatar_url}" alt="${letter}" />`
      : letter

    const metaParts = []
    if (p.college)  metaParts.push(`🎓 ${escapeHtml(p.college)}`)
    if (p.industry) metaParts.push(`💼 ${escapeHtml(p.industry)}`)

    card.innerHTML = `
      <div class="avatar-circle profile-card-avatar" style="background:${p.avatar_url ? 'none' : colorFromLetter(letter)}">${avatarInner}</div>
      <div class="profile-card-name">${escapeHtml(p.full_name || p.username)}</div>
      <div class="profile-card-handle">@${escapeHtml(p.username)} ${zodiacEmoji(p.birthday)}</div>
      <div class="profile-card-posts">${postCount} post${postCount !== 1 ? 's' : ''}</div>
      ${metaParts.length ? `<div class="profile-card-meta">${metaParts.join(' · ')}</div>` : ''}
    `
    card.addEventListener('click', () => openProfileDetail(p))
    grid.appendChild(card)
  })
}

async function openProfileDetail(profile) {
  document.getElementById('profilesGrid').classList.add('hidden')
  const detail = document.getElementById('profileDetail')
  detail.classList.remove('hidden')

  const letter    = profile.avatar_letter || '?'
  const avatarEl_ = document.getElementById('detailAvatar')
  avatarEl_.textContent = ''
  if (profile.avatar_url) {
    avatarEl_.innerHTML = `<img src="${profile.avatar_url}" alt="${letter}" />`
    avatarEl_.style.background = 'none'
  } else {
    avatarEl_.textContent    = letter
    avatarEl_.style.background = colorFromLetter(letter)
  }
  setEl('detailName',   profile.full_name || profile.username)
  setEl('detailHandle', `@${profile.username} ${zodiacEmoji(profile.birthday)}`)

  // College / industry
  const detailMetaEl = document.getElementById('detailMeta')
  if (detailMetaEl) {
    const parts = []
    if (profile.college)  parts.push(`🎓 ${escapeHtml(profile.college)}`)
    if (profile.industry) parts.push(`💼 ${escapeHtml(profile.industry)}`)
    detailMetaEl.textContent = parts.join('  ·  ')
    detailMetaEl.classList.toggle('hidden', parts.length === 0)
  }

  // Follower count
  const { count: followerCount } = await supabase
    .from('follows').select('*', { count: 'exact', head: true }).eq('following_id', profile.id)
  setEl('detailFollowerCount', followerCount ?? 0)

  // Private indicator
  const namEl = document.getElementById('detailName')
  if (namEl && profile.is_private) {
    if (!namEl.querySelector('.private-badge')) {
      namEl.insertAdjacentHTML('beforeend', ' <span class="private-badge">🔒 Private</span>')
    }
  }

  // DM button
  const dmBtn = document.getElementById('dmBtn')
  if (currentUser && currentUser.id !== profile.id) {
    dmBtn.classList.remove('hidden')
    dmBtn.onclick = () => { navigateTo('messages').then(() => openConversation(profile)) }
  } else {
    dmBtn.classList.add('hidden')
  }

  // Follow button (only for other users)
  const followBtn = document.getElementById('followBtn')
  if (currentUser && currentUser.id !== profile.id) {
    followBtn.classList.remove('hidden')
    const { data: existing } = await supabase
      .from('follows').select('id').eq('follower_id', currentUser.id).eq('following_id', profile.id).maybeSingle()

    const isFollowing = !!existing
    followBtn.textContent = isFollowing ? 'Following' : 'Follow'
    followBtn.className   = `btn-follow${isFollowing ? ' following' : ''}`
    followBtn.onclick     = () => toggleFollow(profile.id, followBtn)
  } else {
    followBtn.classList.add('hidden')
  }

  // Their posts
  const feed = document.getElementById('profilePostsFeed')
  feed.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>'
  const { data: posts } = await supabase
    .from('posts')
    .select('*, profiles(id, username, full_name, avatar_letter, avatar_url)')
    .eq('user_id', profile.id)
    .order('created_at', { ascending: false })

  // Filter private posts — same rules as the feed
  const visible = (posts || []).filter(post => {
    if (!post.is_private)                return true
    if (!currentUser)                    return false
    if (post.user_id === currentUser.id) return true
    return followingIds.has(post.user_id)
  })

  setEl('detailPostCount', visible.length)
  feed.innerHTML = ''
  if (!visible.length) {
    feed.innerHTML = emptyState('🌟', 'No posts yet!', '')
    return
  }
  visible.forEach(post => feed.appendChild(renderPost(post)))

  document.getElementById('backToProfiles').onclick = loadProfiles
}

// ===== MY PROFILE PAGE =====
async function loadMyProfile() {
  if (!currentUser) { openModal('login'); return }

  const letter = currentProfile?.avatar_letter || '?'
  const url    = currentProfile?.avatar_url

  // Avatar
  const myAvatarEl = document.getElementById('myAvatar')
  myAvatarEl.textContent = ''
  if (url) {
    myAvatarEl.innerHTML = `<img src="${url}" alt="${letter}" />`
    myAvatarEl.style.background = 'none'
  } else {
    myAvatarEl.textContent    = letter
    myAvatarEl.style.background = colorFromLetter(letter)
  }

  setEl('myProfileName',   currentProfile?.full_name || currentProfile?.username || '')
  setEl('myProfileHandle', `@${currentProfile?.username || ''} ${zodiacEmoji(currentProfile?.birthday)}`)

  // Stats
  const [{ count: postCount }, { count: followingCount }, { count: followerCount }] = await Promise.all([
    supabase.from('posts').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id),
    supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', currentUser.id),
    supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', currentUser.id),
  ])
  setEl('myPostCount',      postCount      ?? 0)
  setEl('myFollowingCount', followingCount ?? 0)
  setEl('myFollowerCount',  followerCount  ?? 0)

  // Stat chips → open follows modal
  document.getElementById('myStatFollowing').onclick = () => openFollowsModal('following')
  document.getElementById('myStatFollowers').onclick = () => openFollowsModal('followers')
  document.getElementById('myStatPosts').onclick     = null

  // College / Industry edit fields
  const editCollege  = document.getElementById('editCollege')
  const editIndustry = document.getElementById('editIndustry')
  if (editCollege)  editCollege.value  = currentProfile?.college  || ''
  if (editIndustry) editIndustry.value = currentProfile?.industry || ''

  // Meta line display (college / industry)
  const metaEl = document.getElementById('myProfileMeta')
  if (metaEl) {
    const parts = []
    if (currentProfile?.college)  parts.push(`🎓 ${currentProfile.college}`)
    if (currentProfile?.industry) parts.push(`💼 ${currentProfile.industry}`)
    metaEl.textContent   = parts.join('  ·  ')
    metaEl.style.display = parts.length ? '' : 'none'
  }

  // Private account toggle
  const privateToggle = document.getElementById('privateToggle')
  if (privateToggle) {
    privateToggle.checked = !!currentProfile?.is_private
    privateToggle.onchange = async () => {
      await supabase.from('profiles').update({ is_private: privateToggle.checked }).eq('id', currentUser.id)
      currentProfile.is_private = privateToggle.checked
    }
  }

  // Save profile button
  document.getElementById('saveProfileBtn').onclick = saveProfile

  // Avatar upload → opens crop modal instead of uploading directly
  const avatarInput = document.getElementById('avatarFileInput')
  avatarInput.onchange = handleAvatarFileSelect

  // My posts
  const feed = document.getElementById('myPostsFeed')
  feed.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>'
  const { data: posts } = await supabase
    .from('posts')
    .select('*, profiles(id, username, full_name, avatar_letter, avatar_url)')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false })

  feed.innerHTML = ''
  if (!posts?.length) {
    feed.innerHTML = emptyState('✨', 'No posts yet!', 'Head to the feed and spark something.')
    return
  }
  posts.forEach(post => feed.appendChild(renderPost(post, true)))
}

// ===== AVATAR UPLOAD + CROP =====
function handleAvatarFileSelect(e) {
  const file = e.target.files[0]
  if (!file || !currentUser) return
  const reader = new FileReader()
  reader.onload = ev => openCropModal(ev.target.result)
  reader.readAsDataURL(file)
  e.target.value = '' // reset so same file can be re-selected
}

function openCropModal(src) {
  const modal = document.getElementById('cropModal')
  const img   = document.getElementById('cropImage')
  if (cropperInstance) { cropperInstance.destroy(); cropperInstance = null }
  img.src = src
  modal.classList.remove('hidden')
  img.onload = () => {
    cropperInstance = new Cropper(img, {
      aspectRatio: 1,
      viewMode: 1,
      dragMode: 'move',
      autoCropArea: 0.9,
      cropBoxMovable: false,
      cropBoxResizable: false,
      toggleDragModeOnDblclick: false,
      guides: false,
      center: false,
      highlight: false,
      background: false,
    })
  }
}

function closeCropModal() {
  if (cropperInstance) { cropperInstance.destroy(); cropperInstance = null }
  document.getElementById('cropModal').classList.add('hidden')
  document.getElementById('cropImage').src = ''
}

async function confirmCrop() {
  if (!cropperInstance || !currentUser) return
  const btn = document.getElementById('cropConfirm')
  btn.textContent = 'Saving…'; btn.disabled = true

  const canvas = cropperInstance.getCroppedCanvas({ width: 400, height: 400 })
  canvas.toBlob(async blob => {
    const path = `${currentUser.id}/avatar.jpg`
    const { error } = await supabase.storage
      .from('avatars').upload(path, blob, { upsert: true, contentType: 'image/jpeg' })

    btn.textContent = '✓ Save Photo'; btn.disabled = false
    if (error) { alert('Upload failed: ' + error.message); return }

    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)
    await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', currentUser.id)
    currentProfile.avatar_url = publicUrl
    refreshAvatarDisplays()
    closeCropModal()
    await loadMyProfile()
  }, 'image/jpeg', 0.92)
}

function setupCropModal() {
  document.getElementById('cropModalClose').addEventListener('click', closeCropModal)
  document.getElementById('cropCancel').addEventListener('click',    closeCropModal)
  document.getElementById('cropConfirm').addEventListener('click',   confirmCrop)
  document.getElementById('cropModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeCropModal()
  })
}

// ===== SAVE PROFILE =====
async function saveProfile() {
  if (!currentUser) return
  const college  = (document.getElementById('editCollege')?.value  || '').trim()
  const industry =  document.getElementById('editIndustry')?.value || ''

  const { error } = await supabase.from('profiles')
    .update({ college, industry }).eq('id', currentUser.id)

  if (!error) {
    currentProfile.college  = college
    currentProfile.industry = industry
    const confirmEl = document.getElementById('saveConfirm')
    if (confirmEl) {
      confirmEl.classList.remove('hidden')
      setTimeout(() => confirmEl.classList.add('hidden'), 2500)
    }
    const metaEl = document.getElementById('myProfileMeta')
    if (metaEl) {
      const parts = []
      if (college)  parts.push(`🎓 ${college}`)
      if (industry) parts.push(`💼 ${industry}`)
      metaEl.textContent   = parts.join('  ·  ')
      metaEl.style.display = parts.length ? '' : 'none'
    }
  }
}

// ===== FOLLOWS =====
async function toggleFollow(profileId, btn) {
  if (!currentUser) { openModal('login'); return }

  const isFollowing = btn.classList.contains('following')
  if (isFollowing) {
    await supabase.from('follows').delete()
      .eq('follower_id', currentUser.id).eq('following_id', profileId)
    btn.textContent = 'Follow'
    btn.classList.remove('following')
    followingIds.delete(profileId)
  } else {
    await supabase.from('follows').insert({ follower_id: currentUser.id, following_id: profileId })
    btn.textContent = 'Following'
    btn.classList.add('following')
    followingIds.add(profileId)
  }

  // Refresh follower count
  const { count } = await supabase
    .from('follows').select('*', { count: 'exact', head: true }).eq('following_id', profileId)
  setEl('detailFollowerCount', count ?? 0)
}

async function openFollowsModal(type) {
  const modal     = document.getElementById('followsModal')
  const title     = document.getElementById('followsModalTitle')
  const list      = document.getElementById('followsList')
  const closeBtn  = document.getElementById('followsModalClose')

  title.textContent = type === 'following' ? 'Following' : 'Followers'
  list.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>'
  modal.classList.remove('hidden')

  closeBtn.onclick = () => modal.classList.add('hidden')
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden') })

  let query
  if (type === 'following') {
    query = supabase.from('follows')
      .select('profiles!follows_following_id_fkey(id, username, full_name, avatar_letter, avatar_url)')
      .eq('follower_id', currentUser.id)
  } else {
    query = supabase.from('follows')
      .select('profiles!follows_follower_id_fkey(id, username, full_name, avatar_letter, avatar_url)')
      .eq('following_id', currentUser.id)
  }

  const { data, error } = await query
  list.innerHTML = ''

  if (error || !data?.length) {
    list.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:20px">
      ${type === 'following' ? 'Not following anyone yet.' : 'No followers yet.'}
    </p>`
    return
  }

  data.forEach(row => {
    const p      = type === 'following' ? row.profiles : row.profiles
    const letter = p.avatar_letter || '?'
    const item   = document.createElement('div')
    item.className = 'follow-item'
    item.innerHTML = `
      <div class="avatar-circle follow-item-avatar" style="background:${p.avatar_url ? 'none' : colorFromLetter(letter)}">
        ${p.avatar_url ? `<img src="${p.avatar_url}" alt="${letter}" />` : letter}
      </div>
      <div>
        <div class="follow-item-name">${escapeHtml(p.full_name || p.username)}</div>
        <div class="follow-item-handle">@${escapeHtml(p.username)}</div>
      </div>
    `
    item.addEventListener('click', async () => {
      modal.classList.add('hidden')
      await navigateTo('profiles')
      await openProfileDetail(p)
    })
    list.appendChild(item)
  })
}

// ===== TOGGLE POST PRIVACY =====
async function togglePostPrivacy(postId, btn, article) {
  if (!currentUser) return
  const nowPrivate = btn.dataset.private === 'true'
  const newPrivate = !nowPrivate
  const { error } = await supabase.from('posts')
    .update({ is_private: newPrivate })
    .eq('id', postId).eq('user_id', currentUser.id)
  if (error) return
  btn.dataset.private = String(newPrivate)
  btn.textContent = newPrivate ? '🔒 Private' : '🌍 Public'
  btn.classList.toggle('is-private', newPrivate)
  const badge = article.querySelector('.post-private-badge')
  if (badge) badge.classList.toggle('hidden', !newPrivate)
}

// ===== DELETE POST =====
async function deletePost(postId, articleEl) {
  if (!currentUser) return
  if (!confirm('Delete this post?')) return
  const { error } = await supabase.from('posts').delete()
    .eq('id', postId).eq('user_id', currentUser.id)
  if (!error) {
    articleEl.style.opacity = '0'
    articleEl.style.transition = 'opacity 0.3s'
    setTimeout(() => articleEl.remove(), 300)
    await loadUserStats()
  }
}

// ===== RENDER POST =====
function renderPost(post, showDelete = false) {
  const template = document.getElementById('postTemplate')
  const el       = template.content.cloneNode(true)
  const article  = el.querySelector('.post')

  const profile = post.profiles || {}
  const letter  = profile.avatar_letter || '?'
  const name    = profile.full_name || profile.username || 'Unknown'
  const handle  = profile.username || 'user'

  article.dataset.postId = post.id

  // Avatar
  const avatarDiv = el.querySelector('.post-avatar')
  if (profile.avatar_url) {
    avatarDiv.innerHTML = `<img src="${profile.avatar_url}" alt="${letter}" />`
    avatarDiv.style.background = 'none'
  } else {
    avatarDiv.textContent    = letter
    avatarDiv.style.background = colorFromLetter(letter)
  }

  el.querySelector('.post-username').textContent = name
  el.querySelector('.post-handle').textContent   = `@${handle}`
  el.querySelector('.post-time').textContent     = timeAgo(post.created_at)

  // Feeling
  const feelingEl = el.querySelector('.post-feeling')
  if (post.feeling) {
    feelingEl.textContent = `Feeling: ${post.feeling}`
  } else if (post.content) {
    feelingEl.textContent = post.content
  }

  // Explanation (with clickable hashtags)
  const explanationEl = el.querySelector('.post-explanation')
  if (post.feeling && post.content) {
    explanationEl.innerHTML = withHashtags(`"${escapeHtml(post.content)}"`)
    explanationEl.querySelectorAll('.hashtag').forEach(tag => {
      tag.addEventListener('click', e => { e.stopPropagation(); navigateTo('feed').then(() => loadFeed(tag.dataset.tag)) })
    })
  }

  // Media
  if (post.media_url) {
    const mediaWrap = el.querySelector('.post-media')
    mediaWrap.classList.remove('hidden')
    if (post.media_type === 'image') {
      mediaWrap.innerHTML = `<img src="${post.media_url}" alt="post image" loading="lazy" />`
    } else if (post.media_type === 'video') {
      mediaWrap.innerHTML = `<video src="${post.media_url}" controls playsinline></video>`
    }
  }

  // Delete button + privacy toggle (own posts only)
  const isOwn = currentUser && (currentUser.id === post.user_id || currentUser.id === profile.id)
  if (isOwn || showDelete) {
    const delBtn = el.querySelector('.post-delete-btn')
    delBtn.classList.remove('hidden')
    delBtn.addEventListener('click', () => deletePost(post.id, article))

    const privBtn = el.querySelector('.post-toggle-privacy')
    privBtn.classList.remove('hidden')
    privBtn.textContent = post.is_private ? '🔒 Private' : '🌍 Public'
    privBtn.dataset.private = String(!!post.is_private)
    if (post.is_private) privBtn.classList.add('is-private')
    privBtn.addEventListener('click', () => togglePostPrivacy(post.id, privBtn, article))
  }

  // Private post badge (visible to everyone who can see the post)
  if (post.is_private) {
    const badge = el.querySelector('.post-private-badge')
    if (badge) badge.classList.remove('hidden')
  }

  // Spark (like)
  const slapBtn   = el.querySelector('.slap-btn')
  const slapCount = el.querySelector('.slap-count')
  slapCount.textContent = post.slap_count ?? 0
  if (sparkedPosts.has(post.id)) slapBtn.classList.add('slaped')
  slapBtn.addEventListener('click', () => toggleSpark(post.id, slapBtn, slapCount))

  // Comments
  const commentBtn      = el.querySelector('.comment-btn')
  const commentsSection = el.querySelector('.comments-section')
  commentBtn.addEventListener('click', async () => {
    const isOpen = !commentsSection.classList.contains('hidden')
    commentsSection.classList.toggle('hidden')
    if (!isOpen) await loadComments(post.id, commentsSection)
  })
  const commentInput  = el.querySelector('.comment-input')
  const commentSubmit = el.querySelector('.btn-comment-submit')
  commentSubmit.addEventListener('click', () => submitComment(post.id, commentInput, commentsSection))
  commentInput.addEventListener('keydown', e => { if (e.key === 'Enter') submitComment(post.id, commentInput, commentsSection) })

  return el
}

// ===== SPARKS =====
async function toggleSpark(postId, btn, countEl) {
  if (!currentUser) { openModal('login'); return }
  const isSparked = sparkedPosts.has(postId)
  if (isSparked) {
    sparkedPosts.delete(postId)
    btn.classList.remove('slaped')
    countEl.textContent = parseInt(countEl.textContent) - 1
    await supabase.from('slaps').delete().match({ post_id: postId, user_id: currentUser.id })
  } else {
    sparkedPosts.add(postId)
    btn.classList.add('slaped')
    countEl.textContent = parseInt(countEl.textContent) + 1
    await supabase.from('slaps').insert({ post_id: postId, user_id: currentUser.id })
  }
  await loadUserStats()
}

// ===== COMMENTS =====
async function loadComments(postId, section) {
  const list = section.querySelector('.comments-list')
  list.innerHTML = '<div class="loading-spinner" style="padding:14px"><div class="spinner"></div></div>'
  const { data: comments } = await supabase
    .from('comments')
    .select('*, profiles(username, full_name, avatar_letter, avatar_url)')
    .eq('post_id', postId).order('created_at', { ascending: true })

  list.innerHTML = ''
  if (!comments?.length) {
    list.innerHTML = '<p style="color:var(--text-muted);font-size:0.83rem;padding:4px 0">No comments yet.</p>'
    return
  }
  comments.forEach(c => list.appendChild(renderComment(c)))
}

function renderComment(c) {
  const div    = document.createElement('div')
  div.className = 'comment'
  const letter = c.profiles?.avatar_letter || '?'
  const url    = c.profiles?.avatar_url
  div.innerHTML = `
    <div class="avatar-circle comment-avatar" style="background:${url ? 'none' : colorFromLetter(letter)}">
      ${url ? `<img src="${url}" alt="${letter}" />` : letter}
    </div>
    <div class="comment-body">
      <div class="comment-author">${escapeHtml(c.profiles?.full_name || c.profiles?.username || 'Unknown')}</div>
      <div class="comment-text">${escapeHtml(c.content)}</div>
    </div>
  `
  return div
}

async function submitComment(postId, input, section) {
  if (!currentUser) { openModal('login'); return }
  const content = input.value.trim()
  if (!content) return
  const { error } = await supabase.from('comments').insert({ post_id: postId, user_id: currentUser.id, content })
  if (!error) { input.value = ''; await loadComments(postId, section) }
}

// ===== WHO'S SPARKIN' SIDEBAR =====
async function loadWhoList() {
  const { data: profiles } = await supabase
    .from('profiles').select('*').order('created_at', { ascending: false }).limit(5)

  const list = document.getElementById('whoList')
  list.innerHTML = ''
  if (!profiles?.length) {
    list.innerHTML = '<li style="color:var(--text-muted);font-size:0.83rem">No one yet!</li>'
    return
  }
  profiles.forEach(p => {
    const letter = p.avatar_letter || '?'
    const li     = document.createElement('li')
    li.className = 'who-item'
    li.innerHTML = `
      <div class="avatar-circle who-avatar" style="background:${p.avatar_url ? 'none' : colorFromLetter(letter)}">
        ${p.avatar_url ? `<img src="${p.avatar_url}" alt="${letter}" />` : letter}
      </div>
      <div class="who-info">
        <div class="who-name">${escapeHtml(p.full_name || p.username)}</div>
        <div class="who-handle">@${escapeHtml(p.username)}</div>
      </div>
    `
    li.addEventListener('click', async () => { await navigateTo('profiles'); await openProfileDetail(p) })
    list.appendChild(li)
  })
}

// ===== HASHTAGS =====
function withHashtags(html) {
  return html.replace(/#(\w+)/g, '<span class="hashtag" data-tag="$1">#$1</span>')
}

// ===== SEARCH =====
function setupSearch() {
  const btn   = document.getElementById('searchBtn')
  const modal = document.getElementById('searchModal')
  const input = document.getElementById('searchInput')
  const close = document.getElementById('searchClose')

  btn.addEventListener('click', () => {
    modal.classList.remove('hidden')
    setTimeout(() => input.focus(), 80)
  })
  close.addEventListener('click', () => { modal.classList.add('hidden'); input.value = ''; document.getElementById('searchResults').innerHTML = '' })
  modal.addEventListener('click', e => { if (e.target === modal) close.click() })

  let debounce
  input.addEventListener('input', () => {
    clearTimeout(debounce)
    debounce = setTimeout(() => performSearch(input.value.trim()), 280)
  })
}

async function performSearch(q) {
  const results = document.getElementById('searchResults')
  if (q.length < 2) { results.innerHTML = ''; return }

  // Strip leading # for tag searches
  const tag = q.startsWith('#') ? q.slice(1) : null
  const term = tag || q

  results.innerHTML = '<div class="loading-spinner" style="padding:20px"><div class="spinner"></div></div>'

  const [{ data: profiles }, { data: posts }] = await Promise.all([
    supabase.from('profiles')
      .select('id, username, full_name, avatar_letter, avatar_url, college, industry')
      .or(`username.ilike.%${term}%,full_name.ilike.%${term}%`)
      .limit(6),
    supabase.from('posts')
      .select('id, content, feeling, user_id, profiles(id, username, full_name, avatar_letter, avatar_url)')
      .or(`content.ilike.%${term}%,feeling.ilike.%${term}%`)
      .order('created_at', { ascending: false })
      .limit(8),
  ])

  results.innerHTML = ''

  if (profiles?.length) {
    results.insertAdjacentHTML('beforeend', `<div class="search-section-title">People</div>`)
    profiles.forEach(p => {
      const letter = p.avatar_letter || '?'
      const div = document.createElement('div')
      div.className = 'search-result'
      div.innerHTML = `
        <div class="avatar-circle search-result-avatar" style="background:${p.avatar_url ? 'none' : colorFromLetter(letter)}">
          ${p.avatar_url ? `<img src="${p.avatar_url}" alt="${letter}" />` : letter}
        </div>
        <div>
          <div class="search-result-name">${escapeHtml(p.full_name || p.username)}</div>
          <div class="search-result-sub">@${escapeHtml(p.username)}${p.college ? ` · 🎓 ${escapeHtml(p.college)}` : ''}</div>
        </div>`
      div.addEventListener('click', async () => {
        document.getElementById('searchModal').classList.add('hidden')
        await navigateTo('profiles')
        await openProfileDetail(p)
      })
      results.appendChild(div)
    })
  }

  if (posts?.length) {
    results.insertAdjacentHTML('beforeend', `<div class="search-section-title">Posts</div>`)
    posts.forEach(post => {
      const p = post.profiles || {}
      const div = document.createElement('div')
      div.className = 'search-result'
      div.innerHTML = `
        <div>
          <div class="search-result-name">${escapeHtml(post.feeling || '')}</div>
          <div class="search-result-sub">${escapeHtml((post.content || '').slice(0, 80))} · @${escapeHtml(p.username || '')}</div>
        </div>`
      div.addEventListener('click', async () => {
        document.getElementById('searchModal').classList.add('hidden')
        await navigateTo('feed')
      })
      results.appendChild(div)
    })
  }

  if (!profiles?.length && !posts?.length) {
    results.innerHTML = `<div class="search-empty">No results for "<strong>${escapeHtml(q)}</strong>"</div>`
  }
}

// ===== MESSAGES / DMs =====
async function loadMessages() {
  if (!currentUser) { openModal('login'); return }
  const convoView = document.getElementById('conversationView')
  const convoList = document.getElementById('conversationsList')
  convoView.classList.add('hidden')
  convoList.classList.remove('hidden')
  convoList.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>'

  if (msgChannel) { supabase.removeChannel(msgChannel); msgChannel = null }
  activeConvoId = null

  // Fetch all messages for current user
  const { data: msgs } = await supabase
    .from('messages')
    .select('*')
    .or(`sender_id.eq.${currentUser.id},receiver_id.eq.${currentUser.id}`)
    .order('created_at', { ascending: false })

  convoList.innerHTML = ''

  if (!msgs?.length) {
    convoList.innerHTML = emptyState('💬', 'No messages yet!', "Hit 💬 Message on someone's profile to start a chat.")
    return
  }

  // Group into one entry per other user (first occurrence = most recent)
  const seen = new Set()
  const convos = []
  for (const msg of msgs) {
    const otherId = msg.sender_id === currentUser.id ? msg.receiver_id : msg.sender_id
    if (!seen.has(otherId)) { seen.add(otherId); convos.push({ otherId, lastMsg: msg }) }
  }

  // Fetch profiles for the other users
  const { data: otherProfiles } = await supabase
    .from('profiles').select('id, username, full_name, avatar_letter, avatar_url')
    .in('id', [...seen])
  const profileMap = Object.fromEntries((otherProfiles || []).map(p => [p.id, p]))

  convos.forEach(({ otherId, lastMsg }) => {
    const p = profileMap[otherId] || {}
    const letter = p.avatar_letter || '?'
    const item = document.createElement('div')
    item.className = 'convo-item card'
    item.innerHTML = `
      <div class="avatar-circle convo-avatar" style="background:${p.avatar_url ? 'none' : colorFromLetter(letter)}">
        ${p.avatar_url ? `<img src="${p.avatar_url}" alt="${letter}" />` : letter}
      </div>
      <div class="convo-info">
        <div class="convo-name">${escapeHtml(p.full_name || p.username || 'Unknown')}</div>
        <div class="convo-preview">${lastMsg.sender_id === currentUser.id ? 'You: ' : ''}${escapeHtml(lastMsg.content.slice(0,60))}${lastMsg.content.length > 60 ? '…' : ''}</div>
      </div>
      <div class="convo-time">${timeAgo(lastMsg.created_at)}</div>`
    item.addEventListener('click', () => openConversation(p))
    convoList.appendChild(item)
  })
}

async function openConversation(profile) {
  if (!currentUser) return
  activeConvoId = profile.id
  const convoList = document.getElementById('conversationsList')
  const convoView = document.getElementById('conversationView')
  convoList.classList.add('hidden')
  convoView.classList.remove('hidden')

  // Header
  const letter = profile.avatar_letter || '?'
  document.getElementById('convoHeader').innerHTML = `
    <div class="avatar-circle convo-header-avatar" style="background:${profile.avatar_url ? 'none' : colorFromLetter(letter)}">
      ${profile.avatar_url ? `<img src="${profile.avatar_url}" alt="${letter}" />` : letter}
    </div>
    <div>
      <div class="convo-header-name">${escapeHtml(profile.full_name || profile.username)}</div>
      <div class="convo-header-handle">@${escapeHtml(profile.username)}</div>
    </div>`

  document.getElementById('backToConvos').onclick = () => loadMessages()

  // Load thread
  await refreshThread(profile.id)

  // Send button
  const input  = document.getElementById('dmInput')
  const sendBtn = document.getElementById('dmSendBtn')
  const doSend = async () => {
    const content = input.value.trim()
    if (!content) return
    input.value = ''
    await supabase.from('messages').insert({ sender_id: currentUser.id, receiver_id: profile.id, content })
    await refreshThread(profile.id)
  }
  sendBtn.onclick = doSend
  input.onkeydown = e => { if (e.key === 'Enter') doSend() }

  // Realtime: listen for incoming messages in this conversation
  if (msgChannel) supabase.removeChannel(msgChannel)
  msgChannel = supabase.channel(`dm-${currentUser.id}-${profile.id}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages',
        filter: `receiver_id=eq.${currentUser.id}` },
      payload => { if (payload.new.sender_id === profile.id) refreshThread(profile.id) })
    .subscribe()
}

async function refreshThread(otherId) {
  const thread = document.getElementById('messagesThread')
  const { data: msgs } = await supabase
    .from('messages').select('*')
    .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${currentUser.id})`)
    .order('created_at', { ascending: true })

  thread.innerHTML = ''
  ;(msgs || []).forEach(msg => {
    const mine = msg.sender_id === currentUser.id
    const bub  = document.createElement('div')
    bub.className = `msg-bubble ${mine ? 'mine' : 'theirs'}`
    bub.innerHTML = `<div class="msg-text">${escapeHtml(msg.content)}</div>
                     <div class="msg-time">${timeAgo(msg.created_at)}</div>`
    thread.appendChild(bub)
  })
  thread.scrollTop = thread.scrollHeight
}

// ===== GAMES =====
const TRIVIA = [
  { q: 'What school do the characters in Victorious attend?',           opts: ['Hollywood Arts','West Beverly High','Degrassi','Bayside High'],      ans: 0 },
  { q: 'Who plays Jade West in Victorious?',                           opts: ['Victoria Justice','Ariana Grande','Elizabeth Gillies','Daniella Monet'], ans: 2 },
  { q: 'What instrument does André Harris play?',                      opts: ['Guitar','Drums','Piano','Bass'],                                       ans: 2 },
  { q: "What is Robbie Shapiro's puppet named?",                       opts: ['Max','Rex','Tex','Flex'],                                              ans: 1 },
  { q: "Tori Vega's sister's name is:",                                opts: ['Trina','Tamara','Tracy','Tessa'],                                      ans: 0 },
  { q: "What does 'FOMO' stand for?",                                  opts: ['Feeling Of Missing Out','Fear Of Missing Out','Finding Other Moments Online','First On My Options'], ans: 1 },
  { q: 'Victorious first aired in what year?',                         opts: ['2008','2009','2010','2011'],                                           ans: 2 },
  { q: 'Cat Valentine is played by:',                                  opts: ['Victoria Justice','Ariana Grande','Jennette McCurdy','Liz Gillies'],   ans: 1 },
  { q: "'GOAT' stands for:",                                           opts: ['Greatest Of All Time','Going Over All Targets','Get Out And Try','Good On Any Team'], ans: 0 },
  { q: 'Which planet has the most known moons?',                       opts: ['Jupiter','Saturn','Uranus','Neptune'],                                 ans: 1 },
]
const VIBE_Q = [
  { q: "It's a Friday night. You're:",             opts: [{t:'Making something creative',v:'creator'},{t:'At the center of a party',v:'social'},{t:'Making people cry laughing',v:'comedian'},{t:'Doing exactly what you want, alone',v:'legend'}] },
  { q: 'Your go-to social media move:',            opts: [{t:'Posting your art or music',v:'creator'},{t:'Tagging everyone in memes',v:'social'},{t:'Posting an unhinged story',v:'comedian'},{t:'Lurking and saying nothing',v:'legend'}] },
  { q: 'You just got good news. You:',             opts: [{t:'Start a new project to celebrate',v:'creator'},{t:'Call everyone you know',v:'social'},{t:'Make a bit out of it',v:'comedian'},{t:'Smile quietly — you knew this would happen',v:'legend'}] },
  { q: 'People would describe you as:',            opts: [{t:'Talented and deep',v:'creator'},{t:'The life of the party',v:'social'},{t:'Unhinged but loveable',v:'comedian'},{t:'Iconic. That\'s it.',v:'legend'}] },
  { q: 'Your perfect collab:',                     opts: [{t:'Making art with someone',v:'creator'},{t:'A group hangout with 15+ people',v:'social'},{t:'Chaos. Pure chaos.',v:'comedian'},{t:'Solo. Why share the spotlight?',v:'legend'}] },
]
const VIBE_RESULTS = {
  creator:  { label: '🎨 The Creator',         desc: "You see the world differently. Whether it's music, art, or just the way you think — you're always making something beautiful." },
  social:   { label: '🌟 The Social Butterfly', desc: "You know everyone and everyone knows you. You light up any room just by showing up." },
  comedian: { label: '🤪 The Wild Card',        desc: "Unpredictable, hilarious, and lowkey a genius. No one ever knows what you're going to say next — and that's why everyone loves you." },
  legend:   { label: '👑 The Legend',           desc: "Confident, mysterious, undeniably iconic. You move different and you know it. The rest of them are still catching up." },
}
let triviaState = { idx: 0, score: 0 }
let vibeState   = { idx: 0, scores: { creator: 0, social: 0, comedian: 0, legend: 0 } }

function loadGames() {
  document.getElementById('gamesGrid').classList.remove('hidden')
  document.getElementById('gamePlayArea').classList.add('hidden')
  document.querySelectorAll('.game-start-btn').forEach(btn => {
    const newBtn = btn.cloneNode(true)
    btn.parentNode.replaceChild(newBtn, btn)
    newBtn.addEventListener('click', () => startGame(newBtn.dataset.game))
  })
}

function startGame(type) {
  document.getElementById('gamesGrid').classList.add('hidden')
  const area = document.getElementById('gamePlayArea')
  area.classList.remove('hidden')
  document.getElementById('gameBack').onclick = loadGames
  if (type === 'trivia') runTrivia()
  if (type === 'vibe')   runVibeCheck()
}

function runTrivia() {
  triviaState = { idx: 0, score: 0 }
  showTriviaQ()
}
function showTriviaQ() {
  const el = document.getElementById('gameContent')
  if (triviaState.idx >= TRIVIA.length) {
    const pct = Math.round(triviaState.score / TRIVIA.length * 100)
    const msg = pct >= 80 ? '⚡ Legend status!' : pct >= 60 ? '✨ Not bad!' : pct >= 40 ? '😬 Yikes!' : '🤡 Touch grass!'
    el.innerHTML = `<div class="trivia-done">
      <div class="trivia-score-big">${triviaState.score}/${TRIVIA.length}</div>
      <div class="trivia-pct">${pct}%</div>
      <div class="trivia-msg">${msg}</div>
      <button class="btn btn-post" id="retryTrivia">Try Again</button></div>`
    el.querySelector('#retryTrivia').addEventListener('click', runTrivia)
    return
  }
  const q = TRIVIA[triviaState.idx]
  el.innerHTML = `
    <div class="trivia-header">
      <span class="trivia-counter">Question ${triviaState.idx + 1} of ${TRIVIA.length}</span>
      <span class="trivia-score">Score: ${triviaState.score}</span>
    </div>
    <div class="trivia-progress"><div class="trivia-progress-bar" style="width:${triviaState.idx / TRIVIA.length * 100}%"></div></div>
    <div class="trivia-question">${escapeHtml(q.q)}</div>
    <div class="trivia-options">
      ${q.opts.map((o, i) => `<button class="trivia-opt" data-i="${i}">${escapeHtml(o)}</button>`).join('')}
    </div>`
  el.querySelectorAll('.trivia-opt').forEach(btn => btn.addEventListener('click', () => {
    const chosen = parseInt(btn.dataset.i)
    const correct = chosen === q.ans
    if (correct) triviaState.score++
    el.querySelectorAll('.trivia-opt').forEach((b, i) => {
      b.disabled = true
      if (i === q.ans)           b.classList.add('correct')
      if (i === chosen && !correct) b.classList.add('wrong')
    })
    setTimeout(() => { triviaState.idx++; showTriviaQ() }, 900)
  }))
}

function runVibeCheck() {
  vibeState = { idx: 0, scores: { creator: 0, social: 0, comedian: 0, legend: 0 } }
  showVibeQ()
}
function showVibeQ() {
  const el = document.getElementById('gameContent')
  if (vibeState.idx >= VIBE_Q.length) {
    const winner = Object.entries(vibeState.scores).sort((a, b) => b[1] - a[1])[0][0]
    const res = VIBE_RESULTS[winner]
    el.innerHTML = `<div class="vibe-result">
      <div class="vibe-label">${res.label}</div>
      <div class="vibe-desc">${res.desc}</div>
      <button class="btn btn-post" id="retryVibe">Retake</button></div>`
    el.querySelector('#retryVibe').addEventListener('click', runVibeCheck)
    return
  }
  const q = VIBE_Q[vibeState.idx]
  el.innerHTML = `
    <div class="trivia-header">
      <span class="trivia-counter">Question ${vibeState.idx + 1} of ${VIBE_Q.length}</span>
    </div>
    <div class="trivia-progress"><div class="trivia-progress-bar" style="width:${vibeState.idx / VIBE_Q.length * 100}%"></div></div>
    <div class="trivia-question">${escapeHtml(q.q)}</div>
    <div class="trivia-options">
      ${q.opts.map(o => `<button class="trivia-opt" data-v="${o.v}">${escapeHtml(o.t)}</button>`).join('')}
    </div>`
  el.querySelectorAll('.trivia-opt').forEach(btn => btn.addEventListener('click', () => {
    vibeState.scores[btn.dataset.v]++
    btn.classList.add('correct')
    el.querySelectorAll('.trivia-opt').forEach(b => b.disabled = true)
    setTimeout(() => { vibeState.idx++; showVibeQ() }, 500)
  }))
}

// ===== ZODIAC =====
function zodiacEmoji(birthday) {
  if (!birthday) return ''
  const d = new Date(birthday + 'T12:00:00') // noon to avoid timezone shifts
  const m = d.getMonth() + 1 // 1-12
  const day = d.getDate()
  if ((m === 3 && day >= 21) || (m === 4 && day <= 19)) return '♈' // Aries
  if ((m === 4 && day >= 20) || (m === 5 && day <= 20)) return '♉' // Taurus
  if ((m === 5 && day >= 21) || (m === 6 && day <= 20)) return '♊' // Gemini
  if ((m === 6 && day >= 21) || (m === 7 && day <= 22)) return '♋' // Cancer
  if ((m === 7 && day >= 23) || (m === 8 && day <= 22)) return '♌' // Leo
  if ((m === 8 && day >= 23) || (m === 9 && day <= 22)) return '♍' // Virgo
  if ((m === 9 && day >= 23) || (m === 10 && day <= 22)) return '♎' // Libra
  if ((m === 10 && day >= 23) || (m === 11 && day <= 21)) return '♏' // Scorpio
  if ((m === 11 && day >= 22) || (m === 12 && day <= 21)) return '♐' // Sagittarius
  if ((m === 12 && day >= 22) || (m === 1 && day <= 19)) return '♑' // Capricorn
  if ((m === 1 && day >= 20) || (m === 2 && day <= 18)) return '♒' // Aquarius
  return '♓' // Pisces (Feb 19 – Mar 20)
}

// ===== HELPERS =====
function setEl(id, val) { const el = document.getElementById(id); if (el) el.textContent = val }
function showError(el, msg) { el.textContent = msg; el.classList.remove('hidden') }

function avatarEl(profile, cls = '') {
  const letter = profile?.avatar_letter || '?'
  const url    = profile?.avatar_url
  if (url) return `<div class="${cls}" style="background:none;overflow:hidden;border-radius:50%"><img src="${url}" /></div>`
  return `<div class="${cls}" style="background:${colorFromLetter(letter)}">${letter}</div>`
}

function emptyState(icon, title, msg) {
  return `<div class="empty-state card"><div class="empty-icon">${icon}</div><h3>${title}</h3>${msg ? `<p>${msg}</p>` : ''}</div>`
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const m    = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function colorFromLetter(letter) {
  const colors = [
    'linear-gradient(135deg,#8B5CF6,#22D3EE)',
    'linear-gradient(135deg,#FF10F0,#8B5CF6)',
    'linear-gradient(135deg,#22D3EE,#FBBF24)',
    'linear-gradient(135deg,#39FF14,#22D3EE)',
    'linear-gradient(135deg,#FBBF24,#FF10F0)',
  ]
  return colors[(letter.charCodeAt(0) || 0) % colors.length]
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

// ===== SUGGESTIONS / CONTACT =====
function openSuggestionsModal() {
  const modal = document.getElementById('suggestionsModal')
  modal.classList.remove('hidden')
  // Pre-fill name if logged in
  const nameInput = document.getElementById('suggestName')
  if (nameInput && currentProfile) {
    nameInput.value = currentProfile.full_name || currentProfile.username || ''
  }
}

function closeSuggestionsModal() {
  document.getElementById('suggestionsModal').classList.add('hidden')
  document.getElementById('suggestForm').reset()
  document.getElementById('suggestError').classList.add('hidden')
  document.getElementById('suggestSuccess').classList.add('hidden')
}

function setupSuggestionsModal() {
  document.getElementById('suggestModalClose').addEventListener('click', closeSuggestionsModal)
  document.getElementById('suggestionsModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeSuggestionsModal()
  })
  document.getElementById('feedbackBtn').addEventListener('click', openSuggestionsModal)

  document.getElementById('suggestForm').addEventListener('submit', async e => {
    e.preventDefault()
    const name    = document.getElementById('suggestName').value.trim()
    const message = document.getElementById('suggestMessage').value.trim()
    const errEl   = document.getElementById('suggestError')
    const okEl    = document.getElementById('suggestSuccess')
    const btn     = document.getElementById('suggestSubmitBtn')
    errEl.classList.add('hidden'); okEl.classList.add('hidden')

    if (!message) { errEl.textContent = 'Please enter a message.'; errEl.classList.remove('hidden'); return }

    btn.disabled = true; btn.textContent = 'Sending…'
    const { error } = await supabase.from('suggestions').insert({
      user_id: currentUser?.id || null,
      name:    name || null,
      message,
    })
    btn.disabled = false; btn.textContent = 'Send It! ⚡'

    if (error) {
      errEl.textContent = 'Something went wrong — try again.'; errEl.classList.remove('hidden')
    } else {
      okEl.classList.remove('hidden')
      document.getElementById('suggestMessage').value = ''
      setTimeout(closeSuggestionsModal, 2400)
    }
  })
}

init()
