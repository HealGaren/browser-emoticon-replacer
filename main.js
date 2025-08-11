const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch').default;
const WebSocket = require('ws');

// config.json 읽기
const configPath = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const { BaseURL, DebugPort, TimeoutSec, TargetPrefix } = config;

async function fetchDebuggerList() {
    const response = await fetch(`http://localhost:${DebugPort}/json/list`);
    if (!response.ok) {
        throw new Error('Failed to fetch debugger list');
    }
    return response.json();
}

function findWebSocketUrls(debuggerList) {
    return debuggerList
        .filter(item => item && item.url && item.url.startsWith(TargetPrefix))
        .map(item => item.webSocketDebuggerUrl)
        .filter(Boolean);
}

async function connectWebSocket(url) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        ws.on('open', () => resolve(ws));
        ws.on('error', (error) => reject(error));
    });
}

async function sendEvaluateCommand(ws, expression) {
    const command = {
        id: 1,
        method: "Runtime.evaluate",
        params: {
            expression
        }
    };
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Evaluate command timeout'));
        }, TimeoutSec * 1000);

        ws.on('message', (data) => {
            const response = JSON.parse(data);
            if (response.id === command.id) {
                clearTimeout(timeout);
                resolve(response);
            }
        });
        ws.send(JSON.stringify(command));
    });
}

async function main() {
    try {
        const debuggerList = await fetchDebuggerList();
        const webSocketUrls = findWebSocketUrls(debuggerList);
        if (!webSocketUrls.length) {
            throw new Error('WebSocket URL not found');
        }

        for (const webSocketUrl of webSocketUrls) {
            const ws = await connectWebSocket(webSocketUrl);
            console.log('WebSocket connected:', webSocketUrl);

            const expression = `
if (!window['__custom_dccon']) {
    const baseURL = '${BaseURL}';
    const dcConsMapByKeyword = {};

    function prepareDccon() {
        const dcconListByStreamer = document.createElement('script');
        dcconListByStreamer.src = baseURL + '/lib/dccon_list.js';
        document.body.appendChild(dcconListByStreamer);

        return new Promise((resolve, reject) => {
            dcconListByStreamer.onload = resolve;
            dcconListByStreamer.onerror = reject;
        });
    }

    prepareDccon().then(() => {
        window['dcConsData'].forEach(dccon => {
            dccon.keywords.forEach(keyword => dcConsMapByKeyword[keyword] = dccon);
        });
    });

    function appendDCConBeforeNode(keyword, dccon, textNode) {
        const img = document.createElement('img');
        img.src = baseURL + '/images/dccon/' + dccon.name;
        img.alt = keyword;
        img.className = 'dccon';
        img.style.height = '100px';
        textNode.parentNode.insertBefore(img, textNode);
    }

    function onChatTextAdded(textNode) {
        const match = textNode.textContent.match(/^~([^~\\s]+)(?:~([^~\\s]+))?$/);
        if (!match) return;

        const [full, keyword1, keyword2] = match;
        const dccon1 = dcConsMapByKeyword[keyword1];
        const dccon2 = keyword2 ? dcConsMapByKeyword[keyword2] : null;

        if (keyword1 && !dccon1 || keyword2 && !dccon2) {
            console.log('No DCCon found for keyword');
            return;
        }

        if (dccon1) {
            appendDCConBeforeNode(keyword1, dccon1, textNode);
        }
        if (dccon2) {
            appendDCConBeforeNode(keyword2, dccon2, textNode);
        }

        textNode.textContent = '';
    }

    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach((node) => {
                    const textNode = node.querySelector('.chat .text');
                    onChatTextAdded(textNode);
                });
            }
        });
    });

    for (let i = 0; i < document.getElementsByClassName('chat_list').length; i++) {
        const chatList = document.getElementsByClassName('chat_list')[i];
        observer.observe(chatList, {
            childList: true
        });
    }
    window['__custom_dccon'] = true;
    'execute done';
} else {
    'already executed';
}
`;
            const response = await sendEvaluateCommand(ws, expression);
            console.log('Evaluate response:', response);

            ws.close();
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

main();
