# browser-emoticon-replacer

브라우저에서 이모티콘을 자동으로 치환하는 스크립트를 원격 디버깅을 통해 주입하는 도구입니다.

## 주요 기능

- 크롬 원격 디버깅 포트에 연결하여 활성 탭을 탐색
- 지정된 prefix가 포함된 모든 WebSocket에 대해 이모티콘 치환 스크립트 실행

## 사용법

1. 크롬을 원격 디버깅 모드로 실행합니다. 포트는 자유롭게 설정합니다.
   ```bash
   chrome.exe --remote-debugging-port=9222
   ```
   
2. 본인의 환경에 맞는 `config.json` 파일을 생성합니다.

   - `config.json`에는 원격 디버깅 포트, prefix 등 주요 설정을 담습니다.
   - 예시:
     ```json
     {
       "BaseURL": "",
       "DebugPort": 9222,
       "TimeoutSec": 10,
       "TargetPrefix": ""
     }
     ```
   - 각 옵션 설명:
     - `BaseURL`: 이모티콘 리소스가 위치한 기본 URL
     - `DebugPort`: 크롬 원격 디버깅에 사용할 포트 번호
     - `TimeoutSec`: 각 명령의 타임아웃(초)
     - `TargetPrefix`: Chrome 디버깅 인스턴스 중 필터링할 prefix 문자열

3. node.js, powershell, exe 파일 중 하나를 선택해 실행합니다. node.js 실행 시에만 디펜던시 설치가 필요합니다.

## 라이선스

MIT
