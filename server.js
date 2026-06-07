const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();

const PORT = process.env.PORT || 3000;
const OLLAMA_URL = process.env.OLLAMA_URL || 'https://desktop-bh6k0ih.taildd515d.ts.net';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-this-in-production';

const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DB_CONNECTION_LIMIT || 10)
    }
  : {
      host: process.env.PGHOST || process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.PGPORT || process.env.DB_PORT || 5432),
      user: process.env.PGUSER || process.env.DB_USER || 'postgres',
      password: process.env.PGPASSWORD || process.env.DB_PASSWORD || '',
      database: process.env.PGDATABASE || process.env.DB_NAME || 'vokamon',
      max: Number(process.env.DB_CONNECTION_LIMIT || 10)
    };

const sslMode = String(process.env.PGSSL || process.env.DB_SSL || '').toLowerCase();
if (sslMode === 'true' || sslMode === 'require') {
  poolConfig.ssl = { rejectUnauthorized: false };
}

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool(poolConfig);

async function query(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      username VARCHAR(50) NOT NULL UNIQUE,
      email VARCHAR(190) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      bio VARCHAR(255) NOT NULL DEFAULT 'Lagi belajar memahami emosi pelan-pelan.',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_states (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);`);
}

function cleanEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function cleanUsername(username) {
  const raw = String(username || '').trim().replace(/^@+/, '').toLowerCase();
  return raw.replace(/[^a-z0-9._-]/g, '').slice(0, 28);
}

function dbUserToPublic(user) {
  return {
    id: String(user.id),
    name: user.name || 'VokaMon User',
    username: user.username ? `@${user.username}` : '@vokamon.user',
    email: user.email,
    bio: user.bio || 'Lagi belajar memahami emosi pelan-pelan.',
    createdAt: user.created_at || user.createdAt || null
  };
}

function signToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      email: user.email
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function defaultAppState(user = {}) {
  return {
    coins: 0,
    pet: {
      name: 'Plong',
      level: 1,
      exp: 0,
      expMax: 30,
      hunger: 50,
      happy: 50
    },
    emotions: {
      tenang: 0
    },
    art: [],
    ch: [],
    gm: 'qwen2.5:3b',
    al: 'id',
    account: {
      name: user.name || 'VokaMon User',
      username: user.username ? `@${user.username}` : '@vokamon.user',
      bio: user.bio || 'Lagi belajar memahami emosi pelan-pelan.'
    }
  };
}

function safeParseState(raw, user) {
  if (!raw) return defaultAppState(user);

  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object') {
      return {
        ...defaultAppState(user),
        ...parsed,
        account: {
          ...defaultAppState(user).account,
          ...(parsed.account || {})
        }
      };
    }
  } catch (error) {
    console.warn('Gagal parse state_json:', error.message);
  }

  return defaultAppState(user);
}

async function getUserById(id) {
  const rows = await query(
    `SELECT id, name, username, email, password_hash, bio, created_at, updated_at, last_login_at
     FROM users WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function getStateForUser(user) {
  const rows = await query('SELECT state_json FROM user_states WHERE user_id = $1 LIMIT 1', [user.id]);
  return safeParseState(rows[0]?.state_json, user);
}

async function saveStateForUser(userId, state) {
  await query(
    `INSERT INTO user_states (user_id, state_json, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (user_id)
     DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = NOW()`,
    [userId, JSON.stringify(state || {})]
  );
}

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';

    if (!token) {
      return res.status(401).json({ ok: false, error: 'Unauthorized. Silakan login dulu.' });
    }

    const payload = jwt.verify(token, JWT_SECRET);
    const userId = Number(payload.sub);

    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ ok: false, error: 'Sesi tidak valid. Silakan login ulang.' });
    }

    const user = await getUserById(userId);

    if (!user) {
      return res.status(401).json({ ok: false, error: 'Sesi tidak valid. Silakan login ulang.' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ ok: false, error: 'Sesi sudah habis atau tidak valid. Silakan login ulang.' });
  }
}

function normalizeLanguage(language) {
  const map = {
    id: 'Bahasa Indonesia santai',
    'id-formal': 'Bahasa Indonesia formal',
    en: 'English',
    'jv-ngoko': 'Bahasa Jawa ngoko',
    'jv-krama': 'Bahasa Jawa krama',
    su: 'Bahasa Sunda',
    ms: 'Bahasa Melayu'
  };

  return map[language] || language || 'Bahasa Indonesia santai';
}

function getSystemPrompt(language) {
  const selectedLanguage = normalizeLanguage(language);

  return `
Kamu adalah Plong, teman curhat virtual di aplikasi VokaMon.

Kamu ngobrol seperti teman dekat yang hangat, santai, dan peduli.
Gunakan ${selectedLanguage}.

Gaya bicara:
- Jawab natural seperti manusia, bukan seperti artikel atau chatbot.
- Jangan terlalu formal, jangan terlalu rapi, jangan terdengar seperti template.
- Pakai kalimat pendek dan terasa ngobrol.
- Validasi perasaan user dulu sebelum kasih saran.
- Jangan langsung ceramah atau kasih solusi panjang.
- Boleh pakai kata-kata seperti: "aku ngerti", "wajar kok", "pelan-pelan ya", "nggak apa-apa", "aku dengerin".
- Boleh pakai emoji maksimal 1 kalau cocok.
- Jangan sering pakai bullet list kecuali user minta langkah-langkah.
- Jangan mulai jawaban dengan "Sebagai AI".
- Jangan mengulang pola jawaban yang sama terus.

Cara merespons:
- Kalau user sedih, jawab lembut dan menenangkan.
- Kalau user marah, validasi dulu lalu bantu redain.
- Kalau user bingung, bantu urai pelan-pelan.
- Kalau user cuma curhat, cukup temani dulu, jangan langsung sok menyelesaikan semuanya.
- Kalau user tanya teknis, jawab jelas tapi tetap santai.

Batas aman:
- Kamu bukan dokter, psikolog, atau psikiater.
- Jangan memberi diagnosis medis/psikologis.
- Kalau user ingin menyakiti diri sendiri, bunuh diri, atau dalam bahaya, arahkan untuk segera hubungi orang terdekat, keluarga, layanan darurat, atau profesional.

Contoh gaya:
User: "aku capek banget"
Plong: "Aku ngerti, pasti berat banget rasanya kalau semuanya numpuk. Kamu nggak harus kuat terus kok, pelan-pelan dulu ya."

User: "aku kesel banget"
Plong: "Wajar kok kamu kesel. Kadang kalau terlalu banyak yang ditahan, rasanya pengen meledak. Aku dengerin, apa yang paling bikin kamu kesel?"

User: "aku bingung"
Plong: "Oke, kita pelan-pelan aja. Coba ceritain dulu bagian yang paling bikin kamu kepikiran sekarang."
`.trim();
}

function convertHistory(history = []) {
  return history
    .map((item) => {
      let role = 'user';

      if (item.role === 'model' || item.role === 'assistant') {
        role = 'assistant';
      }

      const content = Array.isArray(item.parts)
        ? item.parts.map((p) => p.text || '').join('\n').trim()
        : String(item.content || item.text || '').trim();

      if (!content) return null;

      return {
        role,
        content: content.slice(0, 2000)
      };
    })
    .filter(Boolean);
}

app.post('/api/auth/register', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 40);
    const email = cleanEmail(req.body.email);
    const username = cleanUsername(req.body.username || name || email.split('@')[0]);
    const password = String(req.body.password || '');

    if (!name) return res.status(400).json({ ok: false, error: 'Nama wajib diisi.' });
    if (!email || !email.includes('@')) return res.status(400).json({ ok: false, error: 'Email tidak valid.' });
    if (!username || username.length < 3) return res.status(400).json({ ok: false, error: 'Username minimal 3 karakter.' });
    if (password.length < 6) return res.status(400).json({ ok: false, error: 'Password minimal 6 karakter.' });

    const exists = await query('SELECT id FROM users WHERE email = $1 OR username = $2 LIMIT 1', [email, username]);
    if (exists.length) {
      return res.status(409).json({ ok: false, error: 'Email atau username sudah terdaftar.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const bio = 'Lagi belajar memahami emosi pelan-pelan.';

    const rows = await query(
      `INSERT INTO users (name, username, email, password_hash, bio, created_at, updated_at, last_login_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW())
       RETURNING id, name, username, email, password_hash, bio, created_at, updated_at, last_login_at`,
      [name, username, email, passwordHash, bio]
    );

    const user = rows[0];
    const state = defaultAppState(user);
    await saveStateForUser(user.id, state);

    res.status(201).json({
      ok: true,
      token: signToken(user),
      user: dbUserToPublic(user),
      state
    });
  } catch (error) {
    console.error('Register error:', error);

    if (error.code === '23505') {
      return res.status(409).json({ ok: false, error: 'Email atau username sudah terdaftar.' });
    }

    res.status(500).json({ ok: false, error: 'Gagal daftar. Coba lagi sebentar ya.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = cleanEmail(req.body.email);
    const password = String(req.body.password || '');

    const rows = await query(
      `SELECT id, name, username, email, password_hash, bio, created_at, updated_at, last_login_at
       FROM users WHERE email = $1 LIMIT 1`,
      [email]
    );

    const user = rows[0];
    if (!user) return res.status(401).json({ ok: false, error: 'Email atau password salah.' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ ok: false, error: 'Email atau password salah.' });

    await query('UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1', [user.id]);
    const state = await getStateForUser(user);

    res.json({
      ok: true,
      token: signToken(user),
      user: dbUserToPublic(user),
      state
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ ok: false, error: 'Gagal login. Coba lagi sebentar ya.' });
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  res.json({ ok: true, user: dbUserToPublic(req.user) });
});

app.get('/api/user/state', requireAuth, async (req, res) => {
  const state = await getStateForUser(req.user);
  res.json({ ok: true, state });
});

app.put('/api/user/state', requireAuth, async (req, res) => {
  try {
    const nextState = req.body.state;
    if (!nextState || typeof nextState !== 'object') {
      return res.status(400).json({ ok: false, error: 'State tidak valid.' });
    }

    const account = nextState.account || {};
    const name = String(account.name || req.user.name || 'VokaMon User').trim().slice(0, 40);
    const bio = String(account.bio || req.user.bio || '').trim().slice(0, 160);
    const username = cleanUsername(account.username || req.user.username || 'vokamon.user');

    nextState.account = {
      name,
      username: username ? `@${username}` : '@vokamon.user',
      bio: bio || 'Lagi belajar memahami emosi pelan-pelan.'
    };

    await saveStateForUser(req.user.id, nextState);

    await query(
      'UPDATE users SET name = $1, username = $2, bio = $3, updated_at = NOW() WHERE id = $4',
      [name, username, nextState.account.bio, req.user.id]
    );

    res.json({ ok: true });
  } catch (error) {
    console.error('Save state error:', error);

    if (error.code === '23505') {
      return res.status(409).json({ ok: false, error: 'Username sudah dipakai.' });
    }

    res.status(500).json({ ok: false, error: 'Gagal menyimpan data.' });
  }
});

app.put('/api/user/profile', requireAuth, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 40);
    const username = cleanUsername(req.body.username || '');
    const bio = String(req.body.bio || '').trim().slice(0, 160);

    if (!name) return res.status(400).json({ ok: false, error: 'Nama wajib diisi.' });
    if (!username || username.length < 3) return res.status(400).json({ ok: false, error: 'Username minimal 3 karakter.' });

    const exists = await query('SELECT id FROM users WHERE username = $1 AND id <> $2 LIMIT 1', [username, req.user.id]);
    if (exists.length) return res.status(409).json({ ok: false, error: 'Username sudah dipakai.' });

    const state = await getStateForUser(req.user);
    state.account = {
      name,
      username: `@${username}`,
      bio: bio || 'Lagi belajar memahami emosi pelan-pelan.'
    };

    await query(
      'UPDATE users SET name = $1, username = $2, bio = $3, updated_at = NOW() WHERE id = $4',
      [name, username, state.account.bio, req.user.id]
    );
    await saveStateForUser(req.user.id, state);

    const updated = await getUserById(req.user.id);
    res.json({ ok: true, user: dbUserToPublic(updated), state });
  } catch (error) {
    console.error('Update profile error:', error);

    if (error.code === '23505') {
      return res.status(409).json({ ok: false, error: 'Username sudah dipakai.' });
    }

    res.status(500).json({ ok: false, error: 'Gagal menyimpan profil.' });
  }
});

app.get('/api/health', async (req, res) => {
  const health = {
    ok: false,
    ollama: OLLAMA_URL,
    postgres: false,
    models: []
  };

  try {
    await query('SELECT 1 AS ok');
    health.postgres = true;
  } catch (error) {
    health.postgres = false;
    health.postgresError = error.message;
  }

  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`);
    const text = await r.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!r.ok) {
      return res.status(r.status).json({
        ...health,
        error: data,
        status: r.status
      });
    }

    health.ok = health.postgres;
    health.models = data.models?.map((m) => m.name) || [];
    res.status(health.ok ? 200 : 500).json(health);
  } catch (error) {
    res.status(500).json({
      ...health,
      error: error.message,
      cause: error.cause?.message || null
    });
  }
});

app.get('/api/models', requireAuth, async (req, res) => {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`);
    const data = await r.json();

    res.json({
      ok: true,
      models: data.models?.map((m) => m.name) || []
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      models: [],
      error: 'Gagal mengambil daftar model dari Ollama.'
    });
  }
});

app.post('/api/chat', requireAuth, async (req, res) => {
  try {
    const model = req.body.model || 'qwen2.5:3b';
    const language = req.body.language || 'id';
    const system = getSystemPrompt(language);

    const history = convertHistory(req.body.history || []).slice(-8);
    const directMessage = String(req.body.message || '').trim();

    if (directMessage) {
      const lastMessage = history[history.length - 1];

      if (!lastMessage || lastMessage.content !== directMessage) {
        history.push({
          role: 'user',
          content: directMessage.slice(0, 2000)
        });
      }
    }

    if (history.length === 0) {
      return res.status(400).json({ reply: 'Pesannya masih kosong nih.' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.AI_TIMEOUT_MS || 120000));

    const ollamaRes = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: '10m',
        messages: [
          { role: 'system', content: system },
          ...history
        ],
        options: {
          temperature: Number(process.env.AI_TEMPERATURE || 0.72),
          top_p: Number(process.env.AI_TOP_P || 0.9),
          repeat_penalty: Number(process.env.AI_REPEAT_PENALTY || 1.08),
          num_ctx: Number(process.env.AI_NUM_CTX || 2048),
          num_predict: Number(process.env.AI_NUM_PREDICT || 500),
          num_thread: Number(process.env.AI_NUM_THREAD || 8)
        }
      })
    });

    clearTimeout(timeout);

    const text = await ollamaRes.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }

    if (!ollamaRes.ok) {
      return res.status(ollamaRes.status).json({
        reply: `Model AI lokal belum siap. Coba jalankan di CMD: ollama pull ${model}`,
        error: data.error || 'Ollama request failed'
      });
    }

    res.json({ reply: data.message?.content || 'Aku belum bisa jawab sekarang.' });
  } catch (error) {
    console.error('Chat error:', error);

    if (error.name === 'AbortError') {
      return res.status(504).json({
        reply: 'Model AI lokal kelamaan merespons. Coba pakai model yang lebih ringan atau tutup aplikasi lain dulu.',
        error: 'Request timeout'
      });
    }

    res.status(500).json({
      reply: 'Server AI lokal lagi bermasalah. Pastikan Ollama dan server Node.js aktif.',
      error: error.message
    });
  }
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`VokaMon jalan di http://localhost:${PORT}`);
  console.log(`Backend tersambung ke Ollama: ${OLLAMA_URL}`);

  if (process.env.DATABASE_URL) {
    console.log('PostgreSQL: menggunakan DATABASE_URL');
  } else {
    console.log(`PostgreSQL: ${poolConfig.user}@${poolConfig.host}:${poolConfig.port}/${poolConfig.database}`);
  }

  try {
    await initDb();
    console.log('PostgreSQL tersambung dan tabel siap.');
  } catch (error) {
    console.warn('PostgreSQL belum tersambung:', error.message);
  }
});
