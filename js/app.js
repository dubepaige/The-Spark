import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ===== CONFIG =====
const SUPABASE_URL      = 'https://jqrefxdumksvddrohmts.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_hcJBTW3HNyFHd1pBEczxwA_PE0BJs62'
const supabase          = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ===== STATE =====
let currentUser    = null
let currentProfile = null
let activePage     = 'feed'
let sparkedPosts   = new Set()

// ===== INIT =====
async function init() {
  const { data: { session } } = await supabase.auth.getSession()
  if (session) await setUser(session.user)

  supabase.auth.onAuthStateChange(async (_event, session) => {
    if (session) await setUser(session.user)
    else clearUser()
  })

  setupComposer()
  setupAuthModal()
  setupNav()
  await navigateTo('feed')
  await loadWhoList()
}

// ===== NAV / ROUTING =====
function setupNav() {
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', async e => {
      e.preventDefault()
      await navigateTo(link.dataset.page)
    })
  })
}

async function navigateTo(page) {
  activePage = page

  // Update nav active state
  document.querySelectorAll('.nav-link').forEach(l => {
    l.classList.toggle('active', l.dataset.page === page)
  })

  // Show correct page
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'))
  document.getElementById(`page-${page}`).classList.remove('hidden')

  // Load content
  if (page === 'feed')     await loadFeed()
  if (page === 'videos')   await loadVideos()
  if (page === 'profiles') await loadProfiles()
}

// ===== AUTH =====
async function setUser(user) {
  currentUser = user
  const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  currentProfile = data

  const headerUser = document.getElementById('headerUser')
  headerUser.innerHTML = `
    <div class="header-user-info">
      <div class="header-avatar">${currentProfile?.avatar_letter || '?'}</div>
      <span class="header-username">${currentProfile?.full_name || currentProfile?.username || user.email}</span>
    </div>
    <button class="btn btn-logout" id="logoutBtn">Log Out</button>
  `
  document.getElementById('logoutBtn').addEventListener('click', signOut)

  const composerAvatar = document.getElementById('composerAvatar')
  if (composerAvatar) composerAvatar.textContent = currentProfile?.avatar_letter || '?'

  const sidebarAvatar = document.getElementById('sidebarAvatar')
  const sidebarName   = document.getElementById('sidebarName')
  const sidebarHandle = document.getElementById('sidebarHandle')
  if (sidebarAvatar) sidebarAvatar.textContent = currentProfile?.avatar_letter || '?'
  if (sidebarName)   sidebarName.textContent   = currentProfile?.full_name || currentProfile?.username || user.email
  if (sidebarHandle) sidebarHandle.textContent  = `@${currentProfile?.username || 'user'}`

  document.getElementById('postBtn').disabled = false

  await loadUserStats()
  await loadSparkedPosts()
}

function clearUser() {
  currentUser = null; currentProfile = null

  const headerUser = document.getElementById('headerUser')
  headerUser.innerHTML = `
    <button class="btn btn-login"  id="loginBtn">Log In</button>
    <button class="btn btn-signup" id="signupBtn">Sign Up</button>
  `
  document.getElementById('loginBtn').addEventListener('click',  () => openModal('login'))
  document.getElementById('signupBtn').addEventListener('click', () => openModal('signup'))

  const els = {
    composerAvatar: '?', sidebarName: 'Guest',
    sidebarHandle: '@thespark', sidebarAvatar: '?',
    statPosts: '0', statLikes: '0',
  }
  Object.entries(els).forEach(([id, val]) => {
    const el = document.getElementById(id)
    if (el) el.textContent = val
  })
  document.getElementById('postBtn').disabled = true
  sparkedPosts.clear()
}

async function signOut() { await supabase.auth.signOut() }

async function loadUserStats() {
  if (!currentUser) return
  const [{ count: postCount }, { count: sparkCount }] = await Promise.all([
    supabase.from('posts').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id),
    supabase.from('slaps').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id),
  ])
  document.getElementById('statPosts').textContent = postCount ?? 0
  document.getElementById('statLikes').textContent = sparkCount ?? 0
}

async function loadSparkedPosts() {
  if (!currentUser) return
  const { data } = await supabase.from('slaps').select('post_id').eq('user_id', currentUser.id)
  sparkedPosts = new Set((data || []).map(s => s.post_id))
}

// ===== AUTH MODAL =====
function setupAuthModal() {
  document.getElementById('loginBtn')?.addEventListener('click',  () => openModal('login'))
  document.getElementById('signupBtn')?.addEventListener('click', () => openModal('signup'))
  document.getElementById('modalClose').addEventListener('click', closeModal)
  document.getElementById('authModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal()
  })
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
      errEl.textContent = 'Invalid username or password'
      errEl.classList.remove('hidden'); return
    }
    const { error } = await supabase.auth.signInWithPassword({ email: profile.email, password })
    if (error) {
      errEl.textContent = 'Invalid username or password'
      errEl.classList.remove('hidden')
    } else { closeModal() }
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

    if (!fullName) {
      errEl.textContent = 'Please enter your full name'
      errEl.classList.remove('hidden'); return
    }
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
      errEl.textContent = 'Username must be 3–30 characters: letters, numbers, underscores'
      errEl.classList.remove('hidden'); return
    }
    if (password !== confirm) {
      errEl.textContent = 'Passwords do not match'
      errEl.classList.remove('hidden'); return
    }
    if (!birthday) {
      errEl.textContent = 'Please enter your birthday'
      errEl.classList.remove('hidden'); return
    }

    const { data: existing } = await supabase
      .from('profiles').select('id').eq('username', username).maybeSingle()
    if (existing) {
      errEl.textContent = 'That username is already taken'
      errEl.classList.remove('hidden'); return
    }

    const { error } = await supabase.auth.signUp({
      email, password,
      options: { data: { username, full_name: fullName, birthday } }
    })
    if (error) {
      errEl.textContent = error.message
      errEl.classList.remove('hidden')
    } else { closeModal() }
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
  const addVideoBtn = document.getElementById('addVideoBtn')
  const videoUrlWrap = document.getElementById('videoUrlWrap')

  const checkReady = () => {
    postBtn.disabled = !currentUser || !select.value
  }

  input.addEventListener('input', () => {
    const remaining = 280 - input.value.length
    charCount.textContent = remaining
    charCount.className = 'char-count' + (remaining < 20 ? ' danger' : remaining < 60 ? ' warning' : '')
    checkReady()
  })
  select.addEventListener('change', checkReady)

  addVideoBtn.addEventListener('click', () => {
    addVideoBtn.classList.toggle('active')
    videoUrlWrap.classList.toggle('hidden')
  })

  postBtn.addEventListener('click', submitPost)
}

async function submitPost() {
  if (!currentUser) return
  const feeling  = document.getElementById('feelingSelect').value
  const content  = document.getElementById('composerInput').value.trim()
  const videoUrl = document.getElementById('videoUrlInput').value.trim()
  if (!feeling) return

  const postBtn = document.getElementById('postBtn')
  postBtn.disabled = true; postBtn.textContent = 'Sparking…'

  const { error } = await supabase.from('posts').insert({
    user_id:   currentUser.id,
    feeling,
    content,
    video_url: videoUrl || null,
  })

  postBtn.textContent = 'Spark it!'

  if (!error) {
    document.getElementById('feelingSelect').value = ''
    document.getElementById('composerInput').value = ''
    document.getElementById('videoUrlInput').value = ''
    document.getElementById('videoUrlWrap').classList.add('hidden')
    document.getElementById('addVideoBtn').classList.remove('active')
    document.getElementById('charCount').textContent = '280'
    postBtn.disabled = true
    await loadFeed()
    await loadUserStats()
  } else {
    postBtn.disabled = false
    console.error('Post error:', error.message)
  }
}

// ===== FEED PAGE =====
async function loadFeed() {
  const feed = document.getElementById('postsFeed')
  feed.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>'

  const { data: posts, error } = await supabase
    .from('posts')
    .select('*, profiles(username, full_name, avatar_letter)')
    .order('created_at', { ascending: false })
    .limit(50)

  feed.innerHTML = ''
  if (error || !posts?.length) {
    feed.innerHTML = `
      <div class="empty-state card">
        <div class="empty-icon">⚡</div>
        <h3>No sparks yet!</h3>
        <p>${currentUser ? 'Be the first to post something.' : 'Log in to start sparkin\'.'}</p>
      </div>`
    return
  }
  posts.forEach(post => feed.appendChild(renderPost(post)))
}

// ===== VIDEOS PAGE =====
async function loadVideos() {
  const grid = document.getElementById('videosGrid')
  grid.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>'

  const { data: posts, error } = await supabase
    .from('posts')
    .select('*, profiles(username, full_name, avatar_letter)')
    .not('video_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(40)

  grid.innerHTML = ''
  if (error || !posts?.length) {
    grid.innerHTML = `
      <div class="empty-state card" style="grid-column:1/-1">
        <div class="empty-icon">🎬</div>
        <h3>No videos yet!</h3>
        <p>Be the first to share a video.</p>
      </div>`
    return
  }

  posts.forEach(post => {
    const embedUrl = toEmbedUrl(post.video_url)
    if (!embedUrl) return
    const profile = post.profiles || {}
    const letter  = profile.avatar_letter || '?'
    const card    = document.createElement('div')
    card.className = 'video-card'
    card.innerHTML = `
      <div class="video-card-thumb">
        <iframe src="${embedUrl}" frameborder="0" allowfullscreen
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture">
        </iframe>
      </div>
      <div class="video-card-info">
        <div class="video-card-feeling">${post.feeling || 'Feeling: ⚡'}</div>
        ${post.content ? `<div style="font-size:0.85rem;color:var(--text-muted);font-style:italic;margin-bottom:6px">"${escapeHtml(post.content)}"</div>` : ''}
        <div class="video-card-user">
          <div class="video-card-avatar" style="background:${colorFromLetter(letter)}">${letter}</div>
          <span class="video-card-username">${profile.full_name || profile.username || 'Unknown'}</span>
          <span class="video-card-time">${timeAgo(post.created_at)}</span>
        </div>
      </div>
    `
    grid.appendChild(card)
  })
}

// ===== PROFILES PAGE =====
async function loadProfiles() {
  const profilesGrid   = document.getElementById('profilesGrid')
  const profileDetail  = document.getElementById('profileDetail')
  profilesGrid.classList.remove('hidden')
  profileDetail.classList.add('hidden')
  profilesGrid.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>'

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('*, posts(count)')
    .order('created_at', { ascending: false })

  profilesGrid.innerHTML = ''
  if (error || !profiles?.length) {
    profilesGrid.innerHTML = `
      <div class="empty-state card" style="grid-column:1/-1">
        <div class="empty-icon">✨</div>
        <h3>No profiles yet!</h3>
        <p>Sign up to be the first.</p>
      </div>`
    return
  }

  profiles.forEach(p => {
    const postCount = p.posts?.[0]?.count ?? 0
    const letter    = p.avatar_letter || '?'
    const card      = document.createElement('div')
    card.className  = 'profile-card'
    card.innerHTML  = `
      <div class="profile-card-avatar" style="background:${colorFromLetter(letter)}">${letter}</div>
      <div class="profile-card-name">${p.full_name || p.username}</div>
      <div class="profile-card-handle">@${p.username}</div>
      <div class="profile-card-posts">${postCount} post${postCount !== 1 ? 's' : ''}</div>
    `
    card.addEventListener('click', () => openProfileDetail(p))
    profilesGrid.appendChild(card)
  })
}

async function openProfileDetail(profile) {
  const profilesGrid  = document.getElementById('profilesGrid')
  const profileDetail = document.getElementById('profileDetail')
  profilesGrid.classList.add('hidden')
  profileDetail.classList.remove('hidden')

  const letter = profile.avatar_letter || '?'
  document.getElementById('detailAvatar').textContent   = letter
  document.getElementById('detailAvatar').style.background = colorFromLetter(letter)
  document.getElementById('detailName').textContent     = profile.full_name || profile.username
  document.getElementById('detailHandle').textContent   = `@${profile.username}`

  const feed = document.getElementById('profilePostsFeed')
  feed.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>'

  const { data: posts } = await supabase
    .from('posts')
    .select('*, profiles(username, full_name, avatar_letter)')
    .eq('user_id', profile.id)
    .order('created_at', { ascending: false })

  document.getElementById('detailPostCount').textContent = posts?.length ?? 0

  feed.innerHTML = ''
  if (!posts?.length) {
    feed.innerHTML = `<div class="empty-state card"><div class="empty-icon">🌟</div><h3>No posts yet!</h3></div>`
    return
  }
  posts.forEach(post => feed.appendChild(renderPost(post)))

  document.getElementById('backToProfiles').onclick = loadProfiles
}

// ===== RENDER POST =====
function renderPost(post) {
  const template = document.getElementById('postTemplate')
  const el       = template.content.cloneNode(true)
  const article  = el.querySelector('.post')

  const profile  = post.profiles || {}
  const letter   = profile.avatar_letter || '?'
  const name     = profile.full_name || profile.username || 'Unknown'
  const handle   = profile.username || 'user'

  article.dataset.postId = post.id

  const avatar = el.querySelector('.post-avatar')
  avatar.textContent = letter
  avatar.style.background = colorFromLetter(letter)

  el.querySelector('.post-username').textContent = name
  el.querySelector('.post-handle').textContent   = `@${handle}`
  el.querySelector('.post-time').textContent     = timeAgo(post.created_at)

  // Feeling headline: "Feeling: Awesome 🤩"
  const feelingEl = el.querySelector('.post-feeling')
  if (post.feeling) {
    feelingEl.innerHTML = `Feeling: <span class="feeling-label">${escapeHtml(post.feeling)}</span>`
  } else if (post.content) {
    // Legacy posts with no feeling — show content as feeling line
    feelingEl.textContent = post.content
  }

  // Explanation subtext
  const explanationEl = el.querySelector('.post-explanation')
  if (post.feeling && post.content) {
    explanationEl.textContent = `"${post.content}"`
  }

  // Spark (like) button
  const slapBtn  = el.querySelector('.slap-btn')
  const slapCount = el.querySelector('.slap-count')
  slapCount.textContent = post.slap_count ?? 0
  if (sparkedPosts.has(post.id)) slapBtn.classList.add('slaped')
  slapBtn.addEventListener('click', () => toggleSpark(post.id, slapBtn, slapCount))

  // Video
  if (post.video_url) {
    const videoWrap = el.querySelector('.post-video')
    const iframe    = el.querySelector('.video-embed')
    const embedUrl  = toEmbedUrl(post.video_url)
    if (embedUrl) { iframe.src = embedUrl; videoWrap.classList.remove('hidden') }
  }

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
  commentInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') submitComment(post.id, commentInput, commentsSection)
  })

  return el
}

// ===== SPARKS (likes) =====
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
  list.innerHTML = '<div class="loading-spinner" style="padding:16px"><div class="spinner"></div></div>'

  const { data: comments } = await supabase
    .from('comments')
    .select('*, profiles(username, full_name, avatar_letter)')
    .eq('post_id', postId)
    .order('created_at', { ascending: true })

  list.innerHTML = ''
  if (!comments?.length) {
    list.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;padding:4px 0">No comments yet.</p>'
    return
  }
  comments.forEach(c => list.appendChild(renderComment(c)))
}

function renderComment(c) {
  const div    = document.createElement('div')
  div.className = 'comment'
  const letter = c.profiles?.avatar_letter || '?'
  div.innerHTML = `
    <div class="comment-avatar" style="background:${colorFromLetter(letter)}">${letter}</div>
    <div class="comment-body">
      <div class="comment-author">${c.profiles?.full_name || c.profiles?.username || 'Unknown'}</div>
      <div class="comment-text">${escapeHtml(c.content)}</div>
    </div>
  `
  return div
}

async function submitComment(postId, input, section) {
  if (!currentUser) { openModal('login'); return }
  const content = input.value.trim()
  if (!content) return
  const { error } = await supabase.from('comments').insert({
    post_id: postId, user_id: currentUser.id, content,
  })
  if (!error) { input.value = ''; await loadComments(postId, section) }
}

// ===== WHO'S SPARKIN' SIDEBAR =====
async function loadWhoList() {
  const { data: profiles } = await supabase
    .from('profiles').select('*').order('created_at', { ascending: false }).limit(5)

  const list = document.getElementById('whoList')
  list.innerHTML = ''
  if (!profiles?.length) {
    list.innerHTML = '<li style="color:var(--text-muted);font-size:0.85rem">No one yet!</li>'
    return
  }
  profiles.forEach(p => {
    const li = document.createElement('li')
    li.className = 'who-item'
    li.innerHTML = `
      <div class="who-avatar" style="background:${colorFromLetter(p.avatar_letter || '?')}">${p.avatar_letter || '?'}</div>
      <div class="who-info">
        <div class="who-name">${p.full_name || p.username}</div>
        <div class="who-handle">@${p.username}</div>
      </div>
    `
    li.addEventListener('click', async () => {
      await navigateTo('profiles')
      await openProfileDetail(p)
    })
    list.appendChild(li)
  })
}

// ===== HELPERS =====
function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const m    = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function toEmbedUrl(url) {
  try {
    const u = new URL(url)
    if (u.hostname.includes('youtube.com')) {
      const id = u.searchParams.get('v')
      return id ? `https://www.youtube.com/embed/${id}` : null
    }
    if (u.hostname.includes('youtu.be')) {
      return `https://www.youtube.com/embed${u.pathname}`
    }
  } catch {}
  return null
}

function colorFromLetter(letter) {
  const colors = [
    'linear-gradient(135deg,#8B5CF6,#22D3EE)',
    'linear-gradient(135deg,#F472B6,#8B5CF6)',
    'linear-gradient(135deg,#22D3EE,#FBBF24)',
    'linear-gradient(135deg,#FBBF24,#F472B6)',
    'linear-gradient(135deg,#6D28D9,#06B6D4)',
  ]
  return colors[(letter.charCodeAt(0) || 0) % colors.length]
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

init()
