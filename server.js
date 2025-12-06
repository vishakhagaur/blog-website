const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const mammoth = require('mammoth');
const pdfjsLib = require('pdfjs-dist');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.sqlite');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';


// Ensure directories
const publicDir = path.join(__dirname, 'public');
const uploadsDir = path.join(publicDir, 'uploads');
const dataDir = path.join(publicDir, 'data');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const POSTS_JSON_PATH = path.join(dataDir, 'posts.json');





// Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) =>
    cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'))
});
const upload = multer({ storage });


// Middleware
app.use('/uploads', express.static(uploadsDir));
app.use('/data', express.static(dataDir));
app.use(bodyParser.json({ limit: '20mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(publicDir));
app.use('/admin', express.static(path.join(__dirname, 'admin')));


// Init DB
const db = new sqlite3.Database(DB_FILE);
// Create table for total website views
db.run(`
  CREATE TABLE IF NOT EXISTS site_views (
    id INTEGER PRIMARY KEY,
    count INTEGER DEFAULT 0
  )
`);

db.run("INSERT OR IGNORE INTO site_views (id, count) VALUES (1, 0)");

function writePostsJsonFromRows(rows) {
  try {
    fs.writeFileSync(POSTS_JSON_PATH, JSON.stringify(rows, null, 2), 'utf8');
    console.log('[INFO] Wrote posts.json');
  } catch (e) {
    console.error('[ERROR] Failed writing posts.json:', e);
  }
}


db.serialize(() => {
  console.log('[INFO] Ensuring tables exist...');

  db.run(`CREATE TABLE IF NOT EXISTS views (
      count INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      content TEXT,
      category TEXT,
      image TEXT,
      document TEXT,
      date TEXT
  )`);
  // CONTACT FORM MESSAGES TABLE
  db.run(`CREATE TABLE IF NOT EXISTS contact_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      email TEXT,
      message TEXT,
      created_at TEXT
  )`);

  db.get(`SELECT count FROM views`, (err, row) => {
    if (err || !row) {
      db.run(`INSERT INTO views (count) VALUES (0)`);
    }
  });

  db.all('SELECT * FROM posts ORDER BY id DESC', (err, rows) => {
    if (!err) writePostsJsonFromRows(rows);
  });
});



// Sync helper
function syncPostsJson() {
  db.all('SELECT * FROM posts ORDER BY id DESC', (err, rows) => {
    if (!err) writePostsJsonFromRows(rows);
  });
}



// API ROUTES --------------------------------------------

// VIEWS
app.post('/api/view', (req, res) => {
  db.run('UPDATE views SET count = count + 1');
  res.json({ ok: true });
});

app.get('/api/views', (req, res) => {
  db.get('SELECT count FROM views', (err, row) => res.json(row || { count: 0 }));
});


// GET ALL POSTS
app.get('/api/posts', (req, res) => {
  db.all('SELECT * FROM posts ORDER BY id DESC', (err, rows) => {
    console.log('[INFO] /api/posts returned', rows?.length || 0, 'rows');
    res.json(rows || []);
  });
});


// GET SINGLE POST
app.get('/api/posts/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });

  db.get('SELECT * FROM posts WHERE id = ?', [id], (err, row) => {
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(row);
  });
});
app.post('/api/admin-login', (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.admin = true; // << store session
    return res.json({ success: true });
  }

  return res.status(403).json({ success: false, msg: "Invalid login" });
});
app.get('/api/admin-logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, msg: "Logout failed" });
    }
    res.json({ success: true, msg: "Logged out successfully" });
  });
});
app.get('/api/posts/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });

  // Increment post views
  db.run("UPDATE posts SET views = views + 1 WHERE id = ?", [id]);

  db.get('SELECT * FROM posts WHERE id = ?', [id], (err, row) => {
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(row);
  });
});


app.post("/api/get-contact-messages", (req, res) => {
  const { password } = req.body;

  if (password !== ADMIN_PASSWORD) {
    return res.status(403).json({ success: false, msg: "Unauthorized" });
  }

  db.all("SELECT * FROM contact_messages ORDER BY id DESC", (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, msg: "Database error" });
    }

    res.json({ success: true, messages: rows });
  });
});
// SAVE CONTACT MESSAGE
app.post("/api/contact", (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ success: false, msg: "All fields required" });
  }

  const created_at = new Date().toLocaleString();
  db.run(
    `INSERT INTO contact_messages (name, email, message, created_at) VALUES (?, ?, ?, ?)`,
    [name, email, message, created_at],
    function(err) {
      if (err) return res.status(500).json({ success: false, msg: "DB error" });
      res.json({ success: true, msg: "Message saved" });
    }
  );
});

// UPLOAD DOCX or PDF
app.post('/api/upload-post', upload.single('file'), async (req, res) => {
  const { password, title, category } = req.body;

  if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Unauthorized' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const filePathOnDisk = req.file.path;
  const webPath = "/uploads/" + req.file.filename;
  const mimeType = req.file.mimetype;

  let content = "";

  try {
    if (mimeType.includes("wordprocessingml")) {
      const result = await mammoth.extractRawText({ path: filePathOnDisk });
      content = result.value?.trim() || "";
    } else if (mimeType === "application/pdf") {
      const buffer = fs.readFileSync(filePathOnDisk);
      const pdfDoc = await pdfjsLib.getDocument({ data: buffer }).promise;

      let text = "";
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const txt = await page.getTextContent();
        text += txt.items.map(t => t.str).join(" ") + "\n";
      }
      content = text.trim();
    }

    db.run(
      `INSERT INTO posts (title, content, category, image, document, date)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [title, content, category, "", webPath, new Date().toLocaleDateString()],
      function () {
        syncPostsJson();
        res.json({ success: true, id: this.lastID });
      }
    );

  } catch (e) {
    return res.status(500).json({ error: 'File processing error' });
  }
});


// UPLOAD Normal POST
app.post('/api/posts-upload', upload.fields([
  { name: "image", maxCount: 1 },
  { name: "document", maxCount: 1 }
]), (req, res) => {

  const { title, content, category, password } = req.body;

  // Check admin password
  if (password !== ADMIN_PASSWORD) {
    console.warn('[WARN] Unauthorized posts-upload attempt');
    return res.status(403).json({ success: false, error: "Invalid admin password" });
  }

  // Safely get uploaded files
  const imagePath = req.files?.image ? "/uploads/" + req.files.image[0].filename : "";
  const docPath = req.files?.document ? "/uploads/" + req.files.document[0].filename : "";
  const date = new Date().toLocaleDateString();

  // Insert into DB with error handling
  db.run(
    `INSERT INTO posts (title, content, category, image, document, date)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [title || "Untitled", content || "", category || "General", imagePath, docPath, date],
    function (err) {
      if (err) {
        console.error('[ERROR] posts-upload insert failed:', err.message);
        return res.status(500).json({ success: false, error: err.message });
      }
      console.log('[INFO] New post inserted (posts-upload) id=', this.lastID);
      syncPostsJson(); // update posts.json
      res.json({ success: true, id: this.lastID });
    }
  );
});




// DELETE POST
app.delete('/api/posts/:id', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD)
    return res.status(403).json({ error: 'Unauthorized' });

  db.run('DELETE FROM posts WHERE id = ?', [req.params.id], function () {
    if (this.changes === 0) return res.status(404).json({ error: 'Post not found' });
    syncPostsJson();
    res.json({ success: true });
  });
});
app.get("/admin-contacts-1290", (req, res) => {
  res.sendFile(path.join(__dirname, "admin-contacts-1290.html"));
});


// DEBUG
app.get('/debug/posts', (req, res) => {
  db.all("SELECT * FROM posts ORDER BY id DESC", (err, rows) => res.json(rows || []));
});


// HEALTH
app.get('/health', (req, res) => res.json({ ok: true }));
// Increase and return total site views
app.get('/', (req, res) => {
  // Increment total site views privately
  db.run("UPDATE site_views SET count = count + 1 WHERE id = 1");

  // Serve your home page
  res.sendFile(path.join(__dirname, 'public/index.html'));
});
app.get('/admin/total-views', (req, res) => {
  db.get("SELECT count FROM site_views WHERE id = 1", (err, row) => {
    if (err) return res.json({ success: false, error: err.message });
    res.json({ success: true, totalViews: row.count });
  });
});
//----------------------------------------
// VIEW COUNT SYSTEM
//----------------------------------------


// START SERVER
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
