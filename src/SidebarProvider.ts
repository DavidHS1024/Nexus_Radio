import * as vscode from "vscode";
import { STATIONS } from "./stations";

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "nexusRadio.sidebarView";
  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case "play": {
          if (!data.stationId) {return;}
          vscode.commands.executeCommand("nexus-radio.playById", data.stationId);
          break;
        }
        case "toggle": {
          vscode.commands.executeCommand("nexus-radio.toggle");
          break;
        }
        case "stop": {
          vscode.commands.executeCommand("nexus-radio.stop");
          break;
        }
        case "volume": {
          vscode.commands.executeCommand("nexus-radio.setVolume", Number(data.value));
          break;
        }
        case "fade": {
          vscode.commands.executeCommand("nexus-radio.setFade", Number(data.value));
          break;
        }
      }
    });
  }

  public postMessage(packet: any) {
    if (this._view) {
      this._view.webview.postMessage(packet);
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const iconMap: { [key: string]: string } = {
        'radio-tower': '📡',
        'heart': '💜',
        'terminal': '💻',
        'rocket': '🚀',
        'beaker': '🧪',
        'zap': '⚡',
        'bug': '👾',
        'flame': '🔥'
    };

    const stationsHtml = STATIONS.map((station) => {
        const emoji = iconMap[station.icon] || '🎵';
        return `
        <div class="station-card" onclick="selectStation('${station.id}')" title="${station.description}">
            <div class="icon-box" style="background: ${station.gradient}">
                ${emoji}
            </div>
            <div class="station-info">
                <div class="station-name">${station.label}</div>
                <div class="station-desc">${station.description.split(' - ')[0]}</div>
            </div>
        </div>
        `;
    }).join("");

    // SVG Estáticos para carga inicial
    const playSvg = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
    const powerSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>`;

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'unsafe-inline'; img-src * data:;">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      
      <style>
        * { box-sizing: border-box; }

        :root {
            --primary: #00f3ff;
            --bg-glass: rgba(255, 255, 255, 0.05);
            --border-glass: rgba(255, 255, 255, 0.1);
            --card-hover: rgba(255, 255, 255, 0.1);
        }

        body { 
            font-family: var(--vscode-font-family); 
            padding: 10px; 
            margin: 0;
            color: var(--vscode-editor-foreground);
            background: transparent;
            user-select: none;
            overflow-x: hidden;
            width: 100%;
        }

        /* VISUALIZER */
        .visualizer-container {
            height: 120px;
            width: 100%;
            border-radius: 12px;
            margin-bottom: 15px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            position: relative;
            overflow: hidden;
            border: 1px solid var(--border-glass);
            background: #0a0a0a;
            transition: border-color 0.5s ease;
        }

        .visualizer-bg {
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            opacity: 0;
            transition: opacity 1s ease, background 1s ease;
            z-index: 0;
        }

        .visualizer-container.active .visualizer-bg {
            opacity: 0.8;
            animation: breathe 4s infinite alternate;
        }

        @keyframes breathe {
            0% { filter: brightness(0.8) blur(10px); }
            100% { filter: brightness(1.2) blur(15px); }
        }

        .now-playing-title {
            position: relative;
            font-size: 14px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 1px;
            text-shadow: 0 2px 8px rgba(0,0,0,0.8);
            z-index: 2;
        }

        .now-playing-song {
            position: relative;
            font-size: 11px;
            opacity: 0.9;
            margin-top: 5px;
            z-index: 2;
            max-width: 90%;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            text-shadow: 0 1px 5px rgba(0,0,0,0.8);
        }

        /* CONTROLES */
        .controls-row {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
            width: 100%;
        }

        .btn-control {
            flex: 1;
            height: 40px;
            border: none;
            border-radius: 8px;
            background: var(--bg-glass);
            color: var(--vscode-editor-foreground);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
            border: 1px solid var(--border-glass);
        }

        .btn-control:hover {
            background: var(--card-hover);
            border-color: var(--primary);
            color: var(--primary);
        }
        
        .btn-control:active { transform: scale(0.95); }

        .btn-control svg { width: 20px; height: 20px; }
        .btn-off:hover { color: #ff4757; border-color: #ff4757; }

        /* SLIDERS */
        .slider-section {
            background: var(--bg-glass);
            padding: 10px;
            border-radius: 8px;
            margin-bottom: 20px;
            width: 100%;
        }
        .slider-row {
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 10px;
            width: 100%;
        }
        
        input[type=range] {
            flex: 1;
            width: 100%;
            min-width: 0;
            accent-color: var(--primary);
            cursor: pointer;
            margin: 0;
        }

        /* GRID */
        .station-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
            width: 100%;
        }

        .station-card {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 8px;
            border-radius: 8px;
            background: transparent;
            border: 1px solid transparent;
            cursor: pointer;
            transition: all 0.2s;
            width: 100%;
        }

        .station-card:hover {
            background: var(--bg-glass);
            border-color: var(--border-glass);
            transform: translateX(4px);
        }

        .icon-box {
            width: 36px;
            height: 36px;
            min-width: 36px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            box-shadow: 0 4px 10px rgba(0,0,0,0.3);
        }

        .station-info {
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .station-name {
            font-size: 12px;
            font-weight: 600;
            white-space: nowrap;
        }
        .station-desc {
            font-size: 10px;
            opacity: 0.6;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
      </style>
    </head>
    <body>

        <div class="visualizer-container" id="visualizer">
            <div class="visualizer-bg" id="vis-bg"></div>
            <div class="now-playing-title" id="ui-station">NEXUS RADIO</div>
            <div class="now-playing-song" id="ui-song">System Ready</div>
        </div>

        <div class="controls-row">
            <button id="btn-toggle" class="btn-control" onclick="togglePlay()" title="Play / Pause">
                ${playSvg}
            </button>
            <button class="btn-control btn-off" onclick="stopRadio()" title="Apagar Sistema">
                ${powerSvg}
            </button>
        </div>

        <div class="slider-section">
            <div class="slider-row">
                <span>VOL</span>
                <input type="range" id="vol-slider" min="0" max="100" value="100">
                <span id="vol-val">100%</span>
            </div>
            <div class="slider-row" style="margin-top:5px; opacity:0.6">
                <span>FADE</span>
                <input type="range" id="fade-slider" min="0.5" max="5" step="0.5" value="1.5">
                <span id="fade-val">1.5s</span>
            </div>
        </div>

        <div class="station-list">
            ${stationsHtml}
        </div>

        <script>
            const vscode = acquireVsCodeApi();
            
            const uiStation = document.getElementById('ui-station');
            const uiSong = document.getElementById('ui-song');
            const visualizer = document.getElementById('visualizer');
            const visBg = document.getElementById('vis-bg');
            const btnToggle = document.getElementById('btn-toggle'); // Referencia al botón
            const volSlider = document.getElementById('vol-slider');
            const volText = document.getElementById('vol-val');
            const fadeSlider = document.getElementById('fade-slider');
            const fadeText = document.getElementById('fade-val');

            // ICONOS DINÁMICOS
            const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
            const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';

            window.addEventListener('message', event => {
                const msg = event.data;
                if (msg.type === 'status-update') {
                    // Texto
                    if (msg.station) uiStation.innerText = msg.station;
                    if (msg.song) uiSong.innerText = msg.song;

                    // Estado Visual y Botones
                    if (msg.status === 'playing') {
                        visualizer.classList.add('active');
                        btnToggle.innerHTML = ICON_PAUSE; // Cambiar a Pausa
                        
                        if (msg.gradient) visBg.style.background = msg.gradient;
                    } 
                    else if (msg.status === 'paused') {
                        visualizer.classList.remove('active');
                        btnToggle.innerHTML = ICON_PLAY; // Cambiar a Play
                    }
                    else {
                        // Estado OFF o Loading
                        visualizer.classList.remove('active');
                        btnToggle.innerHTML = ICON_PLAY;
                        if (msg.status === 'off') uiSong.innerText = "Standby";
                    }
                }
            });

            function selectStation(id) { vscode.postMessage({ type: 'play', stationId: id }); }
            function togglePlay() { vscode.postMessage({ type: 'toggle' }); }
            function stopRadio() { vscode.postMessage({ type: 'stop' }); }

            let lastVolTime = 0;
            volSlider.addEventListener('input', (e) => {
                const val = e.target.value;
                volText.innerText = val + '%';
                const now = Date.now();
                if (now - lastVolTime > 50) {
                    vscode.postMessage({ type: 'volume', value: val });
                    lastVolTime = now;
                }
            });
            volSlider.addEventListener('change', (e) => {
                vscode.postMessage({ type: 'volume', value: e.target.value });
            });

            fadeSlider.addEventListener('input', (e) => { fadeText.innerText = e.target.value + 's'; });
            fadeSlider.addEventListener('change', (e) => { vscode.postMessage({ type: 'fade', value: e.target.value }); });

        </script>
    </body>
    </html>`;
  }
}