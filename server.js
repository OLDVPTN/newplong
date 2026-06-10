const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const hpp = require('hpp');
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

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

const BODY_LIMIT = process.env.BODY_LIMIT || '2mb';
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const defaultDevOrigins = [
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  if (process.env.NODE_ENV !== 'production' && defaultDevOrigins.includes(origin)) return true;
  return false;
};

app.use(cors({
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) return callback(null, true);
    return callback(new Error('CORS blocked'));
  },
  credentials: true
}));

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

app.use(hpp());

app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: false, limit: BODY_LIMIT }));

const apiLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.RATE_LIMIT_API_MAX || 300),
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Terlalu banyak request. Coba lagi nanti.' }
});

const authLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.RATE_LIMIT_AUTH_MAX || 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Terlalu banyak percobaan login/daftar. Coba lagi nanti.' }
});

const aiLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_AI_WINDOW_MS || 5 * 60 * 1000),
  max: Number(process.env.RATE_LIMIT_AI_MAX || 40),
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, reply: 'Terlalu banyak request AI. Coba lagi sebentar ya.' }
});

app.use('/api', apiLimiter);

app.use(express.static(path.join(__dirname, 'public'), {
  dotfiles: 'deny',
  index: false,
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0
}));

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
      happy: 50,
      energy: 70,
      bond: 0,
      worker: {
        lastClaimAt: new Date().toISOString(),
        essence: {
          marah: 0,
          sedih: 0,
          galau: 0,
          stres: 0,
          excited: 0,
          tenang: 0
        },
        totalEarned: 0,
        today: {
          date: new Date().toISOString().slice(0, 10),
          vent: 0,
          chat: 0,
          garden: 0,
          care: 0,
          bonusClaimed: false
        }
      },
      accessory: '',
      background: '',
      wings: false,
      lastCareAt: new Date().toISOString(),
      avatar: {
        body: 'orange',
        shape: 'round',
        eyes: 'cute',
        mouth: 'smile',
        accessory: 'none',
        aura: 'none'
      }
    },
    emotions: {
      tenang: 0
    },
    art: [],
    ch: [],
    vents: [],
    inventory: [],
    redeemHistory: [],
    lastCrystal: null,
    garden: defaultGarden(),
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
  if (!raw) return ensureGameState(defaultAppState(user), user);

  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object') {
      return ensureGameState({
        ...defaultAppState(user),
        ...parsed,
        account: {
          ...defaultAppState(user).account,
          ...(parsed.account || {})
        }
      }, user);
    }
  } catch (error) {
    console.warn('Gagal parse state_json:', error.message);
  }

  return ensureGameState(defaultAppState(user), user);
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


const ALLOWED_MOODS = ['marah', 'sedih', 'galau', 'stres', 'excited', 'tenang'];

const PRODUCT_CATALOG = {
  p1: {
    id: 'p1', name: 'Coklat Virtual', price: 50, icon: '🍫', type: 'consumable',
    desc: 'Naikkan kenyang dan bahagia Plong.',
    apply(state) {
      state.pet.hunger = clamp((state.pet.hunger || 0) + 28, 0, 100);
      state.pet.happy = clamp((state.pet.happy || 0) + 18, 0, 100);
      return 'Plong makan coklat virtual dan kelihatan lebih happy.';
    }
  },
  p2: {
    id: 'p2', name: 'Taman Mimpi', price: 120, icon: '🌸', type: 'unlock', key: 'bg_dream_garden',
    desc: 'Unlock background eksklusif untuk Plong.',
    apply(state) {
      state.pet.background = 'dream_garden';
      return 'Background Taman Mimpi sudah aktif.';
    }
  },
  p3: {
    id: 'p3', name: 'Mahkota Emosi', price: 80, icon: '👑', type: 'unlock', key: 'acc_crown',
    desc: 'Aksesoris mahkota untuk Plong.',
    apply(state) {
      state.pet.accessory = 'crown';
      state.pet.avatar = { ...(state.pet.avatar || {}), accessory: 'crown' };
      return 'Mahkota Emosi sudah dipakai oleh Plong.';
    }
  },
  p4: {
    id: 'p4', name: 'Bola Kristal', price: 90, icon: '🔮', type: 'consumable',
    desc: 'Buat refleksi mood ringan dari komposisi emosi.',
    apply(state) {
      const dominant = getDominantMood(state.emotions || {});
      state.lastCrystal = {
        mood: dominant,
        text: getCrystalText(dominant),
        createdAt: new Date().toISOString()
      };
      state.pet.happy = clamp((state.pet.happy || 0) + 8, 0, 100);
      return state.lastCrystal.text;
    }
  },
  p5: {
    id: 'p5', name: 'Sayap Emas', price: 350, icon: '✨', type: 'unlock', key: 'acc_wings',
    desc: 'Evolusi visual karakter Plong.',
    apply(state) {
      state.pet.wings = true;
      state.pet.happy = clamp((state.pet.happy || 0) + 20, 0, 100);
      return 'Sayap Emas aktif. Plong kelihatan makin spesial.';
    }
  }
};


const VEGGIE_CATALOG = {
  carrot: {
    id: 'carrot', name: 'Wortel Ceria', icon: '🥕', growNeed: 3,
    hunger: 24, happy: 7, exp: 5,
    desc: 'Makanan ringan yang bikin Plong lebih kenyang.'
  },
  lettuce: {
    id: 'lettuce', name: 'Selada Tenang', icon: '🥬', growNeed: 2,
    hunger: 18, happy: 10, exp: 4,
    desc: 'Sayur adem yang cocok buat mood tenang.'
  },
  tomato: {
    id: 'tomato', name: 'Tomat Semangat', icon: '🍅', growNeed: 4,
    hunger: 28, happy: 12, exp: 6,
    desc: 'Buah-sayur penuh energi buat Plong.'
  }
};

function defaultGarden() {
  return {
    activePlot: 0,
    plot: null,
    plots: Array.from({ length: 4 }, () => null),
    inventory: { carrot: 0, lettuce: 0, tomato: 0 },
    history: [],

    // Hifami-like garden tycoon system
    level: 1,
    exp: 0,
    expMax: 40,
    lastIdleAt: new Date().toISOString(),
    lastBonusAt: null,

    // Shopee-Tanam-like water bank + daily tasks
    waterDrops: 20,
    lastWaterClaimAt: null,
    daily: {
      date: new Date().toISOString().slice(0, 10),
      planted: 0,
      watered: 0,
      harvested: 0,
      claimed: false
    }
  };
}

function plotIndexFrom(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(3, n));
}

function gardenActivePlantCount(garden) {
  if (!garden || !Array.isArray(garden.plots)) return 0;
  return garden.plots.filter(Boolean).length;
}

function gardenWaterPower(garden) {
  const level = Math.max(1, Math.floor(Number(garden?.level || 1)));
  return Math.max(1, 1 + Math.floor((level - 1) / 3));
}

function gardenIdleRate(garden) {
  const level = Math.max(1, Math.floor(Number(garden?.level || 1)));
  const active = gardenActivePlantCount(garden);
  // Similar to idle mining, but softer: active plots + garden level determine idle coins.
  return Math.max(1, active + Math.floor(level / 2));
}

function gardenUpgradeCost(garden) {
  const level = Math.max(1, Math.floor(Number(garden?.level || 1)));
  return 24 + level * 18;
}

function addGardenExp(garden, amount) {
  garden.level = Math.max(1, Math.floor(Number(garden.level || 1)));
  garden.exp = Math.max(0, Math.floor(Number(garden.exp || 0))) + Math.max(0, Math.floor(Number(amount || 0)));
  garden.expMax = Math.max(40, Math.floor(Number(garden.expMax || 40)));
  let leveled = false;
  while (garden.exp >= garden.expMax) {
    garden.exp -= garden.expMax;
    garden.level += 1;
    garden.expMax = Math.max(40, Math.floor(garden.expMax * 1.35));
    leveled = true;
  }
  return leveled;
}

function calculateGardenIdle(garden) {
  ensureGarden({ garden });
  const now = Date.now();
  const last = garden.lastIdleAt ? Date.parse(garden.lastIdleAt) : now;
  const diffMs = Math.max(0, now - (Number.isFinite(last) ? last : now));
  const capMs = Number(process.env.GARDEN_IDLE_CAP_MS || 12 * 60 * 60 * 1000); // max 12 hours
  const effectiveMs = Math.min(diffMs, capMs);
  const minutes = Math.floor(effectiveMs / 60000);
  const rate = gardenIdleRate(garden);
  const coins = Math.floor(minutes * rate);
  return { coins, minutes, rate };
}

function normalizeGardenPlot(plot) {
  if (!plot || typeof plot !== 'object') return null;
  const seed = String(plot.seed || 'carrot').trim().toLowerCase();
  const veggie = VEGGIE_CATALOG[seed];
  if (!veggie) return null;

  const growNeed = veggie.growNeed;
  const waterCount = Math.max(0, Math.floor(Number(plot.waterCount || 0)));
  const progressRaw = Number(plot.progress || 0);
  const progress = clamp(Number.isFinite(progressRaw) ? progressRaw : 0, 0, 100);

  return {
    seed,
    progress,
    waterCount,
    growNeed,
    stage: Math.min(growNeed, Math.floor(Number(plot.stage || waterCount || 0))),
    ready: Boolean(plot.ready) || waterCount >= growNeed || progress >= 100,
    plantedAt: plot.plantedAt || new Date().toISOString(),
    lastWaterAt: plot.lastWaterAt || null
  };
}

function ensureGarden(state) {
  const base = defaultGarden();
  const current = state.garden && typeof state.garden === 'object' ? state.garden : {};

  const activePlot = plotIndexFrom(current.activePlot);
  let plots = Array.isArray(current.plots) ? current.plots.slice(0, 4) : [];

  while (plots.length < 4) plots.push(null);
  plots = plots.map(normalizeGardenPlot);

  // Backward compatibility: migrate old single-plot data into the active plot.
  const oldPlot = normalizeGardenPlot(current.plot);
  if (oldPlot && !plots[activePlot]) plots[activePlot] = oldPlot;

  state.garden = {
    ...base,
    ...current,
    activePlot,
    plots,
    plot: plots[activePlot] || null,
    inventory: {
      ...base.inventory,
      ...(current.inventory || {})
    },
    history: Array.isArray(current.history) ? current.history : []
  };

  for (const key of Object.keys(state.garden.inventory)) {
    state.garden.inventory[key] = Math.max(0, Math.floor(Number(state.garden.inventory[key] || 0)));
  }

  state.garden.level = Math.max(1, Math.floor(Number(state.garden.level || 1)));
  state.garden.exp = Math.max(0, Math.floor(Number(state.garden.exp || 0)));
  state.garden.expMax = Math.max(40, Math.floor(Number(state.garden.expMax || 40)));
  state.garden.lastIdleAt = state.garden.lastIdleAt || new Date().toISOString();
  state.garden.lastBonusAt = state.garden.lastBonusAt || null;
  state.garden.waterDrops = Math.max(0, Math.floor(Number(state.garden.waterDrops ?? 20)));
  state.garden.lastWaterClaimAt = state.garden.lastWaterClaimAt || null;
  const today = new Date().toISOString().slice(0, 10);
  if (!state.garden.daily || state.garden.daily.date !== today) {
    state.garden.daily = { date: today, planted: 0, watered: 0, harvested: 0, claimed: false };
  }
  state.garden.daily.planted = Math.max(0, Math.floor(Number(state.garden.daily.planted || 0)));
  state.garden.daily.watered = Math.max(0, Math.floor(Number(state.garden.daily.watered || 0)));
  state.garden.daily.harvested = Math.max(0, Math.floor(Number(state.garden.daily.harvested || 0)));
  state.garden.daily.claimed = Boolean(state.garden.daily.claimed);
  state.garden.history = state.garden.history.slice(0, 30);
  return state.garden;
}

function gardenPublic(garden) {
  const wrapper = { garden: garden && typeof garden === 'object' ? garden : defaultGarden() };
  const g = ensureGarden(wrapper);
  return {
    activePlot: g.activePlot,
    plot: g.plot,
    plots: g.plots,
    inventory: { ...defaultGarden().inventory, ...g.inventory },
    history: Array.isArray(g.history) ? g.history.slice(0, 30) : [],
    seeds: Object.values(VEGGIE_CATALOG),
    level: g.level,
    exp: g.exp,
    expMax: g.expMax,
    idle: calculateGardenIdle(g),
    waterPower: gardenWaterPower(g),
    upgradeCost: gardenUpgradeCost(g),
    waterDrops: g.waterDrops,
    daily: g.daily,
    nextWaterClaimAt: g.lastWaterClaimAt ? new Date(Date.parse(g.lastWaterClaimAt) + Number(process.env.GARDEN_WATER_CLAIM_COOLDOWN_MS || 6 * 60 * 60 * 1000)).toISOString() : null,
    nextBonusAt: g.lastBonusAt ? new Date(Date.parse(g.lastBonusAt) + Number(process.env.GARDEN_BONUS_COOLDOWN_MS || 6 * 60 * 60 * 1000)).toISOString() : null
  };
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function ensureGameState(state, user) {
  const base = defaultAppState(user || {});
  const next = { ...base, ...(state || {}) };
  next.pet = { ...base.pet, ...(next.pet || {}) };
  next.pet.avatar = { ...base.pet.avatar, ...(next.pet.avatar || {}) };
  next.account = { ...base.account, ...(next.account || {}) };
  next.emotions = { ...base.emotions, ...(next.emotions || {}) };
  next.art = Array.isArray(next.art) ? next.art : [];
  next.ch = Array.isArray(next.ch) ? next.ch : [];
  next.vents = Array.isArray(next.vents) ? next.vents : [];
  next.inventory = Array.isArray(next.inventory) ? next.inventory : [];
  next.redeemHistory = Array.isArray(next.redeemHistory) ? next.redeemHistory : [];
  ensureGarden(next);
  next.pet.hunger = clamp(next.pet.hunger, 0, 100);
  next.pet.happy = clamp(next.pet.happy, 0, 100);
  next.pet.energy = clamp(next.pet.energy ?? 70, 0, 100);
  next.pet.bond = clamp(next.pet.bond ?? 0, 0, 100);
  next.pet.level = Math.max(1, Number(next.pet.level || 1));
  next.pet.exp = Math.max(0, Number(next.pet.exp || 0));
  next.pet.expMax = Math.max(30, Number(next.pet.expMax || 30));
  ensurePetWorker(next);
  next.coins = Math.max(0, Math.floor(Number(next.coins || 0)));
  return next;
}

function addPetExp(state, exp) {
  state.pet.exp += Math.max(0, Math.floor(Number(exp || 0)));
  let leveled = false;
  while (state.pet.exp >= state.pet.expMax) {
    state.pet.exp -= state.pet.expMax;
    state.pet.level += 1;
    state.pet.expMax = Math.max(30, Math.floor(state.pet.expMax * 1.35));
    state.pet.happy = clamp((state.pet.happy || 0) + 8, 0, 100);
    leveled = true;
  }
  return leveled;
}

function ensurePetWorker(state) {
  const today = new Date().toISOString().slice(0, 10);
  if (!state.pet) state.pet = defaultAppState().pet;
  state.pet.energy = clamp(state.pet.energy ?? 70, 0, 100);
  state.pet.bond = clamp(state.pet.bond ?? 0, 0, 100);
  if (!state.pet.worker || typeof state.pet.worker !== 'object') state.pet.worker = {};
  if (!state.pet.worker.essence || typeof state.pet.worker.essence !== 'object') state.pet.worker.essence = {};
  for (const mood of ALLOWED_MOODS) {
    state.pet.worker.essence[mood] = Math.max(0, Math.floor(Number(state.pet.worker.essence[mood] || 0)));
  }
  state.pet.worker.lastClaimAt = state.pet.worker.lastClaimAt || new Date().toISOString();
  state.pet.worker.totalEarned = Math.max(0, Math.floor(Number(state.pet.worker.totalEarned || 0)));
  if (!state.pet.worker.today || state.pet.worker.today.date !== today) {
    state.pet.worker.today = { date: today, vent: 0, chat: 0, garden: 0, care: 0, bonusClaimed: false };
  }
  state.pet.worker.today.vent = Math.max(0, Math.floor(Number(state.pet.worker.today.vent || 0)));
  state.pet.worker.today.chat = Math.max(0, Math.floor(Number(state.pet.worker.today.chat || 0)));
  state.pet.worker.today.garden = Math.max(0, Math.floor(Number(state.pet.worker.today.garden || 0)));
  state.pet.worker.today.care = Math.max(0, Math.floor(Number(state.pet.worker.today.care || 0)));
  state.pet.worker.today.bonusClaimed = Boolean(state.pet.worker.today.bonusClaimed);
  return state.pet.worker;
}

function moodCoinMultiplier(mood) {
  const map = { excited: 1.3, tenang: 1.15, sedih: 1.05, galau: 1.05, stres: 1, marah: 0.95 };
  return map[mood] || 1;
}

function petWorkerPower(state, mood = 'tenang') {
  ensurePetWorker(state);
  const level = Math.max(1, Number(state.pet.level || 1));
  const bond = clamp(state.pet.bond || 0, 0, 100);
  const happy = clamp(state.pet.happy || 0, 0, 100);
  const energy = clamp(state.pet.energy || 0, 0, 100);
  const base = 1 + level * 0.35 + bond * 0.025;
  const condition = 0.55 + ((happy + energy) / 200) * 0.65;
  return Math.max(1, base * condition * moodCoinMultiplier(mood));
}

function addPetWorkerReward(state, opts = {}) {
  ensurePetWorker(state);
  const mood = ALLOWED_MOODS.includes(opts.mood) ? opts.mood : getDominantMood(state.emotions);
  const type = String(opts.type || 'activity');
  const amount = Math.max(1, Math.floor(Number(opts.amount || 1)));
  const exp = Math.max(0, Math.floor(Number(opts.exp || 0)));
  const essence = Math.max(0, Math.floor(Number(opts.essence || 0)));
  const bond = Math.max(0, Math.floor(Number(opts.bond || 0)));

  const dailyCaps = { chat: 8, vent: 6, garden: 20, care: 12, activity: 20 };
  const todayKey = dailyCaps[type] !== undefined ? type : 'activity';
  if (todayKey !== 'activity') {
    const used = Math.max(0, Math.floor(Number(state.pet.worker.today[todayKey] || 0)));
    if (used >= dailyCaps[todayKey]) {
      return { coins: 0, exp: 0, essence: 0, leveledUp: false, message: 'Limit reward harian aktivitas ini sudah tercapai.' };
    }
    state.pet.worker.today[todayKey] = used + 1;
  }

  const coins = Math.max(1, Math.floor(amount * petWorkerPower(state, mood)));
  state.coins = Math.max(0, Math.floor(Number(state.coins || 0)) + coins);
  state.pet.worker.essence[mood] = Math.max(0, Math.floor(Number(state.pet.worker.essence[mood] || 0)) + essence);
  state.pet.worker.totalEarned = Math.max(0, Math.floor(Number(state.pet.worker.totalEarned || 0)) + coins);
  state.pet.bond = clamp((state.pet.bond || 0) + bond, 0, 100);
  state.pet.energy = clamp((state.pet.energy || 0) - Math.max(0, Math.floor(coins / 5)), 0, 100);
  state.pet.happy = clamp((state.pet.happy || 0) + Math.min(4, bond + 1), 0, 100);
  const leveledUp = addPetExp(state, exp);
  return { coins, exp, essence, mood, leveledUp };
}

function calculatePetPassive(state) {
  ensurePetWorker(state);
  const now = Date.now();
  const last = state.pet.worker.lastClaimAt ? Date.parse(state.pet.worker.lastClaimAt) : now;
  const diffMs = Math.max(0, now - (Number.isFinite(last) ? last : now));
  const capMs = Number(process.env.PET_PASSIVE_CAP_MS || 8 * 60 * 60 * 1000);
  const minutes = Math.floor(Math.min(diffMs, capMs) / 60000);
  if (minutes < 10) return { coins: 0, minutes, rate: 0 };
  const mood = getDominantMood(state.emotions);
  const hourly = Math.max(1, Math.floor(petWorkerPower(state, mood) * 0.9));
  const coins = Math.floor((minutes / 60) * hourly);
  return { coins: Math.max(0, coins), minutes, rate: hourly, mood };
}

function convertEssenceToCoins(state, mood = 'all') {
  ensurePetWorker(state);
  const moods = mood === 'all' ? ALLOWED_MOODS : [mood].filter((m) => ALLOWED_MOODS.includes(m));
  let used = 0;
  let coins = 0;
  for (const m of moods) {
    const amount = Math.max(0, Math.floor(Number(state.pet.worker.essence[m] || 0)));
    if (!amount) continue;
    used += amount;
    coins += Math.floor(amount * petWorkerPower(state, m));
    state.pet.worker.essence[m] = 0;
  }
  state.coins = Math.max(0, Math.floor(Number(state.coins || 0)) + coins);
  state.pet.worker.totalEarned = Math.max(0, Math.floor(Number(state.pet.worker.totalEarned || 0)) + coins);
  const leveledUp = addPetExp(state, Math.min(80, used * 3));
  state.pet.energy = clamp((state.pet.energy || 0) - Math.min(18, used), 0, 100);
  return { used, coins, leveledUp };
}


function getDominantMood(emotions = {}) {
  const entries = Object.entries(emotions).filter(([, v]) => Number(v) > 0);
  if (!entries.length) return 'tenang';
  entries.sort((a, b) => Number(b[1]) - Number(a[1]));
  return ALLOWED_MOODS.includes(entries[0][0]) ? entries[0][0] : 'tenang';
}

function getCrystalText(mood) {
  const map = {
    marah: 'Energi kamu lagi panas. Hari ini cocok buat pelan-pelan meredakan dulu, bukan memaksa semuanya beres.',
    sedih: 'Ada bagian dari dirimu yang lagi butuh ditemani. Jangan buru-buru menganggap perasaan ini salah.',
    galau: 'Pikiranmu lagi banyak bercabang. Pilih satu hal kecil dulu buat diurai.',
    stres: 'Tubuh dan pikiranmu kelihatan butuh jeda. Ambil napas, turunkan tempo sebentar.',
    excited: 'Energi positifmu lagi naik. Simpan momentum ini buat hal yang bikin kamu berkembang.',
    tenang: 'Mood kamu cukup stabil. Ini waktu yang bagus buat merawat diri dan menjaga ritme.'
  };
  return map[mood] || map.tenang;
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  try { return JSON.parse(raw); } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function detectMoodFromText(transcript = '') {
  const text = String(transcript || '').toLowerCase();

  const rules = [
    { mood: 'excited', score: 0, patterns: [
      /\bsenang\b/g, /seneng/g, /bahagia/g, /happy/g, /gembira/g, /semangat/g,
      /excited/g, /antusias/g, /bangga/g, /bersyukur/g, /suka banget/g, /senang banget/g, /seneng banget/g
    ]},
    { mood: 'tenang', score: 0, patterns: [
      /tenang/g, /lega/g, /damai/g, /rileks/g, /relax/g, /kalem/g, /plong/g, /adem/g
    ]},
    { mood: 'marah', score: 0, patterns: [
      /marah/g, /kesel/g, /kesal/g, /benci/g, /emosi/g, /muak/g, /sebel/g, /jengkel/g, /anjing/g, /bangsat/g
    ]},
    { mood: 'sedih', score: 0, patterns: [
      /sedih/g, /nangis/g, /menangis/g, /kecewa/g, /hampa/g, /sakit hati/g, /sendiri/g, /kesepian/g, /putus asa/g
    ]},
    { mood: 'stres', score: 0, patterns: [
      /stres/g, /stress/g, /pusing/g, /tertekan/g, /deadline/g, /beban/g, /berat banget/g, /capek/g, /lelah/g, /kewalahan/g
    ]},
    { mood: 'galau', score: 0, patterns: [
      /galau/g, /bingung/g, /masa depan/g, /takut/g, /overthinking/g, /ragu/g, /dilema/g, /cemas/g, /khawatir/g
    ]}
  ];

  for (const rule of rules) {
    for (const pattern of rule.patterns) {
      const matches = text.match(pattern);
      if (matches) rule.score += matches.length;
    }
  }

  // Frasa positif yang kuat harus menang dari default model kecil yang kadang menebak “galau”.
  if (/senang banget|seneng banget|bahagia banget|happy banget|lagi senang|lagi seneng|aku senang|aku seneng|aku bahagia/.test(text)) {
    return { mood: 'excited', confidence: 5 };
  }
  if (/lega banget|aku tenang|lagi tenang|rasanya plong/.test(text)) {
    return { mood: 'tenang', confidence: 4 };
  }

  rules.sort((a, b) => b.score - a.score);
  if (!rules[0] || rules[0].score <= 0) return { mood: 'tenang', confidence: 0 };

  return { mood: rules[0].mood, confidence: rules[0].score };
}

function fallbackVentAnalysis(transcript, durationSeconds) {
  const t = String(transcript || '').toLowerCase();
  const detected = detectMoodFromText(t);
  const mood = detected.mood || 'tenang';
  const duration = clamp(durationSeconds, 1, 90);
  const intensity = clamp(Math.round(45 + duration * 0.55 + (t.length > 80 ? 12 : 0)), 35, 92);

  const moodCopy = {
    excited: {
      title: 'Energi positif tersimpan',
      summary: 'Aku menangkap energi senang dari ceritamu dan menyimpannya sebagai emosi positif.',
      insight: 'Senang juga layak dirayakan, meski lewat hal kecil.',
      suggestion: 'Simpan momen ini sebentar, biar tubuhmu ikut ngerasain rasa baiknya.'
    },
    tenang: {
      title: 'Rasa tenang tersimpan',
      summary: 'Aku menangkap suasana yang lebih adem dari vent kamu.',
      insight: 'Rasa tenang seperti ini bisa jadi tempat singgah yang aman buat pikiranmu.',
      suggestion: 'Nikmati pelan-pelan, nggak perlu buru-buru pindah ke hal lain.'
    },
    marah: {
      title: 'Api emosi tersimpan',
      summary: 'Aku menangkap rasa kesal atau marah yang lagi keluar dari ceritamu.',
      insight: 'Marah itu sinyal kalau ada sesuatu yang terasa nggak adil atau melewati batasmu.',
      suggestion: 'Coba redakan tubuh dulu sebelum ambil keputusan besar.'
    },
    sedih: {
      title: 'Rasa sedih tersimpan',
      summary: 'Aku menangkap bagian dari dirimu yang lagi berat dan butuh ditemani.',
      insight: 'Sedih bukan tanda kamu lemah, itu tanda ada hal yang berarti buatmu.',
      suggestion: 'Temani dirimu pelan-pelan dulu, jangan dipaksa langsung baik-baik saja.'
    },
    stres: {
      title: 'Beban pikiran tersimpan',
      summary: 'Aku menangkap tekanan atau rasa lelah yang lagi numpuk.',
      insight: 'Kalau semuanya terasa berat, biasanya tubuhmu lagi minta jeda.',
      suggestion: 'Ambil satu hal paling kecil yang bisa kamu bereskan dulu.'
    },
    galau: {
      title: 'Pikiran bercabang tersimpan',
      summary: 'Aku menangkap rasa bingung atau pikiran yang lagi bercabang.',
      insight: 'Galau sering muncul saat ada banyak kemungkinan yang belum jelas.',
      suggestion: 'Coba pilih satu hal yang paling bikin kepikiran, lalu urai pelan-pelan.'
    }
  };

  const copy = moodCopy[mood] || moodCopy.tenang;
  return {
    mood,
    intensity,
    title: copy.title,
    summary: transcript ? copy.summary : 'Suaramu sudah diproses sebagai energi emosi, walau transkrip belum terbaca.',
    insight: copy.insight,
    suggestion: copy.suggestion,
    coins: Math.floor(intensity / 8) + 5,
    exp: Math.floor(intensity / 10) + 6,
    hungerDelta: 8,
    happyDelta: mood === 'sedih' || mood === 'stres' ? 8 : 12
  };
}

async function analyzeVentWithAI({ transcript, durationSeconds, language, model }) {
  const selectedLanguage = normalizeLanguage(language || 'id');
  const content = String(transcript || '').trim().slice(0, 2000);
  const fallback = fallbackVentAnalysis(content, durationSeconds);

  if (!content && Number(durationSeconds || 0) < 2) return fallback;

  const prompt = `
Analisis vent/curhat user untuk aplikasi VokaMon.
Balas hanya JSON valid tanpa markdown.

Bahasa output: ${selectedLanguage}
Mood yang boleh dipilih: marah, sedih, galau, stres, excited, tenang.
Durasi suara: ${Math.round(Number(durationSeconds || 0))} detik.
Transkrip suara: ${content || '(Tidak ada transkrip. Analisis sebagai pelepasan emosi non-verbal.)'}

Format JSON wajib. Isi mood dengan salah satu mood yang cocok, jangan menyalin placeholder:
{
  "mood":"excited",
  "intensity":70,
  "title":"judul pendek",
  "summary":"ringkasan empatik 1 kalimat",
  "insight":"validasi/insight singkat 1 kalimat",
  "suggestion":"saran kecil 1 kalimat",
  "coins":12,
  "exp":10,
  "hungerDelta":8,
  "happyDelta":10
}

Panduan mood:
- Jika transkrip berisi senang, seneng, bahagia, happy, semangat, excited, antusias, bangga, atau bersyukur, pilih mood "excited".
- Jika transkrip berisi lega, tenang, damai, rileks, plong, atau kalem, pilih mood "tenang".
- Jika transkrip berisi bingung, galau, ragu, dilema, overthinking, cemas, atau khawatir, pilih mood "galau".
- Jika transkrip berisi stres, pusing, tertekan, deadline, kewalahan, capek, atau lelah, pilih mood "stres".
- Jika transkrip berisi sedih, nangis, kecewa, hampa, sakit hati, sendiri, atau kesepian, pilih mood "sedih".
- Jika transkrip berisi marah, kesel, kesal, benci, emosi, muak, sebel, atau jengkel, pilih mood "marah".

Aturan:
- Jangan diagnosis medis.
- Jangan menyebut diri sebagai AI.
- Jangan default ke galau kalau transkripnya positif.
- intensity 20-100.
- coins 5-20.
- exp 6-16.
- hungerDelta 4-12 karena emosi menjadi makanan pet.
- happyDelta 3-15.
`.trim();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.AI_TIMEOUT_MS || 120000));
    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: model || process.env.DEFAULT_MODEL || 'qwen2.5:3b',
        stream: false,
        keep_alive: '10m',
        messages: [
          { role: 'system', content: 'Kamu menganalisis emosi user untuk aplikasi self-reflection. Balas hanya JSON valid.' },
          { role: 'user', content: prompt }
        ],
        options: {
          temperature: 0.35,
          top_p: 0.82,
          repeat_penalty: 1.12,
          num_ctx: 2048,
          num_predict: 260,
          num_thread: Number(process.env.AI_NUM_THREAD || 8)
        }
      })
    });
    clearTimeout(timeout);
    const text = await r.text();
    if (!r.ok) return fallback;
    const parsed = extractJsonObject(JSON.parse(text).message?.content || text);
    if (!parsed) return fallback;
    const aiMood = ALLOWED_MOODS.includes(parsed.mood) ? parsed.mood : fallback.mood;
    const keywordMood = detectMoodFromText(content);
    const mood = keywordMood.confidence >= 2 ? keywordMood.mood : aiMood;

    return {
      mood,
      intensity: clamp(parsed.intensity, 20, 100),
      title: String(parsed.title || fallback.title).slice(0, 80),
      summary: String(parsed.summary || fallback.summary).slice(0, 220),
      insight: String(parsed.insight || fallback.insight).slice(0, 220),
      suggestion: String(parsed.suggestion || fallback.suggestion).slice(0, 220),
      coins: clamp(parsed.coins, 5, 20),
      exp: clamp(parsed.exp, 6, 16),
      hungerDelta: clamp(parsed.hungerDelta, 4, 12),
      happyDelta: clamp(parsed.happyDelta, 3, 15)
    };
  } catch (error) {
    console.warn('AI vent fallback:', error.message);
    return fallback;
  }
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

app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 40);
    const email = cleanEmail(req.body.email);
    const username = cleanUsername(req.body.username || name || email.split('@')[0]);
    const password = String(req.body.password || '');

    if (!name) return res.status(400).json({ ok: false, error: 'Nama wajib diisi.' });
    if (!email || !email.includes('@')) return res.status(400).json({ ok: false, error: 'Email tidak valid.' });
    if (!username || username.length < 3) return res.status(400).json({ ok: false, error: 'Username minimal 3 karakter.' });
    if (password.length < 8) return res.status(400).json({ ok: false, error: 'Password minimal 8 karakter.' });

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

app.post('/api/auth/login', authLimiter, async (req, res) => {
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


app.get('/api/redeem/products', requireAuth, async (req, res) => {
  res.json({
    ok: true,
    products: Object.values(PRODUCT_CATALOG).map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price,
      icon: p.icon,
      desc: p.desc,
      type: p.type,
      key: p.key || null
    }))
  });
});

app.post('/api/vent/analyze', requireAuth, async (req, res) => {
  try {
    const transcript = String(req.body.transcript || '').trim().slice(0, 2000);
    const durationSeconds = clamp(req.body.durationSeconds, 1, 90);
    const model = String(req.body.model || process.env.DEFAULT_MODEL || 'qwen2.5:3b');
    const language = req.body.language || 'id';

    const state = ensureGameState(await getStateForUser(req.user), req.user);
    const result = await analyzeVentWithAI({ transcript, durationSeconds, language, model });

    const mood = ALLOWED_MOODS.includes(result.mood) ? result.mood : 'tenang';
    const coins = Math.floor(clamp(result.coins, 5, 20));
    const exp = Math.floor(clamp(result.exp, 6, 16));

    state.emotions[mood] = Math.max(0, Number(state.emotions[mood] || 0)) + 1;
    state.pet.hunger = clamp((state.pet.hunger || 0) + result.hungerDelta, 0, 100);
    state.pet.happy = clamp((state.pet.happy || 0) + result.happyDelta, 0, 100);
    state.pet.energy = clamp((state.pet.energy || 70) + 3, 0, 100);
    state.pet.lastCareAt = new Date().toISOString();
    const workerReward = addPetWorkerReward(state, {
      type: 'vent',
      mood,
      amount: Math.max(3, Math.floor(coins / 2)),
      exp,
      essence: Math.max(1, Math.floor(durationSeconds / 20) + 1),
      bond: 1
    });
    const leveledUp = workerReward.leveledUp;

    const vent = {
      id: Date.now().toString(36),
      mood,
      intensity: Math.floor(result.intensity),
      transcript,
      title: result.title,
      summary: result.summary,
      insight: result.insight,
      suggestion: result.suggestion,
      coins: workerReward.coins,
      exp: workerReward.exp,
      essence: workerReward.essence,
      durationSeconds,
      createdAt: new Date().toISOString()
    };
    state.vents.unshift(vent);
    state.vents = state.vents.slice(0, 50);

    await saveStateForUser(req.user.id, state);

    res.json({ ok: true, result: { ...vent, leveledUp }, state });
  } catch (error) {
    console.error('Vent analyze error:', error);
    res.status(500).json({ ok: false, error: 'Gagal menganalisis vent.' });
  }
});

app.post('/api/redeem', requireAuth, async (req, res) => {
  try {
    const productId = String(req.body.productId || '').trim();
    const product = PRODUCT_CATALOG[productId];
    if (!product) return res.status(404).json({ ok: false, error: 'Produk tidak ditemukan.' });

    const state = ensureGameState(await getStateForUser(req.user), req.user);
    const owned = product.key && state.inventory.includes(product.key);

    if (owned) {
      if (product.key === 'bg_dream_garden') state.pet.background = 'dream_garden';
      if (product.key === 'acc_crown') { state.pet.accessory = 'crown'; state.pet.avatar = { ...(state.pet.avatar || {}), accessory: 'crown' }; }
      if (product.key === 'acc_wings') state.pet.wings = true;
      await saveStateForUser(req.user.id, state);
      return res.json({ ok: true, state, message: `${product.name} sudah kamu punya dan sudah dipakai.` });
    }

    if (Number(state.coins || 0) < product.price) {
      return res.status(400).json({ ok: false, error: 'Soul Coins belum cukup.' });
    }

    state.coins = Math.max(0, Math.floor(Number(state.coins || 0)) - product.price);
    const message = product.apply(state);

    if (product.key && !state.inventory.includes(product.key)) state.inventory.push(product.key);
    state.redeemHistory.unshift({
      id: Date.now().toString(36),
      productId,
      name: product.name,
      price: product.price,
      message,
      createdAt: new Date().toISOString()
    });
    state.redeemHistory = state.redeemHistory.slice(0, 50);

    await saveStateForUser(req.user.id, state);
    res.json({ ok: true, state, message });
  } catch (error) {
    console.error('Redeem error:', error);
    res.status(500).json({ ok: false, error: 'Gagal redeem produk.' });
  }
});



app.get('/api/garden', requireAuth, async (req, res) => {
  try {
    const state = ensureGameState(await getStateForUser(req.user), req.user);
    res.json({ ok: true, garden: gardenPublic(state.garden), state });
  } catch (error) {
    console.error('Garden get error:', error);
    res.status(500).json({ ok: false, error: 'Gagal memuat kebun.' });
  }
});

app.post('/api/garden/plant', requireAuth, async (req, res) => {
  try {
    const seed = String(req.body.seed || 'carrot').trim().toLowerCase();
    const veggie = VEGGIE_CATALOG[seed];
    if (!veggie) return res.status(400).json({ ok: false, error: 'Bibit sayur tidak valid.' });

    const state = ensureGameState(await getStateForUser(req.user), req.user);
    ensureGarden(state);

    const plotIndex = plotIndexFrom(req.body.plotIndex ?? state.garden.activePlot);
    state.garden.activePlot = plotIndex;

    const currentPlot = state.garden.plots[plotIndex] || null;
    if (currentPlot && !currentPlot.ready) {
      return res.status(400).json({ ok: false, error: `Plot ${plotIndex + 1} masih ada tanaman yang sedang tumbuh.` });
    }
    if (currentPlot && currentPlot.ready) {
      return res.status(400).json({ ok: false, error: `Plot ${plotIndex + 1} siap panen. Panen dulu ya.` });
    }

    state.garden.plots[plotIndex] = {
      seed,
      progress: 0,
      waterCount: 0,
      growNeed: veggie.growNeed,
      stage: 0,
      ready: false,
      plantedAt: new Date().toISOString(),
      lastWaterAt: null
    };
    state.garden.plot = state.garden.plots[plotIndex];

    state.garden.history.unshift({
      id: Date.now().toString(36),
      type: 'plant',
      seed,
      plotIndex,
      text: `${veggie.name} ditanam di Plot ${plotIndex + 1}.`,
      createdAt: new Date().toISOString()
    });
    addGardenExp(state.garden, 3);
    state.garden.daily.planted = Math.max(0, Math.floor(Number(state.garden.daily.planted || 0))) + 1;
    state.garden.history = state.garden.history.slice(0, 30);

    await saveStateForUser(req.user.id, state);
    res.json({ ok: true, state, garden: gardenPublic(state.garden), message: `${veggie.name} berhasil ditanam di Plot ${plotIndex + 1}.` });
  } catch (error) {
    console.error('Garden plant error:', error);
    res.status(500).json({ ok: false, error: 'Gagal menanam sayur.', detail: process.env.NODE_ENV === 'production' ? undefined : error.message });
  }
});

app.post('/api/garden/water', requireAuth, async (req, res) => {
  try {
    const state = ensureGameState(await getStateForUser(req.user), req.user);
    ensureGarden(state);

    const plotIndex = plotIndexFrom(req.body.plotIndex ?? state.garden.activePlot);
    state.garden.activePlot = plotIndex;

    const plot = state.garden.plots[plotIndex] || null;
    if (!plot) return res.status(400).json({ ok: false, error: `Plot ${plotIndex + 1} belum ada tanaman. Pilih bibit dulu.` });

    const veggie = VEGGIE_CATALOG[plot.seed];
    if (!veggie) return res.status(400).json({ ok: false, error: 'Tanaman tidak valid.' });
    if (plot.ready) {
      state.garden.plot = plot;
      return res.json({ ok: true, state, garden: gardenPublic(state.garden), message: `Plot ${plotIndex + 1} sudah siap panen.` });
    }

    const cooldownMs = Number(process.env.GARDEN_WATER_COOLDOWN_MS || 8000);
    const now = Date.now();
    const last = plot.lastWaterAt ? Date.parse(plot.lastWaterAt) : 0;
    if (cooldownMs > 0 && last && now - last < cooldownMs) {
      const wait = Math.ceil((cooldownMs - (now - last)) / 1000);
      return res.status(429).json({ ok: false, error: `Tunggu ${wait} detik lagi sebelum menyiram Plot ${plotIndex + 1}.` });
    }

    if (state.garden.waterDrops <= 0) {
      return res.status(400).json({ ok: false, error: 'Air habis. Klaim air dulu atau ambil bonus harian.' });
    }

    const waterPower = gardenWaterPower(state.garden);
    state.garden.waterDrops = Math.max(0, Math.floor(Number(state.garden.waterDrops || 0)) - 1);
    plot.waterCount = Math.max(0, Number(plot.waterCount || 0)) + waterPower;
    plot.growNeed = veggie.growNeed;
    plot.stage = Math.min(veggie.growNeed, plot.waterCount);
    plot.progress = clamp(Math.round((plot.waterCount / veggie.growNeed) * 100), 0, 100);
    plot.lastWaterAt = new Date().toISOString();

    if (plot.waterCount >= veggie.growNeed) {
      plot.ready = true;
      plot.progress = 100;
    }

    state.garden.plots[plotIndex] = plot;
    state.garden.plot = plot;

    state.pet.happy = clamp((state.pet.happy || 0) + 2, 0, 100);
    state.pet.lastCareAt = new Date().toISOString();
    addGardenExp(state.garden, plot.ready ? 6 : 2);
    state.garden.daily.watered = Math.max(0, Math.floor(Number(state.garden.daily.watered || 0))) + 1;
    addPetWorkerReward(state, { type: 'garden', mood: 'tenang', amount: plot.ready ? 2 : 1, exp: plot.ready ? 4 : 2, essence: 0, bond: 0 });

    state.garden.history.unshift({
      id: Date.now().toString(36),
      type: 'water',
      seed: plot.seed,
      plotIndex,
      text: plot.ready ? `Plot ${plotIndex + 1}: ${veggie.name} siap dipanen!` : `Plot ${plotIndex + 1}: ${veggie.name} disiram.`,
      createdAt: new Date().toISOString()
    });
    state.garden.history = state.garden.history.slice(0, 30);

    await saveStateForUser(req.user.id, state);
    res.json({ ok: true, state, garden: gardenPublic(state.garden), message: plot.ready ? `${veggie.name} di Plot ${plotIndex + 1} siap dipanen!` : `Plot ${plotIndex + 1} disiram.` });
  } catch (error) {
    console.error('Garden water error:', error);
    res.status(500).json({ ok: false, error: 'Gagal menyiram tanaman.', detail: process.env.NODE_ENV === 'production' ? undefined : error.message });
  }
});

app.post('/api/garden/harvest', requireAuth, async (req, res) => {
  try {
    const state = ensureGameState(await getStateForUser(req.user), req.user);
    ensureGarden(state);

    const plotIndex = plotIndexFrom(req.body.plotIndex ?? state.garden.activePlot);
    state.garden.activePlot = plotIndex;

    const plot = state.garden.plots[plotIndex] || null;
    if (!plot) return res.status(400).json({ ok: false, error: `Plot ${plotIndex + 1} belum ada tanaman untuk dipanen.` });

    const veggie = VEGGIE_CATALOG[plot.seed];
    if (!veggie) return res.status(400).json({ ok: false, error: 'Tanaman tidak valid.' });
    if (!plot.ready) return res.status(400).json({ ok: false, error: `Plot ${plotIndex + 1} belum siap panen.` });

    const qty = 1 + Math.floor(Math.max(1, Number(state.garden.level || 1)) / 4);
    const coinReward = 2 + Math.floor(Math.max(1, Number(state.garden.level || 1)) / 2);
    state.garden.inventory[plot.seed] = Math.max(0, Number(state.garden.inventory[plot.seed] || 0)) + qty;
    state.coins = Math.max(0, Math.floor(Number(state.coins || 0)) + coinReward);
    addGardenExp(state.garden, 8 + qty);
    state.garden.daily.harvested = Math.max(0, Math.floor(Number(state.garden.daily.harvested || 0))) + 1;
    addPetWorkerReward(state, { type: 'garden', mood: 'tenang', amount: 2 + qty, exp: 5 + qty, essence: 1, bond: 1 });

    state.garden.history.unshift({
      id: Date.now().toString(36),
      type: 'harvest',
      seed: plot.seed,
      plotIndex,
      text: `Plot ${plotIndex + 1}: panen ${qty} ${veggie.name}.`,
      createdAt: new Date().toISOString()
    });
    state.garden.history = state.garden.history.slice(0, 30);

    state.garden.plots[plotIndex] = null;
    state.garden.plot = null;

    await saveStateForUser(req.user.id, state);
    res.json({ ok: true, state, garden: gardenPublic(state.garden), message: `Kamu panen ${qty} ${veggie.name} dari Plot ${plotIndex + 1}.` });
  } catch (error) {
    console.error('Garden harvest error:', error);
    res.status(500).json({ ok: false, error: 'Gagal panen sayur.', detail: process.env.NODE_ENV === 'production' ? undefined : error.message });
  }
});

app.post('/api/garden/feed', requireAuth, async (req, res) => {
  try {
    const veggieId = String(req.body.veggie || '').trim().toLowerCase();
    const veggie = VEGGIE_CATALOG[veggieId];
    if (!veggie) return res.status(400).json({ ok: false, error: 'Sayur tidak valid.' });

    const state = ensureGameState(await getStateForUser(req.user), req.user);
    ensureGarden(state);
    const count = Math.max(0, Number(state.garden.inventory[veggieId] || 0));
    if (count <= 0) return res.status(400).json({ ok: false, error: `${veggie.name} belum ada. Tanam dan panen dulu ya.` });

    state.garden.inventory[veggieId] = count - 1;
    state.pet.hunger = clamp((state.pet.hunger || 0) + veggie.hunger, 0, 100);
    state.pet.happy = clamp((state.pet.happy || 0) + veggie.happy, 0, 100);
    state.pet.lastCareAt = new Date().toISOString();
    const reward = addPetWorkerReward(state, { type: 'care', mood: 'tenang', amount: 1, exp: veggie.exp, essence: 0, bond: 1 });
    const leveledUp = reward.leveledUp;
    state.garden.history.unshift({ id: Date.now().toString(36), type: 'feed', seed: veggieId, text: `Plong makan ${veggie.name}.`, createdAt: new Date().toISOString() });
    state.garden.history = state.garden.history.slice(0, 30);
    await saveStateForUser(req.user.id, state);
    res.json({ ok: true, state, garden: gardenPublic(state.garden), leveledUp, message: `Plong makan ${veggie.name}. Kenyangnya naik!` });
  } catch (error) {
    console.error('Garden feed error:', error);
    res.status(500).json({ ok: false, error: 'Gagal memberi makan Plong.', detail: process.env.NODE_ENV === 'production' ? undefined : error.message });
  }
});


app.post('/api/garden/claim', requireAuth, async (req, res) => {
  try {
    const state = ensureGameState(await getStateForUser(req.user), req.user);
    ensureGarden(state);

    const idle = calculateGardenIdle(state.garden);
    if (idle.coins <= 0) {
      return res.json({ ok: true, state, garden: gardenPublic(state.garden), message: 'Belum ada hasil idle yang bisa diklaim. Tunggu sebentar lagi ya.' });
    }

    state.coins = Math.max(0, Math.floor(Number(state.coins || 0)) + idle.coins);
    state.garden.lastIdleAt = new Date().toISOString();
    addGardenExp(state.garden, Math.min(30, Math.max(1, Math.floor(idle.coins / 3))));

    state.garden.history.unshift({
      id: Date.now().toString(36),
      type: 'idle_claim',
      text: `Klaim hasil kebun idle +${idle.coins} Soul Coins (${idle.minutes} menit).`,
      createdAt: new Date().toISOString()
    });
    state.garden.history = state.garden.history.slice(0, 30);

    await saveStateForUser(req.user.id, state);
    res.json({ ok: true, state, garden: gardenPublic(state.garden), message: `Kamu klaim +${idle.coins} Soul Coins dari kebun idle.` });
  } catch (error) {
    console.error('Garden claim error:', error);
    res.status(500).json({ ok: false, error: 'Gagal klaim hasil idle.', detail: process.env.NODE_ENV === 'production' ? undefined : error.message });
  }
});

app.post('/api/garden/upgrade', requireAuth, async (req, res) => {
  try {
    const state = ensureGameState(await getStateForUser(req.user), req.user);
    ensureGarden(state);

    const cost = gardenUpgradeCost(state.garden);
    if (Number(state.coins || 0) < cost) {
      return res.status(400).json({ ok: false, error: `Soul Coins belum cukup. Butuh ${cost} coins untuk upgrade kebun.` });
    }

    state.coins = Math.max(0, Math.floor(Number(state.coins || 0)) - cost);
    state.garden.level = Math.max(1, Math.floor(Number(state.garden.level || 1))) + 1;
    state.garden.exp = 0;
    state.garden.expMax = Math.max(40, Math.floor(Number(state.garden.expMax || 40) * 1.28));
    state.pet.happy = clamp((state.pet.happy || 0) + 5, 0, 100);

    state.garden.history.unshift({
      id: Date.now().toString(36),
      type: 'upgrade',
      text: `Kebun naik ke level ${state.garden.level}. Daya siram & hasil idle makin bagus.`,
      createdAt: new Date().toISOString()
    });
    state.garden.history = state.garden.history.slice(0, 30);

    await saveStateForUser(req.user.id, state);
    res.json({ ok: true, state, garden: gardenPublic(state.garden), message: `Kebun naik ke level ${state.garden.level}!` });
  } catch (error) {
    console.error('Garden upgrade error:', error);
    res.status(500).json({ ok: false, error: 'Gagal upgrade kebun.', detail: process.env.NODE_ENV === 'production' ? undefined : error.message });
  }
});


app.post('/api/garden/claim-water', requireAuth, async (req, res) => {
  try {
    const state = ensureGameState(await getStateForUser(req.user), req.user);
    ensureGarden(state);

    const cooldownMs = Number(process.env.GARDEN_WATER_CLAIM_COOLDOWN_MS || 6 * 60 * 60 * 1000);
    const now = Date.now();
    const last = state.garden.lastWaterClaimAt ? Date.parse(state.garden.lastWaterClaimAt) : 0;
    if (last && now - last < cooldownMs) {
      const waitMin = Math.ceil((cooldownMs - (now - last)) / 60000);
      return res.status(429).json({ ok: false, error: `Air gratis belum siap. Tunggu sekitar ${waitMin} menit lagi.` });
    }

    const amount = 12 + Math.floor(Math.random() * 7) + Math.floor((state.garden.level || 1) / 2);
    state.garden.waterDrops = Math.max(0, Math.floor(Number(state.garden.waterDrops || 0)) + amount);
    state.garden.lastWaterClaimAt = new Date().toISOString();
    addGardenExp(state.garden, 5);

    state.garden.history.unshift({
      id: Date.now().toString(36),
      type: 'water-claim',
      text: `Klaim air gratis +${amount} tetes.`,
      createdAt: new Date().toISOString()
    });
    state.garden.history = state.garden.history.slice(0, 30);

    await saveStateForUser(req.user.id, state);
    res.json({ ok: true, state, garden: gardenPublic(state.garden), message: `Air gratis berhasil diklaim: +${amount} tetes.` });
  } catch (error) {
    console.error('Garden claim water error:', error);
    res.status(500).json({ ok: false, error: 'Gagal klaim air gratis.' });
  }
});

app.post('/api/garden/daily-reward', requireAuth, async (req, res) => {
  try {
    const state = ensureGameState(await getStateForUser(req.user), req.user);
    ensureGarden(state);

    const d = state.garden.daily;
    if (d.claimed) return res.status(400).json({ ok: false, error: 'Hadiah misi hari ini sudah diklaim.' });

    const completed = [
      d.planted >= 1,
      d.watered >= 3,
      d.harvested >= 1
    ].filter(Boolean).length;

    if (completed < 2) {
      return res.status(400).json({ ok: false, error: 'Selesaikan minimal 2 misi dulu ya.' });
    }

    const coins = 8 + completed * 6 + Math.floor((state.garden.level || 1) / 2);
    const water = 8 + completed * 4;
    state.coins = Math.max(0, Math.floor(Number(state.coins || 0)) + coins);
    state.garden.waterDrops = Math.max(0, Math.floor(Number(state.garden.waterDrops || 0)) + water);
    d.claimed = true;
    addGardenExp(state.garden, 10 + completed * 4);

    state.garden.history.unshift({
      id: Date.now().toString(36),
      type: 'daily',
      text: `Hadiah misi harian: +${coins} coins dan +${water} air.`,
      createdAt: new Date().toISOString()
    });
    state.garden.history = state.garden.history.slice(0, 30);

    await saveStateForUser(req.user.id, state);
    res.json({ ok: true, state, garden: gardenPublic(state.garden), message: `Hadiah misi diklaim: +${coins} coins, +${water} air.` });
  } catch (error) {
    console.error('Garden daily reward error:', error);
    res.status(500).json({ ok: false, error: 'Gagal klaim hadiah misi.' });
  }
});

app.post('/api/garden/bonus', requireAuth, async (req, res) => {
  try {
    const state = ensureGameState(await getStateForUser(req.user), req.user);
    ensureGarden(state);

    const cooldownMs = Number(process.env.GARDEN_BONUS_COOLDOWN_MS || 6 * 60 * 60 * 1000);
    const now = Date.now();
    const last = state.garden.lastBonusAt ? Date.parse(state.garden.lastBonusAt) : 0;
    if (last && now - last < cooldownMs) {
      const waitMin = Math.ceil((cooldownMs - (now - last)) / 60000);
      return res.status(429).json({ ok: false, error: `Bonus kunjungan belum siap. Tunggu sekitar ${waitMin} menit lagi.` });
    }

    const level = Math.max(1, Math.floor(Number(state.garden.level || 1)));
    const bonus = 6 + Math.floor(Math.random() * 9) + Math.floor(level / 2);
    state.coins = Math.max(0, Math.floor(Number(state.coins || 0)) + bonus);
    state.garden.lastBonusAt = new Date().toISOString();
    addGardenExp(state.garden, 8);

    state.garden.history.unshift({
      id: Date.now().toString(36),
      type: 'bonus',
      text: `Bonus kunjungan kebun +${bonus} Soul Coins.`,
      createdAt: new Date().toISOString()
    });
    state.garden.history = state.garden.history.slice(0, 30);

    await saveStateForUser(req.user.id, state);
    res.json({ ok: true, state, garden: gardenPublic(state.garden), message: `Bonus kunjungan berhasil: +${bonus} Soul Coins.` });
  } catch (error) {
    console.error('Garden bonus error:', error);
    res.status(500).json({ ok: false, error: 'Gagal mengambil bonus kunjungan.', detail: process.env.NODE_ENV === 'production' ? undefined : error.message });
  }
});

app.put('/api/pet/avatar', requireAuth, async (req, res) => {
  try {
    const state = ensureGameState(await getStateForUser(req.user), req.user);
    const incoming = req.body.avatar || {};
    const allowed = {
      body: ['orange', 'teal', 'blue', 'purple', 'gold', 'pink'],
      shape: ['round', 'squishy', 'ghost'],
      eyes: ['cute', 'sleepy', 'star'],
      mouth: ['smile', 'tiny', 'open'],
      accessory: ['none', 'cap', 'headphone', 'flower', 'crown'],
      aura: ['none', 'spark', 'halo', 'bubble']
    };

    const current = state.pet.avatar || {};
    const avatar = {};
    for (const key of Object.keys(allowed)) {
      const value = String(incoming[key] || current[key] || '').trim();
      avatar[key] = allowed[key].includes(value) ? value : allowed[key][0];
    }

    if (avatar.accessory === 'crown' && !state.inventory.includes('acc_crown')) {
      avatar.accessory = current.accessory && current.accessory !== 'crown' ? current.accessory : 'none';
    }

    state.pet.avatar = avatar;
    if (avatar.accessory === 'crown') state.pet.accessory = 'crown';
    state.pet.lastCareAt = new Date().toISOString();

    await saveStateForUser(req.user.id, state);
    res.json({ ok: true, state, message: 'Avatar Plong berhasil disimpan.' });
  } catch (error) {
    console.error('Pet avatar error:', error);
    res.status(500).json({ ok: false, error: 'Gagal menyimpan avatar pet.' });
  }
});


app.get('/api/pet/worker', requireAuth, async (req, res) => {
  try {
    const state = ensureGameState(await getStateForUser(req.user), req.user);
    const passive = calculatePetPassive(state);
    res.json({
      ok: true,
      state,
      worker: {
        ...state.pet.worker,
        passive,
        power: petWorkerPower(state, getDominantMood(state.emotions)),
        dominantMood: getDominantMood(state.emotions)
      }
    });
  } catch (error) {
    console.error('Pet worker get error:', error);
    res.status(500).json({ ok: false, error: 'Gagal memuat Pet Worker.' });
  }
});

app.post('/api/pet/claim-passive', requireAuth, async (req, res) => {
  try {
    const state = ensureGameState(await getStateForUser(req.user), req.user);
    const passive = calculatePetPassive(state);
    if (passive.coins <= 0) {
      return res.json({ ok: true, state, reward: passive, message: 'Belum ada passive coins yang bisa diklaim. Tunggu minimal sekitar 10 menit.' });
    }
    state.coins = Math.max(0, Math.floor(Number(state.coins || 0)) + passive.coins);
    state.pet.worker.totalEarned = Math.max(0, Math.floor(Number(state.pet.worker.totalEarned || 0)) + passive.coins);
    state.pet.worker.lastClaimAt = new Date().toISOString();
    state.pet.energy = clamp((state.pet.energy || 70) - Math.min(15, Math.floor(passive.coins / 3)), 0, 100);
    const leveledUp = addPetExp(state, Math.min(40, Math.max(2, Math.floor(passive.coins / 2))));
    await saveStateForUser(req.user.id, state);
    res.json({ ok: true, state, reward: { ...passive, leveledUp }, message: `Plong menghasilkan +${passive.coins} Soul Coins selama kamu pergi.` });
  } catch (error) {
    console.error('Pet passive claim error:', error);
    res.status(500).json({ ok: false, error: 'Gagal klaim passive coins.' });
  }
});

app.post('/api/pet/convert-essence', requireAuth, async (req, res) => {
  try {
    const mood = String(req.body.mood || 'all').trim().toLowerCase();
    const state = ensureGameState(await getStateForUser(req.user), req.user);
    const result = convertEssenceToCoins(state, mood);
    if (result.used <= 0) {
      return res.json({ ok: true, state, reward: result, message: 'Essence masih kosong. Dapatkan dari vent/curhat dulu.' });
    }
    await saveStateForUser(req.user.id, state);
    res.json({ ok: true, state, reward: result, message: `${result.used} Essence berhasil diolah Plong jadi +${result.coins} Soul Coins.` });
  } catch (error) {
    console.error('Pet essence convert error:', error);
    res.status(500).json({ ok: false, error: 'Gagal convert essence.' });
  }
});

app.post('/api/pet/daily-bonus', requireAuth, async (req, res) => {
  try {
    const state = ensureGameState(await getStateForUser(req.user), req.user);
    ensurePetWorker(state);
    const today = state.pet.worker.today;
    if (today.bonusClaimed) {
      return res.status(400).json({ ok: false, error: 'Bonus harian Pet Worker sudah diklaim.' });
    }
    const completed = [
      today.vent >= 1,
      today.chat >= 3,
      today.garden >= 2,
      today.care >= 1
    ].filter(Boolean).length;
    if (completed < 2) {
      return res.status(400).json({ ok: false, error: 'Selesaikan minimal 2 aktivitas harian dulu.' });
    }
    const coins = 5 + completed * 4 + Math.floor((state.pet.level || 1) / 2);
    const exp = 10 + completed * 5;
    state.coins = Math.max(0, Math.floor(Number(state.coins || 0)) + coins);
    const leveledUp = addPetExp(state, exp);
    state.pet.bond = clamp((state.pet.bond || 0) + completed, 0, 100);
    today.bonusClaimed = true;
    await saveStateForUser(req.user.id, state);
    res.json({ ok: true, state, reward: { coins, exp, completed, leveledUp }, message: `Bonus harian diklaim: +${coins} coins dan +${exp} EXP.` });
  } catch (error) {
    console.error('Pet daily bonus error:', error);
    res.status(500).json({ ok: false, error: 'Gagal klaim bonus harian pet.' });
  }
});

app.post('/api/pet/action', requireAuth, async (req, res) => {
  try {
    const action = String(req.body.action || '').trim();
    const state = ensureGameState(await getStateForUser(req.user), req.user);
    let message = 'Plong merasa ditemani.';
    let reward = null;

    if (action === 'play') {
      state.pet.happy = clamp((state.pet.happy || 0) + 10, 0, 100);
      state.pet.hunger = clamp((state.pet.hunger || 0) - 4, 0, 100);
      state.pet.energy = clamp((state.pet.energy || 70) - 5, 0, 100);
      reward = addPetWorkerReward(state, { type: 'care', mood: getDominantMood(state.emotions), amount: 1, exp: 4, essence: 0, bond: 1 });
      message = 'Kamu bermain sebentar dengan Plong. Mood-nya naik.';
    } else if (action === 'calm') {
      state.pet.happy = clamp((state.pet.happy || 0) + 6, 0, 100);
      state.pet.energy = clamp((state.pet.energy || 70) + 4, 0, 100);
      reward = addPetWorkerReward(state, { type: 'care', mood: 'tenang', amount: 1, exp: 3, essence: 0, bond: 1 });
      message = 'Plong ikut tenang bareng kamu.';
    } else {
      return res.status(400).json({ ok: false, error: 'Aksi pet tidak valid.' });
    }

    state.pet.lastCareAt = new Date().toISOString();
    await saveStateForUser(req.user.id, state);
    res.json({ ok: true, state, reward, message });
  } catch (error) {
    console.error('Pet action error:', error);
    res.status(500).json({ ok: false, error: 'Gagal menjalankan aksi pet.' });
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

app.post('/api/chat', aiLimiter, requireAuth, async (req, res) => {
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

    const reply = data.message?.content || 'Aku belum bisa jawab sekarang.';
    const state = ensureGameState(await getStateForUser(req.user), req.user);
    const mood = getDominantMood(state.emotions);
    const reward = addPetWorkerReward(state, { type: 'chat', mood, amount: 1, exp: 3, essence: 0, bond: 1 });
    await saveStateForUser(req.user.id, state);
    res.json({ reply, reward, state });
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



const APP_VIEWS = {
  '/': 'home',
  '/home': 'home',
  '/index.html': 'home',

  '/garden': 'garden',
  '/garden.html': 'garden',

  '/avatar': 'avatar',
  '/avatar.html': 'avatar',

  '/vent': 'vent',
  '/vent.html': 'vent',

  '/art': 'art',
  '/art.html': 'art',

  '/redeem': 'redeem',
  '/redeem.html': 'redeem',

  '/assist': 'assist',
  '/assist.html': 'assist',
  '/chat': 'assist',

  '/account': 'account',
  '/account.html': 'account'
};

Object.entries(APP_VIEWS).forEach(([route, view]) => {
  app.get(route, (req, res) => {
    res.render(view);
  });
});

app.get(['/login', '/login.html'], (req, res) => {
  res.render('login');
});

app.get(['/register', '/register.html'], (req, res) => {
  res.render('register');
});

app.use((req, res) => {
  res.status(404).render('home');
});


app.use((error, req, res, next) => {
  if (error && error.message === 'CORS blocked') {
    return res.status(403).json({ ok: false, error: 'Origin tidak diizinkan.' });
  }

  if (error && error.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, error: 'Ukuran request terlalu besar.' });
  }

  return next(error);
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
