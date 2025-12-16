import * as vscode from 'vscode';
import { MpvController } from './mpvController';
import { STATIONS, Station } from './stations';
import { SidebarProvider } from './SidebarProvider';

// Estado Global
let currentStation: MpvController | undefined;
let currentStationData: Station | undefined;
let statusBarItem: vscode.StatusBarItem;
let sidebarProvider: SidebarProvider;

let resurrectionTimeout: NodeJS.Timeout | undefined;
let heartbeatTimeout: NodeJS.Timeout | undefined;
let isManuallyPaused = false;

const TICK_RATE_MS = 40; 

export function activate(context: vscode.ExtensionContext) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'nexus-radio.play';
    context.subscriptions.push(statusBarItem);

    sidebarProvider = new SidebarProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            "nexusRadio.sidebarView",
            sidebarProvider
        )
    );

    // --- COMANDOS ---
    let cmdPlay = vscode.commands.registerCommand('nexus-radio.play', () => {
        const picker = vscode.window.createQuickPick<Station>();
        picker.items = STATIONS;
        picker.placeholder = 'Sintonizar frecuencia...';

        if (currentStationData) {
            const activeItem = picker.items.find(s => s.id === currentStationData?.id);
            if (activeItem) {picker.activeItems = [activeItem];}
        }

        picker.onDidChangeSelection(selection => {
            if (selection[0]) {
                crossfadeTransition(selection[0]);
                picker.hide();
            }
        });

        picker.onDidHide(() => picker.dispose());
        picker.show();
    });

    let cmdStop = vscode.commands.registerCommand('nexus-radio.stop', () => {
        killCurrentStation(true);
        updateStatusBar("off");
    });

    let cmdPlayId = vscode.commands.registerCommand('nexus-radio.playById', (id: string) => {
        const station = STATIONS.find(s => s.id === id);
        if (station) {
            crossfadeTransition(station);
        } else {
            vscode.window.showErrorMessage(`Emisora desconocida: ${id}`);
        }
    });

    let cmdVolume = vscode.commands.registerCommand('nexus-radio.setVolume', (vol: number) => {
        if (currentStation && currentStation.isAlive) {
            currentStation.setVolume(vol);
        }
    });

    let cmdFade = vscode.commands.registerCommand('nexus-radio.setFade', (seconds: number) => {
        const config = vscode.workspace.getConfiguration('nexusRadio');
        config.update('transitionDuration', seconds, vscode.ConfigurationTarget.Global);
    });

    let cmdToggle = vscode.commands.registerCommand('nexus-radio.toggle', () => {
        if (currentStation && currentStation.isAlive) {
            currentStation.togglePause();
        }
    });

    context.subscriptions.push(cmdPlay, cmdStop, cmdPlayId, cmdVolume, cmdFade, cmdToggle);

    context.subscriptions.push({
        dispose: () => {
            killCurrentStation(true);
        }
    });

    updateStatusBar("off");
}

function killCurrentStation(intentional: boolean) {
    // Matamos al Doctor (Heartbeat)
    if (heartbeatTimeout) {
        clearTimeout(heartbeatTimeout);
        heartbeatTimeout = undefined;
    }
    // Matamos al Nigromante (Resurrección pendiente) <--- CORRECCIÓN CRÍTICA
    if (resurrectionTimeout) {
        clearTimeout(resurrectionTimeout);
        resurrectionTimeout = undefined;
    }

    isManuallyPaused = false;

    if (currentStation) {
        if (intentional) {currentStation.kill();}
        else {currentStation.kill();}
        
        currentStation = undefined;
        if (intentional) {currentStationData = undefined;}
    }
}

async function crossfadeTransition(station: Station) {
    updateStatusBar("loading", "Sintonizando...", undefined, station.label, station.gradient);

    const config = vscode.workspace.getConfiguration('nexusRadio');
    const durationSec = config.get<number>('transitionDuration') || 1.5;
    const durationMs = durationSec * 1000;
    const totalSteps = Math.ceil(durationMs / TICK_RATE_MS);
    const volumeStep = 100 / totalSteps;

    const newRadio = new MpvController();
    isManuallyPaused = false;
    
    let isBuffering = false;
    let currentSongTitle = "Cargando...";

    // 1. METADATA
    newRadio.onMetadataChange((songTitle) => {
        if (!songTitle || songTitle.trim() === "-") {return;}
        currentSongTitle = songTitle;
        if (currentStation === newRadio) {
            updateStatusBar("playing", station.label, songTitle, undefined, station.gradient);
        }
    });

    // 2. PAUSA
    newRadio.onPauseChange((paused) => {
        if (currentStation !== newRadio) {return;}
        isManuallyPaused = paused;

        if (paused) {
            if (heartbeatTimeout) {clearTimeout(heartbeatTimeout);}
            updateStatusBar("paused", station.label, "Pausado", undefined, station.gradient);
        } else {
            startHeartbeatMonitor(newRadio, station, isBuffering);
            updateStatusBar("playing", station.label, currentSongTitle, undefined, station.gradient);
        }
    });

    // 3. BUFFERING
    newRadio.onBufferChange((buffering) => {
        if (currentStation !== newRadio) {return;}
        isBuffering = buffering;

        if (buffering) {
            updateStatusBar("loading", station.label, "Buffering...", undefined, station.gradient);
            startHeartbeatMonitor(newRadio, station, true);
        } else {
            updateStatusBar("playing", station.label, currentSongTitle, undefined, station.gradient);
            startHeartbeatMonitor(newRadio, station, false);
        }
    });

    // 4. HEARTBEAT
    newRadio.onHeartbeat(() => {
        if (!isManuallyPaused && currentStation === newRadio) {
            startHeartbeatMonitor(newRadio, station, isBuffering);
        }
    });

    // 5. CRASH
    newRadio.onUnexpectedExit((code) => {
        if (currentStation === newRadio) {
            triggerResurrection(station);
        }
    });

    try {
        await newRadio.spawn(station.url, 0); 
    } catch (error) {
        vscode.window.showErrorMessage(`Error de conexión: ${station.label}`);
        newRadio.kill();
        return;
    }

    if (heartbeatTimeout) {clearTimeout(heartbeatTimeout);}

    const oldRadio = currentStation;
    currentStation = newRadio;
    currentStationData = station; 
    
    // Si nace buffereando, lo marcamos (útil para el Smart Crossfade)
    // Asumimos buffering inicial hasta recibir el primer evento o latido
    isBuffering = true; 
    updateStatusBar("playing", station.label, "Buffering...", undefined, station.gradient);

    // --- SMART CROSSFADE LOOP ---
    let currentStep = 0;
    const interval = setInterval(() => {
        // SEGURIDAD: Si la radio murió durante el fade, abortamos
        if (!newRadio.isAlive) {
            clearInterval(interval);
            return;
        }

        // SMART PAUSE: Si está cargando, NO avanzamos el fade.
        // Esperamos a que tenga datos para que la mezcla sea suave.
        if (isBuffering) {
            return; 
        }

        currentStep++;
        let currentVol = currentStep * volumeStep;
        if (currentVol > 100) {currentVol = 100;}

        const volNew = parseFloat(currentVol.toFixed(1));
        const volOld = parseFloat((100 - currentVol).toFixed(1));

        if (newRadio.isAlive) {newRadio.setVolume(volNew);}
        if (oldRadio && oldRadio.isAlive) {oldRadio.setVolume(volOld);}

        if (currentStep >= totalSteps) {
            clearInterval(interval);
            if (oldRadio) {oldRadio.kill();}
        }
    }, TICK_RATE_MS);
}

function startHeartbeatMonitor(radio: MpvController, station: Station, isBuffering: boolean) {
    if (heartbeatTimeout) {clearTimeout(heartbeatTimeout);}
    
    // HLS necesita más paciencia (30s), un crash es rápido (3s)
    const tolerance = isBuffering ? 30000 : 3000;

    heartbeatTimeout = setTimeout(() => {
        console.warn(`Nexus Doctor: Signos vitales perdidos en ${station.label} (Buffering: ${isBuffering}).`);
        triggerResurrection(station);
    }, tolerance);
}

function triggerResurrection(station: Station) {
    // Limpiamos cualquier intento previo
    if (heartbeatTimeout) {clearTimeout(heartbeatTimeout);}
    if (resurrectionTimeout) {clearTimeout(resurrectionTimeout);}

    // Solo resucitamos si el usuario NO ha matado la radio intencionalmente (currentStationData existe)
    if (!currentStationData) {return;}

    updateStatusBar("loading", station.label, "Señal perdida (Reiniciando...)", undefined, station.gradient);
    
    if (currentStation) {currentStation.kill();}
    
    // Guardamos la referencia para poder cancelarla con el botón de Stop
    resurrectionTimeout = setTimeout(() => {
        // Doble verificación por seguridad
        if (currentStationData) {
            crossfadeTransition(station);
        }
    }, 1000);
}

function updateStatusBar(
    status: "playing" | "off" | "loading" | "paused", 
    stationName?: string, 
    songInfo?: string,
    rawStationName?: string,
    gradient?: string
) {
    if (status === "playing") {
        const displayText = songInfo ? `${stationName} | 🎵 ${songInfo}` : `${stationName}`;
        statusBarItem.text = `$(pulse) ${displayText}`;
    } else if (status === "paused") {
        statusBarItem.text = `$(debug-pause) ${stationName} (Pausado)`;
    } else if (status === "loading") {
        const displayText = songInfo ? `${stationName}: ${songInfo}` : stationName;
        statusBarItem.text = `$(sync~spin) ${displayText}`;
    } else {
        statusBarItem.text = "$(radio-tower) Nexus Radio";
    }
    statusBarItem.show();

    if (sidebarProvider) {
        sidebarProvider.postMessage({
            type: 'status-update',
            status: status,
            station: rawStationName || stationName || "Sin Señal",
            song: songInfo || "...",
            gradient: gradient || ""
        });
    }
}

export function deactivate() {
    killCurrentStation(true);
}