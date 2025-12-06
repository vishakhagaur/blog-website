// track home view (hidden)
fetch('/api/view', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ type: 'home' })}).catch(()=>{});

// Load all posts for homepage list
async function loadPosts() {
  try {
    const res = await fetch('/api/posts');
    const posts = await res.json();
    const container = document.getElementById('posts-list');
    const q = (document.getElementById('searchInput') || {}).value || '';
    const filtered = posts.filter(p => {
      const qq = q.toLowerCase();
      return !q || p.title.toLowerCase().includes(qq) || (p.category || '').toLowerCase().includes(qq);
    });

    if (!filtered.length) {
      container.innerHTML = '<div>No posts yet.</div>';
      return;
    }

    container.innerHTML = filtered.map(p => `
      <div class="post-card">
        <div>
          <div style="font-weight:700">${p.title}</div>
          <div class="meta">${p.category || 'General'} • ${p.date || ''}</div>
        </div>
        <div>
          <a href="#" onclick="loadPostContent('${encodeURIComponent(p.id)}')">Read</a>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error(err);
  }
}

// Load single post content when "Read" is clicked
async function loadPostContent(postId) {
  try {
    const res = await fetch(`/api/posts/${postId}`);
    const post = await res.json();

    // Render title and meta
    document.getElementById('postTitle').innerText = post.title;
    document.getElementById('postMeta').innerText = `${post.category || 'General'} • ${post.date || ''}`;

    // Render content safely
    document.getElementById('postContainer').innerHTML = DOMPurify.sanitize(post.content);
  } catch (err) {
    console.error(err);
    document.getElementById('postContainer').innerHTML = '<div>Error loading post.</div>';
  }
}

// Load posts on page load
loadPosts();

// Optional: live search
document.getElementById('searchInput').addEventListener('input', loadPosts);


function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

document.getElementById('searchInput')?.addEventListener('input', loadPosts);
loadPosts();
