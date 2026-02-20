const WebSocket = require('ws');
const express = require('express');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const clients = new Map();
const messageHistory = [];
const MAX_HISTORY = 100;

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
    
    console.log('New connection');
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            
            switch(message.type) {
                case 'join':
                    username = message.username;
                    clients.set(ws, username);
                    
                    broadcast({
                        type: 'system',
                        message: `${username} присоединился к чату`,
                        timestamp: Date.now()
                    });
                    
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
                            message: 'Not authenticated'
                        }));
                        return;
                    }
                    
                    const chatMessage = {
                        type: 'message',
                        username: username,
                        message: message.message,
                        timestamp: Date.now()
                    };
                    
                    messageHistory.push(chatMessage);
                    if (messageHistory.length > MAX_HISTORY) {
                        messageHistory.shift();
                    }
                    
                    broadcast(chatMessage);
                    console.log(`${username}: ${message.message}`);
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
                type: 'system',
                message: `${username} покинул чат`,
                timestamp: Date.now()
            });
            
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

function broadcast(message) {
    const data = JSON.stringify(message);
    clients.forEach((username, client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Litka Chat Server running on port ${PORT}`);
});
