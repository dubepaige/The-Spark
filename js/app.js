import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ===== CONFIG =====
const SUPABASE_URL = 'https://jqrefxdumksvddrohmts.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_hcJBTW3HNyFHd1pBEczxwA_PE0BJs62'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ===== STATE =====
let currentUser = null
let currentProfile = null
let activeTab = 'all'
let slapedPosts = new Set()

// ===== INIT =====
async function init() {
  const { data: { session } } = await supabase.auth.getSession()
  if (session) await setUser(session.user)

  supabase.auth.onAuthStateChange(async (_event, session) => {
    if (session) {
      await setUser(session.user)
    } else {
      clearUser()
    }
  })

  setupComposer()
  setupAuthModal()
  setupFeedTabs()
  await loadFeed()
  await loadWhoList()
}

// ===== AUTH =====
async function setUser(user) {
  currentUser = user
  const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  currentProfile = data

  // Update UI
  document.getElementById('loginBtn')?.classList.add('hidden')
  document.getElementById('signupBtn')?.classList.add('hidden')

  const headerUser = document.getElementById('headerUser')
  headerUser.innerHTML = `
    <div class="header-user-info">
      <div class="header-avatar">${currentProfile?.avatar_letter || '?'}</div>
      <span class="header-username">${currentProfile?.username || user.email}</span>
    </div>
    <button class="btn btn-logout" id="logoutBtn">Log Out</button>
  `
  document.getElementById('logoutBtn').addEventListener('click', signOut)

  const composerAvatar = document.getElementById('composerAvatar')
  if (composerAvatar) composerAvatar.textContent = currentProfile?.avatar_letter || '?'

  const sidebarName = document.getElementById('sidebarName')
  const sidebarHandle = document.getElementById('sidebarHandle')
  const sidebarAvatar = document.getElementById('sidebarAvatar')
  if (sidebarName) sidebarName.textContent = currentProfile?.username || user.email
  if (sidebarHandle) sidebarHandle.textContent = `@${currentProfile?.username || 'user'}`
  if (sidebarAvatar) sidebarAvatar.textContent = currentProfile?.avatar_letter || '?'

  document.getElementById('postBtn').disabled = false

  await loadUserStats()
  await loadSlapedPosts()
}

function clearUser() {
  currentUser = null
  currentProfile = null

  const headerUser = document.getElementById('headerUser')
  headerUser.innerHTML = `
    <button class="btn btn-login" id="loginBtn">Log In</button>
    <button class="btn btn-signup" id="signupBtn">Sign Up</button>
  `
  document.getElementById('loginBtn').addEventListener('click', () => openModal('login'))
  document.getElementById('signupBtn').addEventListener('click', () => openModal('signup'))

  document.getElementById('composerAvatar').textContent = '?'
  document.getElementById('sidebarName').textContent = 'Guest'
  document.getElementById('sidebarHandle').textContent = '@theslap'
  document.getElementById('sidebarAvatar').textContent = '?'
  document.getElementById('statPosts').textContent = '0'
  document.getElementById('statLikes').textContent = '0'
  document.getElementById('postBtn').disabled = true
  slapedPosts.clear()
}

async function signOut() {
  await supabase.auth.signOut()
}

async function loadUserStats() {
  if (!currentUser) return
  const [{ count: postCount }, { count: slapCount }] = await Promise.all([
    supabase.from('posts').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id),
    supabase.from('slaps').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id),
  ])
  document.getElementById('statPosts').textContent = postCount ?? 0
  document.getElementById('statLikes').textContent = slapCount ?? 0
}

async function loadSlapedPosts() {
  if (!currentUser) return
  const { data } = await supabase.from('slaps').select('post_id').eq('user_id', currentUser.id)
  slapedPosts = new Set((data || []).map(s => s.post_id))
}

// ===== AUTH MODAL =====
function setupAuthModal() {
  document.getElementById('loginBtn')?.addEventListener('click', () => openModal('login'))
  document.getElementById('signupBtn')?.addEventListener('click', () => openModal('signup'))
  document.getElementById('modalClose').addEventListener('click', closeModal)
  document.getElementById('authModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal()
  })

  document.getElementById('tabLogin').addEventListener('click', () => switchModalTab('login'))
  document.getElementById('tabSignup').addEventListener('click', () => switchModalTab('signup'))

  document.getElementById('loginForm').addEventListener('submit', async e => {
    e.preventDefault()
    const username = document.getElementById('loginUsername').value.trim().toLowerCase()
    const password = document.getElementById('loginPassword').value
    const errEl = document.getElementById('loginError')
    errEl.classList.add('hidden')

    const email = usernameToEmail(username)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      errEl.textContent = 'Invalid username or password'
      errEl.classList.remove('hidden')
    } else {
      closeModal()
    }
  })

  document.getElementById('signupForm').addEventListener('submit', async e => {
    e.preventDefault()
    const username = document.getElementById('signupUsername').value.trim()
    const password = document.getElementById('signupPassword').value
    const errEl = document.getElementById('signupError')
    errEl.classList.add('hidden')

    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
      errEl.textContent = 'Username must be 3–30 characters, letters/numbers/underscores only'
      errEl.classList.remove('hidden')
      return
    }

    // Check username isn't already taken
    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', username)
      .maybeSingle()

    if (existing) {
      errEl.textContent = 'That username is already taken'
      errEl.classList.remove('hidden')
      return
    }

    const email = usernameToEmail(username.toLowerCase())
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { data: { username } }
    })
    if (error) {
      errEl.textContent = error.message
      errEl.classList.remove('hidden')
    } else {
      closeModal()
    }
  })
}

function openModal(tab = 'login') {
  document.getElementById('authModal').classList.remove('hidden')
  switchModalTab(tab)
}

function closeModal() {
  document.getElementById('authModal').classList.add('hidden')
}

function switchModalTab(tab) {
  const isLogin = tab === 'login'
  document.getElementById('tabLogin').classList.toggle('active', isLogin)
  document.getElementById('tabSignup').classList.toggle('active', !isLogin)
  document.getElementById('loginForm').classList.toggle('hidden', !isLogin)
  document.getElementById('signupForm').classList.toggle('hidden', isLogin)
}

// ===== COMPOSER =====
function setupComposer() {
  const input = document.getElementById('composerInput')
  const charCount = document.getElementById('charCount')
  const postBtn = document.getElementById('postBtn')
  const addVideoBtn = document.getElementById('addVideoBtn')
  const videoUrlWrap = document.getElementById('videoUrlWrap')

  input.addEventListener('input', () => {
    const remaining = 280 - input.value.length
    charCount.textContent = remaining
    charCount.className = 'char-count' + (remaining < 20 ? ' danger' : remaining < 60 ? ' warning' : '')
    postBtn.disabled = !currentUser || input.value.trim().length === 0
  })

  addVideoBtn.addEventListener('click', () => {
    addVideoBtn.classList.toggle('active')
    videoUrlWrap.classList.toggle('hidden')
  })

  postBtn.addEventListener('click', submitPost)
}

async function submitPost() {
  if (!currentUser) return
  const content = document.getElementById('composerInput').value.trim()
  const videoUrl = document.getElementById('videoUrlInput').value.trim()
  if (!content) return

  const postBtn = document.getElementById('postBtn')
  postBtn.disabled = true
  postBtn.textContent = 'Posting...'

  const { error } = await supabase.from('posts').insert({
    user_id: currentUser.id,
    content,
    video_url: videoUrl || null,
  })

  postBtn.textContent = 'Slap it!'

  if (!error) {
    document.getElementById('composerInput').value = ''
    document.getElementById('videoUrlInput').value = ''
    document.getElementById('videoUrlWrap').classList.add('hidden')
    document.getElementById('addVideoBtn').classList.remove('active')
    document.getElementById('charCount').textContent = '280'
    await loadFeed()
    await loadUserStats()
  } else {
    postBtn.disabled = false
    alert('Failed to post: ' + error.message)
  }
}

// ===== FEED =====
function setupFeedTabs() {
  document.querySelectorAll('.feed-tab').forEach(tab => {
    tab.addEventListener('click', async () => {
      document.querySelectorAll('.feed-tab').forEach(t => t.classList.remove('active'))
      tab.classList.add('active')
      activeTab = tab.dataset.tab
      await loadFeed()
    })
  })
}

async function loadFeed() {
  const feed = document.getElementById('postsFeed')
  feed.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>'

  let query = supabase
    .from('posts')
    .select(`*, profiles(username, avatar_letter)`)
    .order('created_at', { ascending: false })
    .limit(50)

  if (activeTab === 'videos') query = query.not('video_url', 'is', null)
  if (activeTab === 'status') query = query.is('video_url', null)

  const { data: posts, error } = await query

  feed.innerHTML = ''

  if (error || !posts?.length) {
    feed.innerHTML = `
      <div class="empty-state card">
        <div class="empty-icon">🎭</div>
        <h3>No slaps yet!</h3>
        <p>${currentUser ? 'Be the first to post something.' : 'Log in to start slappin\'.'}</p>
      </div>`
    return
  }

  posts.forEach(post => feed.appendChild(renderPost(post)))
}

function renderPost(post) {
  const template = document.getElementById('postTemplate')
  const el = template.content.cloneNode(true)
  const article = el.querySelector('.post')

  const profile = post.profiles || {}
  const letter = profile.avatar_letter || '?'
  const username = profile.username || 'Unknown'
  const time = timeAgo(post.created_at)

  article.dataset.postId = post.id

  const avatar = el.querySelector('.post-avatar')
  avatar.textContent = letter
  avatar.style.background = colorFromLetter(letter)

  el.querySelector('.post-username').textContent = username
  el.querySelector('.post-handle').textContent = `@${username}`
  el.querySelector('.post-time').textContent = time
  el.querySelector('.post-text').textContent = post.content

  const slapBtn = el.querySelector('.slap-btn')
  const slapCount = el.querySelector('.slap-count')
  slapCount.textContent = post.slap_count ?? 0

  if (slapedPosts.has(post.id)) slapBtn.classList.add('slaped')

  slapBtn.addEventListener('click', () => toggleSlap(post.id, slapBtn, slapCount))

  if (post.video_url) {
    const videoWrap = el.querySelector('.post-video')
    const iframe = el.querySelector('.video-embed')
    const embedUrl = toEmbedUrl(post.video_url)
    if (embedUrl) {
      iframe.src = embedUrl
      videoWrap.classList.remove('hidden')
    }
  }

  const commentBtn = el.querySelector('.comment-btn')
  const commentsSection = el.querySelector('.comments-section')
  commentBtn.addEventListener('click', async () => {
    const isOpen = !commentsSection.classList.contains('hidden')
    commentsSection.classList.toggle('hidden')
    if (!isOpen) await loadComments(post.id, commentsSection)
  })

  const commentInput = el.querySelector('.comment-input')
  const commentSubmit = el.querySelector('.btn-comment-submit')
  commentSubmit.addEventListener('click', () => submitComment(post.id, commentInput, commentsSection))
  commentInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') submitComment(post.id, commentInput, commentsSection)
  })

  return el
}

// ===== SLAPS =====
async function toggleSlap(postId, btn, countEl) {
  if (!currentUser) { openModal('login'); return }

  const isSlaped = slapedPosts.has(postId)

  if (isSlaped) {
    slapedPosts.delete(postId)
    btn.classList.remove('slaped')
    countEl.textContent = parseInt(countEl.textContent) - 1
    await supabase.from('slaps').delete().match({ post_id: postId, user_id: currentUser.id })
  } else {
    slapedPosts.add(postId)
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
    .select('*, profiles(username, avatar_letter)')
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
  const div = document.createElement('div')
  div.className = 'comment'
  const letter = c.profiles?.avatar_letter || '?'
  div.innerHTML = `
    <div class="comment-avatar" style="background:${colorFromLetter(letter)}">${letter}</div>
    <div class="comment-body">
      <div class="comment-author">${c.profiles?.username || 'Unknown'}</div>
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
    post_id: postId,
    user_id: currentUser.id,
    content,
  })

  if (!error) {
    input.value = ''
    await loadComments(postId, section)
  }
}

// ===== WHO LIST =====
async function loadWhoList() {
  const { data: profiles } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5)

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
        <div class="who-name">${p.username}</div>
        <div class="who-handle">@${p.username}</div>
      </div>
    `
    list.appendChild(li)
  })
}

// ===== HELPERS =====
function usernameToEmail(username) {
  return `${username}@theslap.users`
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
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
    'linear-gradient(135deg,#FF6B00,#FF3DAD)',
    'linear-gradient(135deg,#7B2FBE,#00C9B1)',
    'linear-gradient(135deg,#FF3DAD,#7B2FBE)',
    'linear-gradient(135deg,#00C9B1,#FF6B00)',
    'linear-gradient(135deg,#FFD600,#FF6B00)',
  ]
  return colors[(letter.charCodeAt(0) || 0) % colors.length]
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

init()
