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

const userProfiles = new Map();
const adminHWIDs = new Set(['admin-hwid-1']);
const specialRanks = new Map();

const registeredUsers = new Map();
const userSessions = new Map();

const userMessageHistory = new Map();
const mutedUsers = new Map();
const SPAM_THRESHOLD = 3;
const SPAM_TIME_WINDOW = 10000;
const MUTE_DURATION = 20 * 60 * 1000;

const developerUsers = new Set(['Hermesxdd', 'fomivik']);
const userPrefixes = new Map();
const privateMessagesEnabled = new Map();

const DATA_DIR = './data';
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

function loadData() {
    try {
        if (fs.existsSync(path.join(DATA_DIR, 'profiles.json'))) {
            const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'profiles.json'), 'utf8'));
            Object.entries(data).forEach(([username, profile]) => userProfiles.set(username, profile));
        }
        if (fs.existsSync(path.join(DATA_DIR, 'ranks.json'))) {
            const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'ranks.json'), 'utf8'));
            Object.entries(data).forEach(([username, rank]) => specialRanks.set(username, rank));
        }
        if (fs.existsSync(path.join(DATA_DIR, 'users.json'))) {
            const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8'));
            Object.entries(data).forEach(([username, userData]) => registeredUsers.set(username, userData));
        }
        if (fs.existsSync(path.join(DATA_DIR, 'prefixes.json'))) {
            const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'prefixes.json'), 'utf8'));
            Object.entries(data).forEach(([username, prefix]) => userPrefixes.set(username, prefix));
        }
        if (fs.existsSync(path.join(DATA_DIR, 'pm_settings.json'))) {
            const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'pm_settings.json'), 'utf8'));
            Object.entries(data).forEach(([username, enabled]) => privateMessagesEnabled.set(username, enabled));
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
        fs.writeFileSync(
            path.join(DATA_DIR, 'users.json'),
            JSON.stringify(Object.fromEntries(registeredUsers))
        );
        fs.writeFileSync(
            path.join(DATA_DIR, 'prefixes.json'),
            JSON.stringify(Object.fromEntries(userPrefixes))
        );
        fs.writeFileSync(
            path.join(DATA_DIR, 'pm_settings.json'),
            JSON.stringify(Object.fromEntries(privateMessagesEnabled))
        );
    } catch (e) {
        console.error('Error saving data:', e);
    }
}

loadData();

// Pre-register developer accounts with complex passwords
function initDeveloperAccounts() {
    const devAccounts = {
        'Hermesxdd': 'K9#mX7$vL2@nQ4&wE8!pR6^tY3*uI5%oA1',
        'fomivik': 'Z8@hB4#nM9$xC6&vL2!qW7^eR5*tY3%uI1'
    };
    
    for (const [username, password] of Object.entries(devAccounts)) {
        if (!registeredUsers.has(username)) {
            const hashedPassword = hashPassword(password);
            registeredUsers.set(username, {
                password: hashedPassword,
                registeredAt: Date.now()
            });
            
            if (!userProfiles.has(username)) {
                userProfiles.set(username, {
                    bracketStyle: '[]',
                    bracketColor: '§7',
                    messageColor: '§f',
                    customPrefixes: []
                });
            }
            
            specialRanks.set(username, 'Developer');
            privateMessagesEnabled.set(username, true);
            
            console.log(`Pre-registered developer account: ${username}`);
        }
    }
    saveData();
}

initDeveloperAccounts();

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

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

wss.on('connection', (ws) => {
    let username = null;
    let sessionToken = null;
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            console.log('Received message:', message.type, message);
            
            switch(message.type) {
                case 'register':
                    const { regUsername, regPassword } = message;
                    console.log('Registration attempt:', regUsername);
                    
                    if (!regUsername || !regPassword) {
                        console.log('Missing username or password');
                        ws.send(JSON.stringify({
                            type: 'auth_error',
                            message: 'Имя пользователя и пароль обязательны'
                        }));
                        return;
                    }
                    
                    if (regUsername.length < 3 || regUsername.length > 16) {
                        console.log('Invalid username length:', regUsername.length);
                        ws.send(JSON.stringify({
                            type: 'auth_error',
                            message: 'Имя пользователя должно быть от 3 до 16 символов'
                        }));
                        return;
                    }
                    
                    if (registeredUsers.has(regUsername)) {
                        console.log('User already exists:', regUsername);
                        ws.send(JSON.stringify({
                            type: 'auth_error',
                            message: 'Пользователь уже существует'
                        }));
                        return;
                    }
                    
                    console.log('Creating new user:', regUsername);
                    const hashedPassword = hashPassword(regPassword);
                    registeredUsers.set(regUsername, {
                        password: hashedPassword,
                        registeredAt: Date.now()
                    });
                    
                    if (!userProfiles.has(regUsername)) {
                        userProfiles.set(regUsername, {
                            bracketStyle: '[]',
                            bracketColor: '§7',
                            messageColor: '§f',
                            customPrefixes: []
                        });
                    }
                    
                    if (developerUsers.has(regUsername)) {
                        specialRanks.set(regUsername, 'Developer');
                    }
                    
                    privateMessagesEnabled.set(regUsername, true);
                    
                    saveData();
                    
                    const token = generateSessionToken();
                    userSessions.set(token, regUsername);
                    username = regUsername;
                    sessionToken = token;
                    
                    clients.set(ws, { username });
                    
                    console.log('Sending auth_success for:', regUsername);
                    ws.send(JSON.stringify({
                        type: 'auth_success',
                        username: regUsername,
                        sessionToken: token
                    }));
                    
                    console.log(`${regUsername} registered and joined. Online: ${clients.size}`);
                    break;
                    
                case 'login':
                    const { loginUsername, loginPassword } = message;
                    
                    if (!registeredUsers.has(loginUsername)) {
                        ws.send(JSON.stringify({
                            type: 'auth_error',
                            message: 'Пользователь не найден'
                        }));
                        return;
                    }
                    
                    const userData = registeredUsers.get(loginUsername);
                    const inputHash = hashPassword(loginPassword);
                    
                    if (userData.password !== inputHash) {
                        ws.send(JSON.stringify({
                            type: 'auth_error',
                            message: 'Неверный пароль'
                        }));
                        return;
                    }
                    
                    const loginToken = generateSessionToken();
                    userSessions.set(loginToken, loginUsername);
                    username = loginUsername;
                    sessionToken = loginToken;
                    
                    clients.set(ws, { username });
                    
                    if (developerUsers.has(loginUsername) && !specialRanks.has(loginUsername)) {
                        specialRanks.set(loginUsername, 'Developer');
                        saveData();
                    }
                    
                    if (!privateMessagesEnabled.has(loginUsername)) {
                        privateMessagesEnabled.set(loginUsername, true);
                        saveData();
                    }
                    
                    ws.send(JSON.stringify({
                        type: 'auth_success',
                        username: loginUsername,
                        sessionToken: loginToken
                    }));
                    
                    console.log(`${loginUsername} logged in. Online: ${clients.size}`);
                    break;
                    
                case 'join':
                    if (!username) {
                        ws.send(JSON.stringify({
                            type: 'auth_error',
                            message: 'Необходима авторизация'
                        }));
                        return;
                    }
                    
                    ws.send(JSON.stringify({
                        type: 'history',
                        messages: messageHistory
                    }));
                    
                    ws.send(JSON.stringify({
                        type: 'profile',
                        profile: userProfiles.get(username),
                        specialRank: specialRanks.get(username) || null
                    }));
                    
                    broadcast({
                        type: 'online',
                        count: clients.size
                    });
                    break;
                    
                case 'message':
                    if (!username) {
                        ws.send(JSON.stringify({
                            type: 'auth_error',
                            message: 'Необходима авторизация'
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
                    
                    if (messageText.startsWith('@')) {
                        handleAdminCommand(ws, username, messageText);
                        return;
                    }
                    
                    if (checkSpam(username, messageText)) {
                        ws.send(JSON.stringify({
                            type: 'custom_response',
                            message: '§cВы были заглушены за спам на 20 минут'
                        }));
                        return;
                    }
                    
                    const profile = userProfiles.get(username);
                    let displayRank = specialRanks.get(username);
                    
                    if (userPrefixes.has(username)) {
                        const customPrefix = userPrefixes.get(username);
                        displayRank = displayRank ? `${displayRank}|${customPrefix.name}` : customPrefix.name;
                    }
                    
                    const chatMessage = {
                        type: 'message',
                        username: username,
                        message: messageText,
                        profile: profile,
                        specialRank: displayRank,
                        timestamp: Date.now()
                    };
                    
                    messageHistory.push(chatMessage);
                    if (messageHistory.length > MAX_HISTORY) {
                        messageHistory.shift();
                    }
                    
                    broadcast(chatMessage);
                    console.log(`${username}: ${messageText}`);
                    break;
                    
                case 'custom':
                    if (!username) return;
                    
                    const cmd = message.command;
                    const args = message.args || [];
                    
                    handleCustomCommand(ws, username, cmd, args);
                    break;
            }
        } catch (e) {
            console.error('Error parsing message:', e);
        }
    });
    
    ws.on('close', () => {
        if (username) {
            clients.delete(ws);
            if (sessionToken) {
                userSessions.delete(sessionToken);
            }
            
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

function handleAdminCommand(ws, username, messageText) {
    const args = messageText.substring(1).split(' ');
    const command = args[0].toLowerCase();
    
    switch (command) {
        case 'mute':
            if (!developerUsers.has(username)) {
                ws.send(JSON.stringify({
                    type: 'custom_response',
                    message: '§cНедостаточно прав'
                }));
                return;
            }
            
            if (args.length < 3) {
                ws.send(JSON.stringify({
                    type: 'custom_response',
                    message: '§cИспользование: @mute <логин> <время в секундах>'
                }));
                return;
            }
            
            const muteTarget = args[1];
            const muteTime = parseInt(args[2]) * 1000;
            
            if (!registeredUsers.has(muteTarget)) {
                ws.send(JSON.stringify({
                    type: 'custom_response',
                    message: '§cПользователь не найден'
                }));
                return;
            }
            
            mutedUsers.set(muteTarget, Date.now() + muteTime);
            
            broadcast({
                type: 'message',
                username: 'Система',
                message: `§c${muteTarget} был заглушен на ${args[2]} секунд администратором ${username}`,
                profile: null,
                specialRank: 'Система',
                timestamp: Date.now()
            });
            break;
            
        case 'unmute':
            if (!developerUsers.has(username)) {
                ws.send(JSON.stringify({
                    type: 'custom_response',
                    message: '§cНедостаточно прав'
                }));
                return;
            }
            
            if (args.length < 2) {
                ws.send(JSON.stringify({
                    type: 'custom_response',
                    message: '§cИспользование: @unmute <логин>'
                }));
                return;
            }
            
            const unmuteTarget = args[1];
            
            if (mutedUsers.has(unmuteTarget)) {
                mutedUsers.delete(unmuteTarget);
                
                broadcast({
                    type: 'message',
                    username: 'Система',
                    message: `§a${unmuteTarget} был размучен администратором ${username}`,
                    profile: null,
                    specialRank: 'Система',
                    timestamp: Date.now()
                });
            } else {
                ws.send(JSON.stringify({
                    type: 'custom_response',
                    message: '§cПользователь не заглушен'
                }));
            }
            break;
            
        case 'prefix':
            if (!developerUsers.has(username)) {
                ws.send(JSON.stringify({
                    type: 'custom_response',
                    message: '§cНедостаточно прав'
                }));
                return;
            }
            
            const prefixAction = args[1];
            
            if (prefixAction === 'add') {
                if (args.length < 5) {
                    ws.send(JSON.stringify({
                        type: 'custom_response',
                        message: '§cИспользование: @prefix add <логин> <префикс> <цвет>'
                    }));
                    return;
                }
                
                const targetUser = args[2];
                const prefixName = args[3];
                const prefixColor = args[4];
                
                if (!registeredUsers.has(targetUser)) {
                    ws.send(JSON.stringify({
                        type: 'custom_response',
                        message: '§cПользователь не найден'
                    }));
                    return;
                }
                
                userPrefixes.set(targetUser, {
                    name: prefixName,
                    color: prefixColor
                });
                
                saveData();
                
                ws.send(JSON.stringify({
                    type: 'custom_response',
                    message: `§aПрефикс ${prefixColor}${prefixName}§a выдан пользователю ${targetUser}`
                }));
                
            } else if (prefixAction === 'dell') {
                if (args.length < 3) {
                    ws.send(JSON.stringify({
                        type: 'custom_response',
                        message: '§cИспользование: @prefix dell <логин>'
                    }));
                    return;
                }
                
                const targetUser = args[2];
                
                if (userPrefixes.has(targetUser)) {
                    userPrefixes.delete(targetUser);
                    saveData();
                    
                    ws.send(JSON.stringify({
                        type: 'custom_response',
                        message: `§aПрефикс удален у пользователя ${targetUser}`
                    }));
                } else {
                    ws.send(JSON.stringify({
                        type: 'custom_response',
                        message: '§cУ пользователя нет префикса'
                    }));
                }
            }
            break;
            
        case 'msg':
            if (args.length < 3) {
                ws.send(JSON.stringify({
                    type: 'custom_response',
                    message: '§cИспользование: @msg <ник> <текст> или @msg off/on'
                }));
                return;
            }
            
            if (args[1] === 'off') {
                privateMessagesEnabled.set(username, false);
                saveData();
                ws.send(JSON.stringify({
                    type: 'custom_response',
                    message: '§cПрием личных сообщений отключен'
                }));
                return;
            } else if (args[1] === 'on') {
                privateMessagesEnabled.set(username, true);
                saveData();
                ws.send(JSON.stringify({
                    type: 'custom_response',
                    message: '§aПрием личных сообщений включен'
                }));
                return;
            }
            
            const pmTarget = args[1];
            const pmMessage = args.slice(2).join(' ');
            
            if (!registeredUsers.has(pmTarget)) {
                ws.send(JSON.stringify({
                    type: 'custom_response',
                    message: '§cПользователь не найден'
                }));
                return;
            }
            
            if (!privateMessagesEnabled.get(pmTarget)) {
                ws.send(JSON.stringify({
                    type: 'custom_response',
                    message: '§cПользователь отключил прием личных сообщений'
                }));
                return;
            }
            
            // Send to target
            const targetClient = Array.from(clients.entries()).find(([client, data]) => data.username === pmTarget);
            if (targetClient) {
                targetClient[0].send(JSON.stringify({
                    type: 'custom_response',
                    message: `§d[ЛС от ${username}]: §f${pmMessage}`
                }));
            }
            
            // Confirm to sender
            ws.send(JSON.stringify({
                type: 'custom_response',
                message: `§d[ЛС для ${pmTarget}]: §f${pmMessage}`
            }));
            break;
            
        case 'to':
            if (args.length < 3) {
                ws.send(JSON.stringify({
                    type: 'custom_response',
                    message: '§cИспользование: @to <ник> <текст>'
                }));
                return;
            }
            
            const mentionTarget = args[1];
            const mentionMessage = args.slice(2).join(' ');
            
            if (!registeredUsers.has(mentionTarget)) {
                ws.send(JSON.stringify({
                    type: 'custom_response',
                    message: '§cПользователь не найден'
                }));
                return;
            }
            
            const profile = userProfiles.get(username);
            let displayRank = specialRanks.get(username);
            
            if (userPrefixes.has(username)) {
                const customPrefix = userPrefixes.get(username);
                displayRank = displayRank ? `${displayRank}|${customPrefix.name}` : customPrefix.name;
            }
            
            const mentionChatMessage = {
                type: 'message',
                username: username,
                message: `§e@${mentionTarget} §f${mentionMessage}`,
                profile: profile,
                specialRank: displayRank,
                timestamp: Date.now()
            };
            
            messageHistory.push(mentionChatMessage);
            if (messageHistory.length > MAX_HISTORY) {
                messageHistory.shift();
            }
            
            broadcast(mentionChatMessage);
            break;
            
        default:
            ws.send(JSON.stringify({
                type: 'custom_response',
                message: '§cНеизвестная команда. Доступные: @mute, @unmute, @prefix, @msg, @to'
            }));
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
