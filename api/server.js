const express = require('express');
const os = require('os');
const { Pool } = require('pg');
const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse JSON requests
app.use(express.json());

// Connect to PostgreSQL using environment variables injected by docker-compose
const pool = new Pool({
    host: process.env.DB_HOST || 'db',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'appuser',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'tasksdb',
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function initDb() {
    for (let attempt = 1; attempt <= 15; attempt++) {
        try {
            await pool.query('SELECT 1');
            console.log('[DB] Connected to PostgreSQL successfully');
            break;
        } catch (err) {
            console.log(`[DB] Waiting for Postgres (attempt ${attempt}/15):${err.message}`);
            if (attempt === 15) throw err;
            await sleep(2000);
        }
    }
    await pool.query(`
        CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);
}

// 1. Healthcheck endpoint (used by Docker HEALTHCHECK and Nginx)
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.status(200).json({ status: 'ok', container: os.hostname() });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// 2. POST /api/tasks - Create a new task
app.post('/api/tasks', async (req, res) => {
    try {
        const { title } = req.body;
        if (!title || typeof title !== 'string' || !title.trim()) {
            return res.status(400).json({ error: 'Title is required' });
        }
        const result = await pool.query(
            'INSERT INTO tasks (title) VALUES ($1) RETURNING id, title, created_at',
            [title.trim()]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Failed to create task', message: err.message });
    }
});

// 3. GET /api/tasks - List all tasks
app.get('/api/tasks', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, title, created_at FROM tasks ORDER BY id ASC');
        res.status(200).json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve tasks', message: err.message });
    }
});

// Start the server
app.listen(port, async () => {
    console.log(`Server is running on http://localhost:${port}`);
    try {
        await initDb();
    } catch (err) {
        console.error('[DB] Failed to initialize DB:', err);
    }
});