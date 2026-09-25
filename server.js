const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'nemoz321';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'nemobase-secret-key-12345',
    resave: false,
    saveUninitialized: true
}));

const isProduction = process.env.DATABASE_URL ? true : false;
let dbPg, dbSqlite;

if (isProduction) {
    dbPg = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    dbPg.query(`
        CREATE TABLE IF NOT EXISTS visitor_logs (
            id SERIAL PRIMARY KEY,
            ip TEXT,
            region TEXT,
            custom_name TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
} else {
    dbSqlite = new sqlite3.Database('./database.db');
    dbSqlite.run(`
        CREATE TABLE IF NOT EXISTS visitor_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip TEXT,
            region TEXT,
            custom_name TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
}

function getClientIp(req) {
    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    if (ip.includes(',')) ip = ip.split(',')[0];
    if (ip.startsWith('::ffff:')) ip = ip.replace('::ffff:', '');
    if (ip === '::1' || ip === '127.0.0.1') ip = '95.137.233.1';
    return ip.trim();
}

app.get('/', async (req, res) => {
    const ip = getClientIp(req);
    let region = 'უცნობი რეგიონი';

    try {
        const response = await axios.get(`http://ip-api.com/json/${ip}`);
        if (response.data && response.data.status === 'success') {
            region = `${response.data.country}, ${response.data.city}`;
        }
    } catch (e) {}

    if (isProduction) {
        await dbPg.query('INSERT INTO visitor_logs (ip, region) VALUES ($1, $2)', [ip, region]);
    } else {
        dbSqlite.run('INSERT INTO visitor_logs (ip, region) VALUES (?, ?)', [ip, region]);
    }

    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.get('/api/my-info', async (req, res) => {
    const ip = getClientIp(req);
    let region = 'უცნობი რეგიონი';
    try {
        const response = await axios.get(`http://ip-api.com/json/${ip}`);
        if (response.data && response.data.status === 'success') {
            region = `${response.data.country}, ${response.data.city}`;
        }
    } catch (e) {}
    res.json({ ip, region });
});

app.post('/api/admin/login', (req, res) => {
    if (req.body.password === ADMIN_PASSWORD) {
        req.session.isAdmin = true;
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'არასწორი პაროლი' });
    }
});

app.get('/api/admin/check', (req, res) => res.json({ authenticated: !!req.session.isAdmin }));
app.post('/api/admin/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

function requireAdmin(req, res, next) {
    if (req.session.isAdmin) next();
    else res.status(403).json({ error: 'წვდომა უარყოფილია' });
}

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin.html')));

app.get('/api/admin/logs', requireAdmin, async (req, res) => {
    if (isProduction) {
        const { rows } = await dbPg.query('SELECT * FROM visitor_logs ORDER BY id DESC');
        res.json(rows);
    } else {
        dbSqlite.all('SELECT * FROM visitor_logs ORDER BY id DESC', [], (err, rows) => res.json(rows));
    }
});

app.post('/api/admin/update-name', requireAdmin, async (req, res) => {
    const { id, custom_name } = req.body;
    if (isProduction) {
        await dbPg.query('UPDATE visitor_logs SET custom_name = $1 WHERE id = $2', [custom_name, id]);
        res.json({ success: true });
    } else {
        dbSqlite.run('UPDATE visitor_logs SET custom_name = ? WHERE id = ?', [custom_name, id], () => res.json({ success: true }));
    }
});

app.delete('/api/admin/delete/:id', requireAdmin, async (req, res) => {
    const id = req.params.id;
    if (isProduction) {
        await dbPg.query('DELETE FROM visitor_logs WHERE id = $1', [id]);
        res.json({ success: true });
    } else {
        dbSqlite.run('DELETE FROM visitor_logs WHERE id = ?', [id], () => res.json({ success: true }));
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
