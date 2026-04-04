const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const SALT_ROUNDS = 12;

const app = express();
const server = http.createServer(app);

// Optimized Socket.IO config for low-latency gaming
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket'],      // Force WebSocket only
    upgrade: false,                 // Skip upgrade from polling
    pingInterval: 10000,           // Ping every 10s
    pingTimeout: 5000,             // 5s timeout
    perMessageDeflate: false,      // Disable compression (faster)
    httpCompression: false
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.static(path.join(__dirname)));
app.use(express.json());

// ===================== USER STORE =====================
const USERS_FILE = path.join(__dirname, 'users.json');
const BANNED_NAMES = ['admin','mod','moderator','system','server','root','staff','dev','developer','null','undefined','console','support','help','official','shatter','arena','bot','robot','announce','everyone','all','modbot','adminbot'];

// ===================== PROFANITY FILTER =====================
const PROFANITY_BLACKLIST = [
    // Racial slurs
    'nigger', 'nigga',
    // F-bomb
    'fuck', 'fucking', 'fucker', 'fucked', 'fucks', 'fuckyou',
    // Mother
    'motherfucker', 'motherfucking',
    // Other common profanity
    'bitch', 'bitches', 'bitching',
    'asshole', 'ashole',
    'shit', 'shitty',
    'dick', 'dickhead',
    'cock', 'cocksucker',
    'pussy',
    'whore',
    'slut',
    'cunt',
    'fag', 'faggot',
    'retard', 'retarded',
    'kys',
    'rape',
    'nazi',
    'pedo', 'pedophile'
];

// Leetspeak mappings for bypass detection
const LEETSPEAK_MAP = { '1':'i', '3':'e', '4':'a', '5':'s', '7':'t', '0':'o', '@':'a', '$':'s', '!':'i' };

// Normalize text: remove special chars and convert leetspeak
function normalizeText(text) {
    let normalized = text.toLowerCase();
    // Remove all non-alphanumeric except we'll handle leetspeak first
    normalized = normalized.replace(/[^a-z0-9]/g, '');
    // Convert leetspeak numbers to letters
    normalized = normalized.replace(/[134570@$!]/g, c => LEETSPEAK_MAP[c] || c);
    return normalized;
}

// Function to check if message contains blacklisted words
function containsProfanity(message) {
    const lowerMsg = message.toLowerCase();
    const normalizedMsg = normalizeText(message);

    for (const word of PROFANITY_BLACKLIST) {
        // Check direct match
        if (lowerMsg.includes(word)) return true;
        // Check normalized version (catches f*u*c*k, f4ck, etc.)
        if (normalizedMsg.includes(word)) return true;
    }
    return false;
}

// Escape special regex characters
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Function to censor profanity (replaces with ***)
function censorProfanity(message) {
    let censored = message;
    for (const word of PROFANITY_BLACKLIST) {
        const escaped = escapeRegex(word);
        const regex = new RegExp(escaped, 'gi');
        censored = censored.replace(regex, '*'.repeat(word.length));
    }
    return censored;
}

const RANKS = [
    {min:1,name:'Unranked'},{min:4,name:'Bronze'},{min:7,name:'Silver'},
    {min:11,name:'Gold'},{min:16,name:'Platinum'},{min:21,name:'Diamond'},
    {min:26,name:'Master'},{min:31,name:'Grandmaster'}
];

// Password hashing functions
async function hashPassword(password) {
    return await bcrypt.hash(password, SALT_ROUNDS);
}

async function verifyPassword(password, hash) {
    return await bcrypt.compare(password, hash);
}

// Migrate old weak hashes to bcrypt
async function migratePassword(user, password, users) {
    if (user.pass && !user.pass.startsWith('$2b$')) {
        // Old weak hash detected, migrate to bcrypt
        const newHash = await hashPassword(password);
        user.pass = newHash;
        users[user.user] = user;
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
        return true;
    }
    return false;
}

const UsersStore = {
    _lock: false,
    _queue: [],

    load() {
        try {
            return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        } catch(e) {
            this.save({});
            return {};
        }
    },

    save(data) {
        fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
    },

    find(username) {
        const users = this.load();
        if (users[username]) return users[username];
        // Case-insensitive fallback
        const lower = username.toLowerCase();
        for (const key of Object.keys(users)) {
            if (key.toLowerCase() === lower) return users[key];
        }
        return null;
    },

    async create(username, password, securityQuestion = null, securityAnswer = null) {
        const users = this.load();
        const hashedPassword = await hashPassword(password);
        const hashedAnswer = securityAnswer ? await hashPassword(securityAnswer.toLowerCase().trim()) : null;
        users[username] = {
            user: username,
            pass: hashedPassword,
            xp: 0,
            level: 1,
            stats: {wins:0,losses:0,kills:0,matches:0,shatters:0,maxCombo:0,tilesDestroyed:0},
            banned: false,
            banReason: '',
            createdAt: Date.now(),
            lastLogin: Date.now(),
            isAdmin: username === 'Owner',
            role: username === 'Owner' ? 'Owner' : 'Member',
            emeralds: 0,
            cosmetics: { skin: 'default', trail: 'default', aura: 'none' },
            ownedCosmetics: ['default'],
            securityQuestion: securityQuestion,
            securityAnswer: hashedAnswer
        };
        this.save(users);
        return users[username];
    },

    update(username, fields) {
        const users = this.load();
        if (!users[username]) return false;
        Object.assign(users[username], fields);
        this.save(users);
        return users[username];
    },

    remove(username) {
        const users = this.load();
        delete users[username];
        this.save(users);
    },

    all() {
        const users = this.load();
        return Object.values(users);
    },

    rename(oldName, newName) {
        const users = this.load();
        if (!users[oldName] || users[newName]) return false;
        users[newName] = { ...users[oldName], user: newName };
        if (users[newName].isAdmin && oldName === 'Owner') users[newName].isAdmin = false;
        delete users[oldName];
        this.save(users);
        return users[newName];
    }
};

// ===================== SESSIONS =====================
const sessions = {}; // token -> { username, createdAt }

function createSession(username) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions[token] = { username, createdAt: Date.now() };
    return token;
}

function getSessionUser(token) {
    const session = sessions[token];
    if (!session) return null;
    const user = UsersStore.find(session.username);
    if (!user) { delete sessions[token]; return null; }
    return { ...user, token };
}

function isAdmin(token) {
    const user = getSessionUser(token);
    return user && user.isAdmin === true;
}

function isBannedName(name) {
    const lower = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (BANNED_NAMES.includes(lower)) return true;
    for (let bn of BANNED_NAMES) { if (lower.startsWith(bn)) return true; }
    if (lower.length < 3) return true;
    if (/^(admin|mod|system|staff)/i.test(name)) return true;
    return false;
}

// ===================== AUTH ENDPOINTS =====================
// Security questions list
const SECURITY_QUESTIONS = [
    'What is your favorite game?',
    'What is the name of your first pet?',
    'What city were you born in?',
    'What is your favorite color?',
    'What is your favorite food?',
    'What was the name of your first school?',
    'What is your favorite movie?',
    'What is your dream job?'
];

app.get('/api/security-questions', (req, res) => {
    res.json({ questions: SECURITY_QUESTIONS });
});

app.post('/api/register', async (req, res) => {
    const { username, password, securityQuestion, securityAnswer } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
    if (username.length < 3) return res.status(400).json({ error: 'Username must be 3+ characters' });
    if (username.length > 16) return res.status(400).json({ error: 'Username too long' });
    if (password.length < 4) return res.status(400).json({ error: 'Password must be 4+ characters' });
    if (!/^[a-zA-Z0-9_.]+$/.test(username)) return res.status(400).json({ error: 'Username can only contain letters, numbers, _ and .' });
    if (!securityQuestion || !securityAnswer) return res.status(400).json({ error: 'Security question and answer required' });
    if (securityQuestion.length < 5) return res.status(400).json({ error: 'Security question must be 5+ characters' });
    if (securityAnswer.length < 2) return res.status(400).json({ error: 'Security answer must be 2+ characters' });

    // "Owner" is only allowed if it doesn't already exist
    if (username.toLowerCase() === 'owner') {
        const existing = UsersStore.find('Owner');
        if (existing) return res.status(403).json({ error: 'Owner account already exists' });
        // Create Owner account
        const user = await UsersStore.create('Owner', password, securityQuestion, securityAnswer);
        const token = createSession('Owner');
        const rank = getRankForLevel(user.level);
        return res.json({
            success: true, token,
            user: { user: user.user, level: user.level, xp: user.xp, stats: user.stats, rank, isAdmin: user.isAdmin, role: user.role || 'Member', emeralds: user.emeralds || 0, cosmetics: user.cosmetics || {skin:'default',trail:'default',aura:'none'}, ownedCosmetics: user.ownedCosmetics || ['default'] }
        });
    } else {
        if (isBannedName(username)) return res.status(400).json({ error: 'This username is not allowed' });
    }

    const existing = UsersStore.find(username);
    if (existing) return res.status(409).json({ error: 'Username already taken' });

    const user = await UsersStore.create(username, password, securityQuestion, securityAnswer);
    const token = createSession(username);
    const rank = getRankForLevel(user.level);
    res.json({
        success: true,
        token,
        user: { user: user.user, level: user.level, xp: user.xp, stats: user.stats, rank, isAdmin: user.isAdmin, role: user.role || 'Member', emeralds: user.emeralds || 0, cosmetics: user.cosmetics || {skin:'default',trail:'default',aura:'none'}, ownedCosmetics: user.ownedCosmetics || ['default'] }
    });
});

// Get security question for a user (for password reset)
app.post('/api/get-security-question', (req, res) => {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username required' });

    const user = UsersStore.find(username);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.securityQuestion) return res.status(400).json({ error: 'No security question set for this account' });

    res.json({ success: true, question: user.securityQuestion });
});

// Reset password with security answer
app.post('/api/reset-password', async (req, res) => {
    const { username, securityAnswer, newPassword } = req.body;
    if (!username || !securityAnswer || !newPassword) {
        return res.status(400).json({ error: 'All fields required' });
    }
    if (newPassword.length < 4) return res.status(400).json({ error: 'Password must be 4+ characters' });

    const user = UsersStore.find(username);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.securityAnswer) return res.status(400).json({ error: 'No security question set for this account' });

    // Verify security answer (case-insensitive, trimmed)
    const validAnswer = await verifyPassword(securityAnswer.toLowerCase().trim(), user.securityAnswer);
    if (!validAnswer) {
        return res.status(401).json({ error: 'Incorrect security answer' });
    }

    // Update password
    const newHash = await hashPassword(newPassword);
    UsersStore.update(username, { pass: newHash });

    res.json({ success: true, message: 'Password reset successfully' });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

    const user = UsersStore.find(username);
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (user.banned) return res.status(403).json({ error: 'Account is banned: ' + (user.banReason || 'No reason given') });

    // Check if password is correct
    const validPassword = await verifyPassword(password, user.pass);
    if (!validPassword) return res.status(401).json({ error: 'Wrong password' });

    UsersStore.update(username, { lastLogin: Date.now() });
    const token = createSession(username);
    const rank = getRankForLevel(user.level);
    res.json({
        success: true,
        token,
        user: { user: user.user, level: user.level, xp: user.xp, stats: user.stats, rank, isAdmin: user.isAdmin, role: user.role || 'Member', emeralds: user.emeralds || 0, cosmetics: user.cosmetics || {skin:'default',trail:'default',aura:'none'}, ownedCosmetics: user.ownedCosmetics || ['default'] }
    });
});

// Check if username exists (for registration)
app.post('/api/check-username', (req, res) => {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username required' });
    const user = UsersStore.find(username);
    res.json({ exists: !!user });
});

// Login with security question (for forgotten password)
app.post('/api/login-security', async (req, res) => {
    const { username, securityAnswer } = req.body;
    if (!username || !securityAnswer) return res.status(400).json({ error: 'Missing fields' });

    const user = UsersStore.find(username);
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (user.banned) return res.status(403).json({ error: 'Account is banned: ' + (user.banReason || 'No reason given') });
    if (!user.securityAnswer) return res.status(400).json({ error: 'No security question set for this account' });

    // Verify security answer
    const validAnswer = await verifyPassword(securityAnswer.toLowerCase().trim(), user.securityAnswer);
    if (!validAnswer) return res.status(401).json({ error: 'Incorrect security answer' });

    UsersStore.update(username, { lastLogin: Date.now() });
    const token = createSession(username);
    const rank = getRankForLevel(user.level);
    res.json({
        success: true,
        token,
        user: { user: user.user, level: user.level, xp: user.xp, stats: user.stats, rank, isAdmin: user.isAdmin, role: user.role || 'Member', emeralds: user.emeralds || 0, cosmetics: user.cosmetics || {skin:'default',trail:'default',aura:'none'}, ownedCosmetics: user.ownedCosmetics || ['default'] }
    });
});

// Verify security answer and get temp token (for password reset flow)
app.post('/api/verify-security-answer', async (req, res) => {
    const { username, securityAnswer } = req.body;
    if (!username || !securityAnswer) return res.status(400).json({ error: 'Missing fields' });

    const user = UsersStore.find(username);
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (user.banned) return res.status(403).json({ error: 'Account is banned' });
    if (!user.securityAnswer) return res.status(400).json({ error: 'No security question set' });

    const validAnswer = await verifyPassword(securityAnswer.toLowerCase().trim(), user.securityAnswer);
    if (!validAnswer) return res.status(401).json({ error: 'Incorrect answer' });

    // Create a temp token that allows password reset
    const tempToken = createSession(username);
    res.json({ success: true, tempToken });
});

// Reset password using temp token from security verification
app.post('/api/reset-password-with-token', async (req, res) => {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: 'Missing fields' });
    if (newPassword.length < 4) return res.status(400).json({ error: 'Password must be 4+ characters' });

    const session = sessions[token];
    if (!session) return res.status(401).json({ error: 'Invalid or expired token' });

    const username = session.username;
    const newHash = await hashPassword(newPassword);
    UsersStore.update(username, { pass: newHash });

    res.json({ success: true, token });
});

app.post('/api/session', (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(401).json({ error: 'No token' });
    const user = getSessionUser(token);
    if (!user) return res.status(401).json({ error: 'Invalid session' });
    const rank = getRankForLevel(user.level);
    res.json({
        success: true,
        user: { user: user.user, level: user.level, xp: user.xp, stats: user.stats, rank, isAdmin: user.isAdmin, role: user.role || 'Member', emeralds: user.emeralds || 0, cosmetics: user.cosmetics || {skin:'default',trail:'default',aura:'none'}, ownedCosmetics: user.ownedCosmetics || ['default'] }
    });
});

app.post('/api/logout', (req, res) => {
    const { token } = req.body;
    if (token) delete sessions[token];
    res.json({ success: true });
});

app.post('/api/change-password', async (req, res) => {
    const { token, oldPassword, newPassword } = req.body;
    const user = getSessionUser(token);
    if (!user) return res.status(401).json({ error: 'Invalid session' });

    // Verify old password
    const validPassword = await verifyPassword(oldPassword, user.pass);
    if (!validPassword) return res.status(400).json({ error: 'Wrong current password' });

    if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'New password must be 4+ characters' });

    const newHash = await hashPassword(newPassword);
    UsersStore.update(user.user, { pass: newHash });
    res.json({ success: true });
});

app.post('/api/delete-account', (req, res) => {
    const { token } = req.body;
    const user = getSessionUser(token);
    if (!user) return res.status(401).json({ error: 'Invalid session' });
    if (user.isAdmin) return res.status(403).json({ error: 'Cannot delete admin account' });
    UsersStore.remove(user.user);
    delete sessions[token];
    res.json({ success: true });
});

app.post('/api/save-user', (req, res) => {
    const { token, userData } = req.body;
    const user = getSessionUser(token);
    if (!user) return res.status(401).json({ error: 'Invalid session' });
    if (userData.user !== user.user) return res.status(403).json({ error: 'User mismatch' });
    UsersStore.update(user.user, {
        xp: userData.xp,
        level: userData.level,
        stats: userData.stats
    });
    res.json({ success: true });
});

// ===================== PUBLIC PROFILE =====================
app.get('/api/profile/:username', (req, res) => {
    const user = UsersStore.find(req.params.username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const rank = getRankForLevel(user.level);
    res.json({
        user: user.user,
        level: user.level,
        xp: user.xp,
        rank,
        role: user.role || 'Member',
        stats: user.stats,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin,
        online: !!playerByName[user.user],
        muted: isUserMuted(user.user)
    });
});

// ===================== ADMIN ENDPOINTS =====================
app.get('/api/admin/users', (req, res) => {
    const token = req.headers['authorization'];
    if (!isAdmin(token)) return res.status(403).json({ error: 'Forbidden' });

    const search = (req.query.search || '').toLowerCase();
    const rankFilter = req.query.rank || '';
    const sortBy = req.query.sortBy || 'username';
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    let users = UsersStore.all();

    // Search
    if (search) {
        users = users.filter(u => u.user.toLowerCase().includes(search));
    }

    // Rank filter
    if (rankFilter) {
        const rank = RANKS.find(r => r.name.toLowerCase() === rankFilter.toLowerCase());
        if (rank) {
            const nextRank = RANKS[RANKS.indexOf(rank) + 1];
            users = users.filter(u => u.level >= rank.min && (!nextRank || u.level < nextRank.min));
        }
    }

    // Sort
    users.sort((a, b) => {
        if (sortBy === 'level') return b.level - a.level;
        if (sortBy === 'wins') return (b.stats.wins || 0) - (a.stats.wins || 0);
        if (sortBy === 'lastLogin') return (b.lastLogin || 0) - (a.lastLogin || 0);
        return a.user.localeCompare(b.user);
    });

    const total = users.length;
    const totalPages = Math.ceil(total / limit);
    const paged = users.slice((page - 1) * limit, page * limit);

    res.json({
        users: paged.map(u => ({
            user: u.user, level: u.level, xp: u.xp, stats: u.stats,
            banned: u.banned, banReason: u.banReason, createdAt: u.createdAt,
            lastLogin: u.lastLogin, isAdmin: u.isAdmin,
            role: u.role || 'Member',
            muted: isUserMuted(u.user),
            muteRemaining: getMuteRemaining(u.user),
            online: !!playerByName[u.user]
        })),
        total, page, totalPages
    });
});

app.get('/api/admin/users/:username', (req, res) => {
    const token = req.headers['authorization'];
    if (!isAdmin(token)) return res.status(403).json({ error: 'Forbidden' });

    const user = UsersStore.find(req.params.username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
        ...user,
        online: !!playerByName[user.user],
        rank: getRankForLevel(user.level)
    });
});

app.post('/api/admin/ban', (req, res) => {
    const { token, username, reason } = req.body;
    if (!isAdmin(token)) return res.status(403).json({ error: 'Forbidden' });
    if (username === 'Owner') return res.status(403).json({ error: 'Cannot ban Owner' });

    const user = UsersStore.find(username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    UsersStore.update(username, { banned: true, banReason: reason || '' });

    // Kick if online
    const socketId = playerByName[username];
    if (socketId) {
        const sock = io.sockets.sockets.get(socketId);
        if (sock) {
            sock.emit('banned', { reason: reason || 'No reason given' });
            setTimeout(() => sock.disconnect(true), 500);
        }
    }

    res.json({ success: true });
});

app.post('/api/admin/unban', (req, res) => {
    const { token, username } = req.body;
    if (!isAdmin(token)) return res.status(403).json({ error: 'Forbidden' });

    const user = UsersStore.find(username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    UsersStore.update(username, { banned: false, banReason: '' });
    res.json({ success: true });
});

app.post('/api/admin/kick', (req, res) => {
    const { token, username } = req.body;
    if (!isAdmin(token)) return res.status(403).json({ error: 'Forbidden' });
    if (username === 'Owner') return res.status(403).json({ error: 'Cannot kick Owner' });

    const socketId = playerByName[username];
    if (!socketId) return res.status(404).json({ error: 'User not online' });

    const sock = io.sockets.sockets.get(socketId);
    if (sock) {
        sock.emit('kicked', { reason: 'Kicked by admin' });
        setTimeout(() => sock.disconnect(true), 500);
    }

    res.json({ success: true });
});

app.post('/api/admin/rename', (req, res) => {
    const { token, oldUsername, newUsername } = req.body;
    if (!isAdmin(token)) return res.status(403).json({ error: 'Forbidden' });
    if (!oldUsername || !newUsername) return res.status(400).json({ error: 'Missing fields' });
    if (newUsername.length < 2) return res.status(400).json({ error: 'New name too short' });
    if (isBannedName(newUsername) && newUsername !== 'Owner') return res.status(400).json({ error: 'Invalid username' });

    const existing = UsersStore.find(newUsername);
    if (existing) return res.status(409).json({ error: 'Username already taken' });

    // Update sessions
    for (const [t, s] of Object.entries(sessions)) {
        if (s.username === oldUsername) s.username = newUsername;
    }

    const updated = UsersStore.rename(oldUsername, newUsername);
    if (!updated) return res.status(404).json({ error: 'User not found' });

    // Notify if online
    const socketId = playerByName[oldUsername];
    if (socketId) {
        delete playerByName[oldUsername];
        playerByName[newUsername] = socketId;
        const sock = io.sockets.sockets.get(socketId);
        if (sock) {
            sock.username = newUsername;
            sock.emit('renamed', { newUsername });
        }
    }

    res.json({ success: true, newUsername });
});

app.post('/api/admin/reset-stats', (req, res) => {
    const { token, username } = req.body;
    if (!isAdmin(token)) return res.status(403).json({ error: 'Forbidden' });
    if (username === 'Owner') return res.status(403).json({ error: 'Cannot reset Owner stats' });

    const user = UsersStore.find(username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    UsersStore.update(username, {
        xp: 0, level: 1,
        stats: {wins:0,losses:0,kills:0,matches:0,shatters:0,maxCombo:0,tilesDestroyed:0}
    });
    res.json({ success: true });
});

app.post('/api/admin/delete-user', (req, res) => {
    const { token, username } = req.body;
    if (!isAdmin(token)) return res.status(403).json({ error: 'Forbidden' });
    if (username === 'Owner') return res.status(403).json({ error: 'Cannot delete Owner' });

    const user = UsersStore.find(username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Kick if online
    const socketId = playerByName[username];
    if (socketId) {
        const sock = io.sockets.sockets.get(socketId);
        if (sock) {
            sock.emit('accountDeleted');
            setTimeout(() => sock.disconnect(true), 500);
        }
    }

    // Remove sessions
    for (const [t, s] of Object.entries(sessions)) {
        if (s.username === username) delete sessions[t];
    }

    UsersStore.remove(username);
    res.json({ success: true });
});

app.post('/api/admin/set-role', (req, res) => {
    const { token, username, role } = req.body;
    if (!isAdmin(token)) return res.status(403).json({ error: 'Forbidden' });
    if (username === 'Owner') return res.status(403).json({ error: 'Cannot change Owner role' });
    const validRoles = ['Member', 'Helper', 'Staff', 'Admin'];
    if (!validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });

    const user = UsersStore.find(username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    UsersStore.update(username, { role, isAdmin: role === 'Admin' });

    // Notify if online
    const socketId = playerByName[username];
    if (socketId) {
        const sock = io.sockets.sockets.get(socketId);
        if (sock) sock.emit('roleChanged', { role });
    }

    res.json({ success: true });
});

// ===================== MUTE SYSTEM =====================
const mutedUsers = {}; // username -> { expires: timestamp or null (permanent) }

function isUserMuted(username) {
    const mute = mutedUsers[username];
    if (!mute) return false;
    if (mute.expires && Date.now() > mute.expires) {
        delete mutedUsers[username];
        return false;
    }
    return true;
}

function getMuteRemaining(username) {
    const mute = mutedUsers[username];
    if (!mute) return 0;
    if (!mute.expires) return -1; // permanent
    return Math.max(0, mute.expires - Date.now());
}

app.post('/api/admin/mute', (req, res) => {
    const { token, username, duration } = req.body;
    if (!isAdmin(token)) return res.status(403).json({ error: 'Forbidden' });
    if (username === 'Owner') return res.status(403).json({ error: 'Cannot mute Owner' });

    const user = UsersStore.find(username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // duration in minutes, 0 = permanent
    const ms = duration === 0 ? null : duration * 60 * 1000;
    mutedUsers[username] = {
        expires: ms ? Date.now() + ms : null,
        duration: duration,
        reason: `Muted for ${duration === 0 ? 'permanent' : duration + 'm'}`,
        by: getSessionUser(token)?.user || 'Admin'
    };

    res.json({ success: true });
});

app.post('/api/admin/unmute', (req, res) => {
    const { token, username } = req.body;
    if (!isAdmin(token)) return res.status(403).json({ error: 'Forbidden' });

    delete mutedUsers[username];
    res.json({ success: true });
});

app.get('/api/admin/mutes', (req, res) => {
    const token = req.headers['authorization'];
    if (!isAdmin(token)) return res.status(403).json({ error: 'Forbidden' });

    const mutes = [];
    for (const [username, mute] of Object.entries(mutedUsers)) {
        if (mute.expires && Date.now() > mute.expires) {
            delete mutedUsers[username];
            continue;
        }
        mutes.push({
            username,
            remaining: mute.expires ? Math.max(0, mute.expires - Date.now()) : -1,
            duration: mute.duration,
            by: mute.by
        });
    }
    res.json({ mutes });
});

// ===================== SHOP =====================
const COSMETICS = {
    // Basic Skins (color changes only)
    skin_default: { type:'skin', name:'Default', price:0 },
    skin_ice: { type:'skin', name:'Ice', price:50, color:'#00d4ff' },
    skin_fire: { type:'skin', name:'Fire', price:50, color:'#ff4400' },
    skin_toxic: { type:'skin', name:'Toxic', price:50, color:'#00ff44' },
    skin_gold: { type:'skin', name:'Gold', price:100, color:'#ffd700' },

    // CHARACTER SKINS (unique appearances) - MIN 1000 EMERALDS
    char_shadow: { type:'character', name:'Shadow', price:1200, color:'#1a0033', charType:'shadow',
        desc:'A dark assassin from the void. Sleek and deadly.' },
    char_flame: { type:'character', name:'Flame', price:1200, color:'#ff3300', charType:'flame',
        desc:'Born from eternal fire. Flames dance around this warrior.' },
    char_frost: { type:'character', name:'Frost', price:1200, color:'#00ccff', charType:'frost',
        desc:'An ice mage from the frozen peaks. Cold and calculated.' },
    char_venom: { type:'character', name:'Venom', price:1500, color:'#00ff66', charType:'venom',
        desc:'Toxic and deadly. Leaves poison in its wake.' },
    char_volt: { type:'character', name:'Volt', price:1500, color:'#ffee00', charType:'volt',
        desc:'Pure lightning energy. Fast and electrifying.' },
    char_phantom: { type:'character', name:'Phantom', price:1800, color:'#aa88ff', charType:'phantom',
        desc:'A ghost from another realm. Ethereal and mysterious.' },
    char_titan: { type:'character', name:'Titan', price:2000, color:'#8899aa', charType:'titan',
        desc:'A heavily armored behemoth. Unstoppable force.' },
    char_spectre: { type:'character', name:'Spectre', price:2200, color:'#ff88ff', charType:'spectre',
        desc:'A wisp of pure energy. Floats between dimensions.' },
    char_inferno: { type:'character', name:'Inferno', price:2800, color:'#ff0044', charType:'inferno',
        desc:'A demon lord from the underworld. Horns and hellfire.' },
    char_celestial: { type:'character', name:'Celestial', price:3500, color:'#ffffff', charType:'celestial',
        desc:'A divine being of pure light. The ultimate form.' },

    // Trails
    trail_default: { type:'trail', name:'Default', price:0 },
    trail_spark: { type:'trail', name:'Spark', price:40, color:'#ffaa00' },
    trail_ice: { type:'trail', name:'Ice Trail', price:60, color:'#00d4ff' },
    trail_fire: { type:'trail', name:'Fire Trail', price:60, color:'#ff4400' },
    trail_rainbow: { type:'trail', name:'Rainbow', price:100 },
    trail_void: { type:'trail', name:'Void Trail', price:120, color:'#8800ff' },

    // Auras
    aura_none: { type:'aura', name:'None', price:0 },
    aura_glow: { type:'aura', name:'Glow', price:80, color:'#00f3ff' },
    aura_flame: { type:'aura', name:'Flame', price:100, color:'#ff6600' },
    aura_emerald: { type:'aura', name:'Emerald', price:150, color:'#00ff88' },
    aura_dark: { type:'aura', name:'Dark', price:120, color:'#440066' },
    aura_crown: { type:'aura', name:'Crown', price:200, color:'#ffd700' },
};

const REVIVE_COST = 500;

app.get('/api/shop', (req, res) => {
    res.json({ cosmetics: COSMETICS, reviveCost: REVIVE_COST });
});

app.post('/api/shop/buy', (req, res) => {
    const { token, itemId } = req.body;
    const user = getSessionUser(token);
    if (!user) return res.status(401).json({ error: 'Invalid session' });

    const item = COSMETICS[itemId];
    if (!item) return res.status(400).json({ error: 'Item not found' });

    const owned = user.ownedCosmetics || ['default'];
    if (owned.includes(itemId)) return res.status(400).json({ error: 'Already owned' });

    if ((user.emeralds || 0) < item.price) return res.status(400).json({ error: 'Not enough Emeralds' });

    UsersStore.update(user.user, {
        emeralds: (user.emeralds || 0) - item.price,
        ownedCosmetics: [...owned, itemId]
    });

    res.json({ success: true, emeralds: (user.emeralds || 0) - item.price });
});

app.post('/api/shop/equip', (req, res) => {
    const { token, type, itemId } = req.body;
    const user = getSessionUser(token);
    if (!user) return res.status(401).json({ error: 'Invalid session' });

    const owned = user.ownedCosmetics || ['default'];
    if (!owned.includes(itemId) && itemId !== 'none') return res.status(400).json({ error: 'Not owned' });

    const cosmetics = user.cosmetics || { skin:'default', trail:'default', aura:'none' };
    cosmetics[type] = itemId;

    UsersStore.update(user.user, { cosmetics });

    res.json({ success: true, cosmetics });
});

app.post('/api/revive', (req, res) => {
    const { token } = req.body;
    const user = getSessionUser(token);
    if (!user) return res.status(401).json({ error: 'Invalid session' });

    if ((user.emeralds || 0) < REVIVE_COST) return res.status(400).json({ error: 'Not enough Emeralds' });

    UsersStore.update(user.user, { emeralds: (user.emeralds || 0) - REVIVE_COST });
    res.json({ success: true, emeralds: (user.emeralds || 0) - REVIVE_COST });
});

// ===================== FRIENDS SYSTEM =====================
// Get friends list
app.get('/api/friends', (req, res) => {
    const token = req.headers['authorization'];
    const user = getSessionUser(token);
    if (!user) return res.status(401).json({ error: 'Invalid session' });

    const friends = user.friends || [];
    const pendingSent = user.pendingSent || [];
    const pendingReceived = user.pendingReceived || [];

    // Get online status
    const friendsWithStatus = friends.map(f => {
        const friendUser = UsersStore.find(f);
        return {
            username: f,
            online: !!playerByName[f],
            level: friendUser?.level || 1,
            rank: getRankForLevel(friendUser?.level || 1).name
        };
    });

    res.json({
        friends: friendsWithStatus,
        pendingSent,
        pendingReceived
    });
});

// Send friend request
app.post('/api/friends/request', (req, res) => {
    const { token, username } = req.body;
    console.log('[Friends] Request received - token:', token ? 'present' : 'missing', 'username:', username);

    if (!token) return res.status(401).json({ error: 'No token provided' });

    const user = getSessionUser(token);
    if (!user) return res.status(401).json({ error: 'Invalid session - please re-login' });

    if (!username || typeof username !== 'string') {
        return res.status(400).json({ error: 'Username is required' });
    }

    const targetUsername = username.trim();
    if (targetUsername.length < 1 || targetUsername.length > 20) {
        return res.status(400).json({ error: 'Invalid username length' });
    }

    const target = UsersStore.find(targetUsername);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (targetUsername === user.user) return res.status(400).json({ error: 'Cannot add yourself' });
    if ((user.friends || []).includes(targetUsername)) return res.status(400).json({ error: 'Already friends' });
    if ((user.pendingSent || []).includes(targetUsername)) return res.status(400).json({ error: 'Request already sent' });

    // Add to sender's pendingSent
    if (!user.pendingSent) user.pendingSent = [];
    user.pendingSent.push(targetUsername);
    UsersStore.update(user.user, { pendingSent: user.pendingSent });

    // Add to target's pendingReceived
    if (!target.pendingReceived) target.pendingReceived = [];
    target.pendingReceived.push(user.user);
    UsersStore.update(targetUsername, { pendingReceived: target.pendingReceived });

    // Notify target if online
    const targetSocket = playerByName[targetUsername]?.socket;
    if (targetSocket) {
        targetSocket.emit('friendRequest', { from: user.user });
    }

    console.log('[Friends] Request sent from', user.user, 'to', targetUsername);
    res.json({ success: true });
});

// Accept/Decline friend request
app.post('/api/friends/respond', (req, res) => {
    const { token, username, accept } = req.body;
    const user = getSessionUser(token);
    if (!user) return res.status(401).json({ error: 'Invalid session' });

    // Remove from pendingReceived
    user.pendingReceived = (user.pendingReceived || []).filter(u => u !== username);
    UsersStore.update(user.user, { pendingReceived: user.pendingReceived });

    const sender = UsersStore.find(username);
    if (!sender) return res.status(404).json({ error: 'User not found' });

    // Remove from sender's pendingSent
    sender.pendingSent = (sender.pendingSent || []).filter(u => u !== user.user);

    if (accept) {
        // Add to both friends lists
        if (!user.friends) user.friends = [];
        user.friends.push(username);
        UsersStore.update(user.user, { friends: user.friends, pendingReceived: user.pendingReceived });

        if (!sender.friends) sender.friends = [];
        sender.friends.push(user.user);
        UsersStore.update(username, { friends: sender.friends, pendingSent: sender.pendingSent });

        // Notify sender if online
        const senderSocket = playerByName[username]?.socket;
        if (senderSocket) {
            senderSocket.emit('friendAccepted', { by: user.user });
        }

        res.json({ success: true, friends: user.friends });
    } else {
        UsersStore.update(username, { pendingSent: sender.pendingSent });
        res.json({ success: true, declined: true });
    }
});

// Remove friend
app.post('/api/friends/remove', (req, res) => {
    const { token, username } = req.body;
    const user = getSessionUser(token);
    if (!user) return res.status(401).json({ error: 'Invalid session' });

    user.friends = (user.friends || []).filter(u => u !== username);
    UsersStore.update(user.user, { friends: user.friends });

    const target = UsersStore.find(username);
    if (target) {
        target.friends = (target.friends || []).filter(u => u !== user.user);
        UsersStore.update(username, { friends: target.friends });
    }

    res.json({ success: true });
});

// Get DM history
app.get('/api/dms/:username', (req, res) => {
    const token = req.headers['authorization'];
    const user = getSessionUser(token);
    if (!user) return res.status(401).json({ error: 'Invalid session' });

    const target = req.params.username;
    const dmKey = [user.user, target].sort().join('_');
    const dms = global.DM_HISTORY || (global.DM_HISTORY = {});
    const messages = dms[dmKey] || [];

    res.json({ messages });
});

// Send DM (via socket for real-time, but also store)
global.DM_HISTORY = {};
app.post('/api/dms/send', (req, res) => {
    const { token, to, message } = req.body;
    const user = getSessionUser(token);
    if (!user) return res.status(401).json({ error: 'Invalid session' });

    if (!(user.friends || []).includes(to)) {
        return res.status(403).json({ error: 'Not friends with this user' });
    }

    const dmKey = [user.user, to].sort().join('_');
    if (!global.DM_HISTORY[dmKey]) global.DM_HISTORY[dmKey] = [];

    const msg = {
        from: user.user,
        to,
        message: message.trim().slice(0, 200),
        timestamp: Date.now()
    };
    global.DM_HISTORY[dmKey].push(msg);
    if (global.DM_HISTORY[dmKey].length > 100) global.DM_HISTORY[dmKey].shift();

    // Send via socket if recipient is online
    const targetSocket = playerByName[to]?.socket;
    if (targetSocket) {
        targetSocket.emit('dm', msg);
    }

    res.json({ success: true, message: msg });
});

app.post('/api/admin/set-emeralds', (req, res) => {
    const { token, username, amount } = req.body;
    if (!isAdmin(token)) return res.status(403).json({ error: 'Forbidden' });
    const user = UsersStore.find(username);
    if (!user) return res.status(404).json({ error: 'User not found' });
    UsersStore.update(username, { emeralds: amount });
    res.json({ success: true });
});

app.post('/api/admin/announce', (req, res) => {
    const { token, message } = req.body;
    if (!isAdmin(token)) return res.status(403).json({ error: 'Forbidden' });
    if (!message || !message.trim()) return res.status(400).json({ error: 'Empty message' });

    io.emit('announcement', { message: message.trim(), from: 'Owner', timestamp: Date.now() });
    res.json({ success: true });
});

app.post('/api/admin/restart', (req, res) => {
    const { token, delay } = req.body;
    if (!isAdmin(token)) return res.status(403).json({ error: 'Forbidden' });

    const secs = delay || 5;
    io.emit('serverRestarting', { delay: secs, message: `Server restarting in ${secs} seconds` });
    res.json({ success: true, message: `Restarting in ${secs}s` });

    setTimeout(() => {
        console.log('[SERVER] Restarting by admin command...');
        server.close();
        process.exit(0);
    }, secs * 1000);
});

app.get('/api/admin/server-stats', (req, res) => {
    const token = req.headers['authorization'];
    if (!isAdmin(token)) return res.status(403).json({ error: 'Forbidden' });

    const allUsers = UsersStore.all();
    const onlineUsernames = Object.keys(playerByName);
    const activeMatches = Object.keys(rooms).length;
    const bannedCount = allUsers.filter(u => u.banned).length;

    res.json({
        totalUsers: allUsers.length,
        onlineUsers: onlineUsernames.length,
        onlineUsernames,
        activeMatches,
        queueLength: queue.length,
        bannedCount
    });
});

function getRankForLevel(lv) {
    let r = RANKS[0];
    for (let rank of RANKS) { if (lv >= rank.min) r = rank; }
    return r.name;
}

// ===================== MATCHMAKING STATE =====================
let queue = [];
let rooms = {};
let playerRoom = {};
let playerByName = {};
let reconnectTimers = {};
let roomCounter = 0;

// ===================== CHAT STATE =====================
let chatHistory = [];
let chatRateLimit = {};
const MAX_CHAT_HISTORY = 100;

// ===================== CONNECTION HANDLER =====================
io.on('connection', (socket) => {
    console.log(`[+] Connected: ${socket.id}`);

    // Send chat history on connect
    socket.emit('chatHistory', chatHistory);

    // ===================== AUTHENTICATE =====================
    socket.on('authenticate', (data) => {
        console.log('[AUTH] Received authenticate:', data);
        let username, token;
        if (typeof data === 'string') {
            username = data;
        } else {
            username = data.username;
            token = data.token;
        }

        console.log('[AUTH] Parsed - username:', username, 'token:', token ? 'yes' : 'no');

        const user = UsersStore.find(username);
        if (!user) {
            console.log('[AUTH] FAILED - user not found');
            socket.emit('authFailed', { error: 'User not found. Please log in again.' });
            return;
        }

        if (user.banned) {
            socket.emit('banned', { reason: user.banReason || 'Your account is banned' });
            setTimeout(() => socket.disconnect(true), 500);
            return;
        }

        // If token provided, validate it and create session if needed
        if (token) {
            const session = sessions[token];
            console.log('[AUTH] Session lookup:', session ? 'found' : 'not found');

            // If session doesn't exist but user exists, create a new session
            // This handles server restarts where sessions are lost
            if (!session || session.username !== username) {
                console.log('[AUTH] Creating new session for:', username);
                sessions[token] = { username, createdAt: Date.now() };
            }
        }

        socket.username = username;
        playerByName[username] = socket.id;
        console.log(`[AUTH] SUCCESS: ${username} (${socket.id})`);
        socket.emit('authenticated');

        io.to('admin').emit('userConnected', { username, socketId: socket.id });
    });

    // ===================== CHAT =====================
    socket.on('chatMessage', (data) => {
        if (!socket.username) {
            socket.emit('chatError', { error: 'Not authenticated. Please reload.' });
            return;
        }
        const now = Date.now();

        if (isUserMuted(socket.username)) {
            const remaining = getMuteRemaining(socket.username);
            socket.emit('chatMuted', { remaining: remaining === -1 ? -1 : remaining });
            return;
        }

        if (!chatRateLimit[socket.username]) chatRateLimit[socket.username] = [];
        chatRateLimit[socket.username] = chatRateLimit[socket.username].filter(t => now - t < 5000);
        if (chatRateLimit[socket.username].length >= 5) return;
        chatRateLimit[socket.username].push(now);

        const msg = (data.message || '').trim().slice(0, 200);
        if (!msg) return;

        // ===================== CHAT COMMANDS =====================
        if (msg.startsWith('/')) {
            const parts = msg.split(/\s+/);
            const cmd = parts[0].toLowerCase();

            // /give <username> <amount>
            if (cmd === '/give' && parts.length >= 3) {
                const senderUser = UsersStore.find(socket.username);
                if (!senderUser || (!senderUser.isAdmin && senderUser.role !== 'Owner' && senderUser.role !== 'Admin')) {
                    socket.emit('chatError', { error: 'Only Owner/Admin can use this command.' });
                    return;
                }
                const targetName = parts[1];
                const amount = parseInt(parts[2]);
                if (isNaN(amount) || amount <= 0) {
                    socket.emit('chatError', { error: 'Usage: /give <username> <amount>' });
                    return;
                }
                const target = UsersStore.find(targetName);
                if (!target) {
                    socket.emit('chatError', { error: `User "${targetName}" not found.` });
                    return;
                }
                const newAmount = (target.emeralds || 0) + amount;
                UsersStore.update(target.user, { emeralds: newAmount });
                const targetSid = playerByName[target.user];
                if (targetSid) {
                    const tSock = io.sockets.sockets.get(targetSid);
                    if (tSock) tSock.emit('emeraldsUpdated', { emeralds: newAmount });
                }
                const sysMsg = { id: now + '_sys', user: 'SYSTEM', message: socket.username + ' gave ' + amount + ' Emeralds to ' + target.user, timestamp: now, time: now, role: 'System', replyTo: null };
                chatHistory.push(sysMsg);
                if (chatHistory.length > MAX_CHAT_HISTORY) chatHistory.shift();
                io.emit('chatMessage', sysMsg);
                return;
            }

            // /setemeralds <username> <amount>
            if (cmd === '/setemeralds' && parts.length >= 3) {
                const senderUser = UsersStore.find(socket.username);
                if (!senderUser || (!senderUser.isAdmin && senderUser.role !== 'Owner' && senderUser.role !== 'Admin')) {
                    socket.emit('chatError', { error: 'Only Owner/Admin can use this command.' });
                    return;
                }
                const targetName = parts[1];
                const amount = parseInt(parts[2]);
                if (isNaN(amount) || amount < 0) {
                    socket.emit('chatError', { error: 'Usage: /setemeralds <username> <amount>' });
                    return;
                }
                const target = UsersStore.find(targetName);
                if (!target) {
                    socket.emit('chatError', { error: `User "${targetName}" not found.` });
                    return;
                }
                UsersStore.update(target.user, { emeralds: amount });
                const targetSid = playerByName[target.user];
                if (targetSid) {
                    const tSock = io.sockets.sockets.get(targetSid);
                    if (tSock) tSock.emit('emeraldsUpdated', { emeralds: amount });
                }
                const sysMsg = { id: now + '_sys', user: 'SYSTEM', message: socket.username + ' set ' + target.user + "'s Emeralds to " + amount, timestamp: now, time: now, role: 'System', replyTo: null };
                chatHistory.push(sysMsg);
                if (chatHistory.length > MAX_CHAT_HISTORY) chatHistory.shift();
                io.emit('chatMessage', sysMsg);
                return;
            }

            socket.emit('chatError', { error: 'Unknown command: ' + cmd });
            return;
        }

        // ===================== REGULAR CHAT MESSAGE =====================
        // Profanity check
        console.log('[CHAT] Checking message:', msg);
        if (containsProfanity(msg)) {
            console.log('[CHAT] Blocked - contains profanity');
            socket.emit('chatError', { error: 'Your message contains blocked words.' });
            return;
        }
        console.log('[CHAT] Message passed filter');

        const user = UsersStore.find(socket.username);
        const role = user ? (user.role || 'Member') : 'Member';
        const chatMsg = { id: now + '_' + socket.id, user: socket.username, message: msg, timestamp: now, time: now, role: role, replyTo: data.replyTo || null };
        chatHistory.push(chatMsg);
        if (chatHistory.length > MAX_CHAT_HISTORY) chatHistory.shift();
        io.emit('chatMessage', chatMsg);

        // @mention pings
        const mentions = msg.match(/@(\w+)/g);
        if (mentions) {
            mentions.forEach(m => {
                const mentionedName = m.slice(1);
                const targetSocketId = playerByName[mentionedName];
                if (targetSocketId && mentionedName !== socket.username) {
                    const targetSock = io.sockets.sockets.get(targetSocketId);
                    if (targetSock) targetSock.emit('chatPing', { from: socket.username, message: msg });
                }
            });
        }
    });

    // ===================== ADMIN =====================
    socket.on('adminSubscribe', (token) => {
        if (!isAdmin(token)) return;
        socket.join('admin');
        socket.adminSubscribed = true;
        console.log(`[A] Admin subscribed: ${socket.id}`);
    });

    // ===================== MATCHMAKING =====================
    socket.on('findMatch', (mode) => {
        if (!socket.username) return;
        if (queue.find(q => q.socket.id === socket.id)) return;

        console.log(`[Q] ${socket.username} searching for match (${mode})`);
        queue.push({ socket, username: socket.username, mode, joinedAt: Date.now() });
        broadcastQueue();
        tryMatch();
    });

    socket.on('cancelMatch', () => {
        queue = queue.filter(q => q.socket.id !== socket.id);
        console.log(`[Q] ${socket.username} left queue`);
        socket.emit('matchCancelled');
        broadcastQueue();
    });

    socket.on('getQueuePlayers', () => {
        const now = Date.now();
        const players = queue.map(q => {
            const userData = UsersStore.find(u => u.username);
            return {
                username: q.username
                mode: q.mode
                time: Math.floor((now - q.joinedAt) / 1000),
                elo: userData ? userData.elo : 1000
            };
        });
        socket.emit('queuePlayers', players);
    });

    // ===================== GAME =====================
    socket.on('inputFrame', (data) => {
        const roomId = playerRoom[socket.id];
        if (!roomId || !rooms[roomId]) {
            return;
        }
        const room = rooms[roomId];
        const opponentId = room.p1 === socket.id ? room.p2 : room.p1;
        if (opponentId) {
            io.to(opponentId).emit('opponentInput', data);
        }
    });

    // Damage synchronization for online matches
    socket.on('dealDamage', (data) => {
        const roomId = playerRoom[socket.id];
        if (!roomId || !rooms[roomId]) {
            console.log('[Damage] No room for socket:', socket.username);
            return;
        }
        const room = rooms[roomId];
        const opponentId = room.p1 === socket.id ? room.p2 : room.p1;
        console.log('[Damage] From:', socket.username, 'To opponent:', 'damage:', data.damage);
        if (opponentId) {
            io.to(opponentId).emit('takeDamage', data);
        }
    });

    socket.on('matchEnd', (result) => {
        const roomId = playerRoom[socket.id];
        console.log(`[M] Match ended in room ${roomId}: ${JSON.stringify(result)}`);
        if (roomId && rooms[roomId]) {
            cleanupRoom(roomId);
        }
    });

    socket.on('leaveMatch', () => {
        const roomId = playerRoom[socket.id];
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];
        const opponentId = room.p1 === socket.id ? room.p2 : room.p1;
        if (opponentId) io.to(opponentId).emit('opponentLeft');
        cleanupRoom(roomId);
    });

    socket.on('pingCheck', (timestamp) => {
        socket.emit('pongCheck', timestamp);
    });

    // ===================== DISCONNECT =====================
    socket.on('disconnect', () => {
        console.log(`[-] Disconnected: ${socket.username || socket.id}`);

        queue = queue.filter(q => q.socket.id !== socket.id);
        broadcastQueue();

        const roomId = playerRoom[socket.id];
        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];
            const opponentId = room.p1 === socket.id ? room.p2 : room.p1;
            if (opponentId) io.to(opponentId).emit('opponentDisconnected');

            if (reconnectTimers[roomId]) clearTimeout(reconnectTimers[roomId].timer);
            reconnectTimers[roomId] = {
                socketId: socket.id,
                timer: setTimeout(() => {
                    console.log(`[!] Reconnection timeout for room ${roomId}`);
                    if (opponentId) io.to(opponentId).emit('opponentLeft');
                    cleanupRoom(roomId);
                }, 30000)
            };
        }

        if (socket.username && playerByName[socket.username] === socket.id) {
            delete playerByName[socket.username];
        }

        if (socket.username) {
            io.to('admin').emit('userDisconnected', { username: socket.username });
        }
    });

    socket.on('reconnectMatch', (username) => {
        const prevSocketId = playerByName[username];
        if (!prevSocketId) { socket.emit('reconnectFailed'); return; }

        const roomId = playerRoom[prevSocketId];
        if (!roomId || !rooms[roomId]) { socket.emit('reconnectFailed'); return; }

        const room = rooms[roomId];
        if (reconnectTimers[roomId]) {
            clearTimeout(reconnectTimers[roomId].timer);
            delete reconnectTimers[roomId];
        }

        if (room.p1 === prevSocketId) room.p1 = socket.id;
        else if (room.p2 === prevSocketId) room.p2 = socket.id;

        delete playerRoom[prevSocketId];
        playerRoom[socket.id] = roomId;
        socket.username = username;
        playerByName[username] = socket.id;

        socket.emit('reconnected');
        const opponentId = room.p1 === socket.id ? room.p2 : room.p1;
        if (opponentId) io.to(opponentId).emit('opponentReconnected');
        console.log(`[R] ${username} reconnected to room ${roomId}`);
    });
});

// ===================== MATCHMAKING =====================
function broadcastQueue() {
    const now = Date.now();
    const queueInfo = queue.map(q => ({
        username: q.username,
        mode: q.mode,
        time: Math.floor((now - q.joinedAt) / 1000)
    }));
    io.emit('queueUpdate', { queue: queueInfo, count: queue.length });
}

function tryMatch() {
    while (queue.length >= 2) {
        const p1 = queue.shift();
        const p2 = queue.shift();
        if (!p1.socket.connected || !p2.socket.connected) {
            if (p1.socket.connected) queue.unshift(p1);
            if (p2.socket.connected) queue.unshift(p2);
            continue;
        }
        createMatch(p1, p2);
    }
}

function createMatch(p1, p2) {
    const roomId = `room_${++roomCounter}`;
    rooms[roomId] = {
        p1: p1.socket.id, p2: p2.socket.id,
        p1Name: p1.username, p2Name: p2.username,
        createdAt: Date.now()
    };
    playerRoom[p1.socket.id] = roomId;
    playerRoom[p2.socket.id] = roomId;

    p1.socket.emit('matchFound', { roomId, opponent: { username: p2.username }, playerIndex: 0 });
    p2.socket.emit('matchFound', { roomId, opponent: { username: p1.username }, playerIndex: 1 });

    console.log(`[M] Match created: ${p1.username} vs ${p2.username} in ${roomId}`);
    io.to('admin').emit('matchStarted', { roomId, p1: p1.username, p2: p2.username });
}

function cleanupRoom(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    io.to('admin').emit('matchEnded', { roomId });
    delete playerRoom[room.p1];
    delete playerRoom[room.p2];
    delete rooms[roomId];
    if (reconnectTimers[roomId]) {
        clearTimeout(reconnectTimers[roomId].timer);
        delete reconnectTimers[roomId];
    }
    console.log(`[M] Room ${roomId} cleaned up`);
}

// ===================== START SERVER =====================
server.listen(PORT, () => {
    console.log(`SHATTER Server running on http://localhost:${PORT}`);
});
