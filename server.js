const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const clients = new Map();
const messageHistory = [];
const MAX_HISTORY = 100;

const userMessageHistory = new Map();
const mutedUsers = new Map();
const SPAM_THRESHOLD = 3;
const SPAM_TIME_WINDOW = 10000;
const MUTE_DURATION = 20 * 60 * 1000;

const DATA_DIR = './data';
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

function loadData() {
    // No data to load anymore
}

function saveData() {
    // No data to save anymore
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
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            console.log('Received message:', message.type, message);
            
            switch(message.type) {
                case 'join':
                    const nickname = message.nickname || message.username;
                    
                    if (!nickname || nickname.length < 1 || nickname.length > 16) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Неверное имя пользователя'
                        }));
                        return;
                    }
                    
                    username = nickname;
                    clients.set(ws, { username });
                    
                    ws.send(JSON.stringify({
                        type: 'history',
                        messages: messageHistory
                    }));
                    
                    broadcast({
                        type: 'online',
                        count: clients.size
                    });
                    
                    console.log(`${username} joined. Online: ${clients.size}`);
                    break;
                    
                case 'message':
                    if (!username) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'DEBUG: Username not set on server'
                        }));
                        return;
                    }
                    
                    if (isUserMuted(username)) {
                        const muteEnd = mutedUsers.get(username);
                        const remainingTime = Math.ceil((muteEnd - Date.now()) / 60000);
                        ws.send(JSON.stringify({
                            type: 'custom_response',
                            message: `§cВы заглушены еще на ${remainingTime} минут`
                        }));
                        return;
                    }
                    
                    const messageText = message.message.trim();
                    
                    if (messageText.startsWith('@msg')) {
                        handleMsgCommand(ws, username, messageText);
                        return;
                    }
                    
                    if (messageText.startsWith('@to')) {
                        handleToCommand(ws, username, messageText);
                        return;
                    }
                    
                    if (checkSpam(username, messageText)) {
                        ws.send(JSON.stringify({
                            type: 'custom_response',
                            message: '§cВы были заглушены за спам на 20 минут'
                        }));
                        return;
                    }
                    
                    const chatMessage = {
                        type: 'message',
                        username: username,
                        message: messageText,
                        timestamp: Date.now()
                    };
                    
                    messageHistory.push(chatMessage);
                    if (messageHistory.length > MAX_HISTORY) {
                        messageHistory.shift();
                    }
                    
                    broadcast(chatMessage);
                    console.log(`${username}: ${messageText}`);
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

function handleCustomCommand(ws, username, cmd, args) {
    const profile = userProfiles.get(username);
    
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

function isUserMuted(username) {
    if (!mutedUsers.has(username)) return false;
    
    const muteEnd = mutedUsers.get(username);
    if (Date.now() > muteEnd) {
        mutedUsers.delete(username);
        return false;
    }
    return true;
}

function checkSpam(username, message) {
    if (!userMessageHistory.has(username)) {
        userMessageHistory.set(username, []);
    }
    
    const userMessages = userMessageHistory.get(username);
    const now = Date.now();
    
    userMessages.push({ message, timestamp: now });
    
    const recentMessages = userMessages.filter(msg => now - msg.timestamp < SPAM_TIME_WINDOW);
    userMessageHistory.set(username, recentMessages);
    
    const sameMessages = recentMessages.filter(msg => msg.message === message);
    
    if (sameMessages.length >= SPAM_THRESHOLD) {
        const muteEnd = now + MUTE_DURATION;
        mutedUsers.set(username, muteEnd);
        
        broadcast({
            type: 'message',
            username: 'Система',
            message: `§c${username} был заглушен на 20 минут за спам`,
            profile: null,
            specialRank: 'Система',
            timestamp: now
        });
        
        return true;
    }
    
    return false;
}

function handleMsgCommand(ws, username, messageText) {
    const args = messageText.split(' ');
    
    if (args.length < 3) {
        ws.send(JSON.stringify({
            type: 'custom_response',
            message: '§cИспользование: @msg <ник> <текст>'
        }));
        return;
    }
    
    const targetUser = args[1];
    const pmMessage = args.slice(2).join(' ');
    
    // Find target client
    const targetClient = Array.from(clients.entries()).find(([client, data]) => data.username === targetUser);
    if (!targetClient) {
        ws.send(JSON.stringify({
            type: 'custom_response',
            message: '§cПользователь не найден или не в сети'
        }));
        return;
    }
    
    // Send to target
    targetClient[0].send(JSON.stringify({
        type: 'custom_response',
        message: `§d[ЛС от ${username}]: §f${pmMessage}`
    }));
    
    // Confirm to sender
    ws.send(JSON.stringify({
        type: 'custom_response',
        message: `§d[ЛС для ${targetUser}]: §f${pmMessage}`
    }));
}

function handleToCommand(ws, username, messageText) {
    const args = messageText.split(' ');
    
    if (args.length < 3) {
        ws.send(JSON.stringify({
            type: 'custom_response',
            message: '§cИспользование: @to <ник> <текст>'
        }));
        return;
    }
    
    const mentionTarget = args[1];
    const mentionMessage = args.slice(2).join(' ');
    
    const chatMessage = {
        type: 'message',
        username: username,
        message: `§e@${mentionTarget} §f${mentionMessage}`,
        timestamp: Date.now()
    };
    
    messageHistory.push(chatMessage);
    if (messageHistory.length > MAX_HISTORY) {
        messageHistory.shift();
    }
    
    broadcast(chatMessage);
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
