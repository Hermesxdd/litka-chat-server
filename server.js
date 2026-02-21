const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const fs = require('fs');

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

wss.on('connection', (ws) => {
    let username = null;
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            
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
                            message: 'Необходимо указать имя пользователя'
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
    
    const targetClient = Array.from(clients.entries()).find(([client, data]) => data.username === targetUser);
    if (!targetClient) {
        ws.send(JSON.stringify({
            type: 'custom_response',
            message: '§cПользователь не найден или не в сети'
        }));
        return;
    }
    
    targetClient[0].send(JSON.stringify({
        type: 'custom_response',
        message: `§d[ЛС от ${username}]: §f${pmMessage}`
    }));
    
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

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Litka Chat Server running on port ${PORT}`);
});
