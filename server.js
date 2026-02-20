const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const clients = new Map();
const messageHistory = [];
const MAX_HISTORY = 100;

const userProfiles = new Map();
const adminHWIDs = new Set(['admin-hwid-1']);
const specialRanks = new Map();

const DATA_DIR = './data';
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

function loadData() {
    try {
        if (fs.existsSync(path.join(DATA_DIR, 'profiles.json'))) {
            const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'profiles.json'), 'utf8'));
            Object.entries(data).forEach(([hwid, profile]) => userProfiles.set(hwid, profile));
        }
        if (fs.existsSync(path.join(DATA_DIR, 'ranks.json'))) {
            const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'ranks.json'), 'utf8'));
            Object.entries(data).forEach(([hwid, rank]) => specialRanks.set(hwid, rank));
        }
    } catch (e) {
        console.error('Error loading data:', e);
    }
}

function saveData() {
    try {
        fs.writeFileSync(
            path.join(DATA_DIR, 'profiles.json'),
            JSON.stringify(Object.fromEntries(userProfiles))
        );
        fs.writeFileSync(
            path.join(DATA_DIR, 'ranks.json'),
            JSON.stringify(Object.fromEntries(specialRanks))
        );
    } catch (e) {
        console.error('Error saving data:', e);
    }
}

loadData();

app.use(express.json());

app.get('/', (req, res) => {
    res.send('Litka Chat Server is running');
});

app.get('/stats', (req, res) => {
    res.json({
        online: clients.size,
        messages: messageHistory.length
    });
});

app.post('/admin/rank', (req, res) => {
    const { adminKey, hwid, rank } = req.body;
    
    if (adminKey !== process.env.ADMIN_KEY && adminKey !== 'litka-admin-2024') {
        return res.status(403).json({ error: 'Invalid admin key' });
    }
    
    if (!hwid || !rank) {
        return res.status(400).json({ error: 'Missing hwid or rank' });
    }
    
    specialRanks.set(hwid, rank);
    saveData();
    
    res.json({ success: true, message: `Rank ${rank} assigned to ${hwid}` });
});

wss.on('connection', (ws) => {
    let username = null;
    let hwid = null;
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            
            switch(message.type) {
                case 'join':
                    username = message.username;
                    hwid = message.hwid || username;
                    
                    clients.set(ws, { username, hwid });
                    
                    if (!userProfiles.has(hwid)) {
                        userProfiles.set(hwid, {
                            bracketStyle: '[]',
                            bracketColor: '§7',
                            messageColor: '§f',
                            customPrefixes: []
                        });
                        saveData();
                    }
                    
                    ws.send(JSON.stringify({
                        type: 'history',
                        messages: messageHistory
                    }));
                    
                    ws.send(JSON.stringify({
                        type: 'profile',
                        profile: userProfiles.get(hwid),
                        specialRank: specialRanks.get(hwid) || null
                    }));
                    
                    broadcast({
                        type: 'online',
                        count: clients.size
                    });
                    
                    console.log(`${username} (${hwid}) joined. Online: ${clients.size}`);
                    break;
                    
                case 'message':
                    if (!username) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Not authenticated'
                        }));
                        return;
                    }
                    
                    const profile = userProfiles.get(hwid);
                    const specialRank = specialRanks.get(hwid);
                    
                    const chatMessage = {
                        type: 'message',
                        username: username,
                        message: message.message,
                        profile: profile,
                        specialRank: specialRank,
                        timestamp: Date.now()
                    };
                    
                    messageHistory.push(chatMessage);
                    if (messageHistory.length > MAX_HISTORY) {
                        messageHistory.shift();
                    }
                    
                    broadcast(chatMessage);
                    console.log(`${username}: ${message.message}`);
                    break;
                    
                case 'custom':
                    if (!username) return;
                    
                    const cmd = message.command;
                    const args = message.args || [];
                    
                    handleCustomCommand(ws, hwid, cmd, args);
                    break;
            }
        } catch (e) {
            console.error('Error parsing message:', e);
        }
    });
    
    ws.on('close', () => {
        if (username) {
            clients.delete(ws);
            
            broadcast({
                type: 'online',
                count: clients.size
            });
            
            console.log(`${username} left. Online: ${clients.size}`);
        }
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

function handleCustomCommand(ws, hwid, cmd, args) {
    const profile = userProfiles.get(hwid);
    
    switch(cmd) {
        case 'bracket':
            if (args[0]) {
                const styles = ['[]', '()', '{}', '<>', '||', '««»»'];
                if (styles.includes(args[0])) {
                    profile.bracketStyle = args[0];
                    saveData();
                    ws.send(JSON.stringify({
                        type: 'custom_response',
                        message: `Стиль скобок изменен на ${args[0]}`
                    }));
                }
            }
            break;
            
        case 'bracketcolor':
            if (args[0]) {
                const colors = ['§0', '§1', '§2', '§3', '§4', '§5', '§6', '§7', '§8', '§9', '§a', '§b', '§c', '§d', '§e', '§f'];
                if (colors.includes(args[0])) {
                    profile.bracketColor = args[0];
                    saveData();
                    ws.send(JSON.stringify({
                        type: 'custom_response',
                        message: `Цвет скобок изменен`
                    }));
                }
            }
            break;
            
        case 'messagecolor':
            if (args[0]) {
                const colors = ['§0', '§1', '§2', '§3', '§4', '§5', '§6', '§7', '§8', '§9', '§a', '§b', '§c', '§d', '§e', '§f'];
                if (colors.includes(args[0])) {
                    profile.messageColor = args[0];
                    saveData();
                    ws.send(JSON.stringify({
                        type: 'custom_response',
                        message: `Цвет сообщений изменен`
                    }));
                }
            }
            break;
            
        case 'prefix':
            const action = args[0];
            if (action === 'add' && args[1]) {
                const prefix = args[1].substring(0, 6);
                if (!profile.customPrefixes) profile.customPrefixes = [];
                if (profile.customPrefixes.length < 5) {
                    profile.customPrefixes.push(prefix);
                    saveData();
                    ws.send(JSON.stringify({
                        type: 'custom_response',
                        message: `Префикс "${prefix}" добавлен`
                    }));
                } else {
                    ws.send(JSON.stringify({
                        type: 'custom_response',
                        message: `Максимум 5 префиксов`
                    }));
                }
            } else if (action === 'remove' && args[1]) {
                const index = parseInt(args[1]) - 1;
                if (profile.customPrefixes && profile.customPrefixes[index]) {
                    profile.customPrefixes.splice(index, 1);
                    saveData();
                    ws.send(JSON.stringify({
                        type: 'custom_response',
                        message: `Префикс удален`
                    }));
                }
            } else if (action === 'list') {
                const list = profile.customPrefixes || [];
                ws.send(JSON.stringify({
                    type: 'custom_response',
                    message: `Ваши префиксы: ${list.join(', ') || 'нет'}`
                }));
            } else if (action === 'select' && args[1]) {
                const index = parseInt(args[1]) - 1;
                if (profile.customPrefixes && profile.customPrefixes[index]) {
                    profile.selectedPrefix = profile.customPrefixes[index];
                    saveData();
                    ws.send(JSON.stringify({
                        type: 'custom_response',
                        message: `Префикс "${profile.selectedPrefix}" выбран`
                    }));
                }
            }
            break;
            
        case 'help':
            ws.send(JSON.stringify({
                type: 'custom_response',
                message: `Команды: @custom bracket []/(){}/etc, @custom bracketcolor §X, @custom messagecolor §X, @custom prefix add/remove/list/select`
            }));
            break;
    }
}

function broadcast(message) {
    const data = JSON.stringify(message);
    clients.forEach((clientData, client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Litka Chat Server running on port ${PORT}`);
});
