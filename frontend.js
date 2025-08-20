// CSS 변수에서 값 읽기
function logMessage(msg) {
    const logDiv = document.getElementById('log');
    if (logDiv) {
        const now = new Date().toLocaleTimeString();
        logDiv.textContent += `[${now}] ${msg}\n`;
        logDiv.scrollTop = logDiv.scrollHeight;
    }
}

async function fetchDebuggerList(DebugPort) {
    logMessage(`디버거 리스트를 가져오는 중...`);
    try {
        const response = await fetch(`http://localhost:${DebugPort}/json/list`);
        if (!response.ok) throw new Error('Failed to fetch debugger list');
        logMessage(`디버거 리스트 가져오기 성공`);
        return response.json();
    } catch (err) {
        logMessage(`디버거 리스트 가져오기 실패: ${err.message}`);
        throw err;
    }
}

function findWebSocketUrls(debuggerList, TargetPrefix) {
    logMessage(`WebSocket 대상 필터링...`);
    const urls = debuggerList
        .filter(item => item && item.url && item.url.startsWith(TargetPrefix))
        .map(item => item.webSocketDebuggerUrl)
        .filter(Boolean);
    logMessage(`WebSocket 대상 ${urls.length}개 발견`);
    return urls;
}

function connectWebSocket(url) {
    logMessage(`WebSocket 연결 시도: ${url}`);
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        ws.onopen = () => {
            logMessage(`WebSocket 연결 성공`);
            resolve(ws);
        };
        ws.onerror = (error) => {
            logMessage(`WebSocket 연결 실패`);
            reject(error);
        };
    });
}

function sendEvaluateCommand(ws, expression, TimeoutSec) {
    logMessage(`스크립트 실행 명령 전송...`);
    const command = {
        id: 1,
        method: "Runtime.evaluate",
        params: { expression }
    };
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            logMessage('스크립트 실행 응답 대기 시간 초과');
            reject(new Error('Evaluate command timeout'));
        }, TimeoutSec * 1000);
        ws.onmessage = (event) => {
            const response = JSON.parse(event.data);
            if (response.id === command.id) {
                clearTimeout(timeout);
                logMessage('스크립트 실행 응답 수신');
                resolve(response);
            }
        };
        ws.send(JSON.stringify(command));
    });
}

async function main() {
    // CSS 변수에서 값 읽기 (매번 최신값으로 갱신)
    const style = getComputedStyle(document.documentElement);
    const BaseURL = style.getPropertyValue('--base-url').replace(/['"]/g, '').trim();
    const DebugPort = style.getPropertyValue('--debug-port').replace(/['"]/g, '').trim();
    const TargetPrefix = style.getPropertyValue('--target-prefix').replace(/['"]/g, '').trim();
    const TimeoutSec = 5;

    logMessage('실행 시작');
    try {
        const debuggerList = await fetchDebuggerList(DebugPort);
        const webSocketUrls = findWebSocketUrls(debuggerList, TargetPrefix);
        if (!webSocketUrls.length) {
            logMessage('WebSocket URL을 찾을 수 없습니다.');
            throw new Error('WebSocket URL not found');
        }

        for (const webSocketUrl of webSocketUrls) {
            let ws;
            try {
                ws = await connectWebSocket(webSocketUrl);
            } catch (err) {
                logMessage(`WebSocket 연결 실패: ${err.message}`);
                continue;
            }

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
            try {
                const response = await sendEvaluateCommand(ws, expression, TimeoutSec);
                logMessage(`스크립트 실행 결과: ${JSON.stringify(response.result)}`);
            } catch (err) {
                logMessage(`스크립트 실행 실패: ${err.message}`);
            }
            ws.close();
            logMessage('WebSocket 연결 종료');
        }
    } catch (error) {
        logMessage(`오류 발생: ${error.message}`);
        console.error('Error:', error);
    }
    logMessage('실행 종료');
}

function isObsCssReady() {
    const style = getComputedStyle(document.documentElement);
    return style.getPropertyValue('--obs-css-ready').replace(/['"]/g, '').trim() === '1';
}

let tryCount = 0;
const maxTry = 5;

function tryRunMain() {
    tryCount++;
    if (isObsCssReady()) {
        logMessage('OBS CSS가 로드됨을 감지했습니다. 스크립트 실행!');
        main();
    } else if (tryCount < maxTry) {
        logMessage(`OBS CSS가 아직 준비되지 않았습니다. ${3 * tryCount}초 후 재시도 (${tryCount}/${maxTry})`);
        setTimeout(tryRunMain, 3000);
    } else {
        logMessage('OBS CSS가 준비되지 않아 스크립트 실행을 중단합니다.');
    }
}

// 페이지 로드 시 0.1초 후 첫 시도
window.addEventListener('DOMContentLoaded', () => {
    setTimeout(tryRunMain, 100);
});
