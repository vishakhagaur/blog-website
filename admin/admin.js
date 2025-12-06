// load total views
fetch('/api/views').then(r=>r.json()).then(j=>{ document.getElementById('views').innerText = j.count || 0; }).catch(()=>{});

document.getElementById('publish').addEventListener('click', async ()=>{
  const title = document.getElementById('title').value.trim();
  const category = document.getElementById('category').value.trim();
  const content = document.getElementById('content').value.trim();
  const password = document.getElementById('password').value;
  const msg = document.getElementById('msg');
  if(!title || !content){ msg.style.color='red'; msg.innerText='Title and content required'; return; }
  const res = await fetch('/api/posts', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ password, title, content, category }) });
  if(res.ok){ msg.style.color='green'; msg.innerText='Published!'; document.getElementById('title').value='';document.getElementById('content').value=''; }
  else { const j = await res.json().catch(()=>({})); msg.style.color='red'; msg.innerText = j.error || 'Failed'; }
});
