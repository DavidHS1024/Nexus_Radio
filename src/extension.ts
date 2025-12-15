import * as vscode from 'vscode';
import { MpvController } from './mpvController';
import { STATIONS, Station } from './stations';
import { SidebarProvider } from './SidebarProvider';

// Estado Global
let currentStation: MpvController | undefined;
let currentStationData: Station | undefined;
let statusBarItem: vscode.StatusBarItem;
let sidebarProvider: SidebarProvider;

// CRONÓMETRO VITAL (El Doctor)
let heartbeatTimeout: NodeJS.Timeout | undefined;

// ESTADO DE PAUSA (Para evitar falsos positivos del Doctor)
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
    // Apagamos el monitor cardíaco inmediatamente
    if (heartbeatTimeout) {
        clearTimeout(heartbeatTimeout);
        heartbeatTimeout = undefined;
    }
    isManuallyPaused = false; // Reset de estado

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
    isManuallyPaused = false; // Nace reproduciendo

    // 1. METADATA
    newRadio.onMetadataChange((songTitle) => {
        if (!songTitle || songTitle.trim() === "-") {return;}
        if (currentStation === newRadio) {
            updateStatusBar("playing", station.label, songTitle, undefined, station.gradient);
        }
    });

    // 2. DETECTOR DE PAUSA (La solución inteligente)
    newRadio.onPauseChange((paused) => {
        if (currentStation !== newRadio) {return;}

        isManuallyPaused = paused;

        if (paused) {
            // SI PAUSAMOS: Dormimos al Doctor y actualizamos UI
            if (heartbeatTimeout) {clearTimeout(heartbeatTimeout);}
            // Enviamos estado 'paused' para que el panel cambie el icono
            updateStatusBar("paused", station.label, "Pausado", undefined, station.gradient);
        } else {
            // SI REANUDAMOS: Despertamos al Doctor
            startHeartbeatMonitor(newRadio, station);
            // Recuperamos el estado 'playing'
            updateStatusBar("playing", station.label, "Reanudando...", undefined, station.gradient);
        }
    });

    // 3. MONITOR DE LATIDOS (El Doctor)
    newRadio.onHeartbeat(() => {
        // Solo monitoreamos si NO está pausado manualmente
        if (!isManuallyPaused && currentStation === newRadio) {
            startHeartbeatMonitor(newRadio, station);
        }
    });

    // 4. MUERTE SÚBITA
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
    
    updateStatusBar("playing", station.label, "Buffering...", undefined, station.gradient);

    // Crossfade Loop
    let currentStep = 0;
    const interval = setInterval(() => {
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

// Helper para iniciar/reiniciar el temporizador de muerte
function startHeartbeatMonitor(radio: MpvController, station: Station) {
    if (heartbeatTimeout) {clearTimeout(heartbeatTimeout);}
    
    heartbeatTimeout = setTimeout(() => {
        // Si entramos aquí, pasaron 10 segundos sin latidos Y no estaba pausado
        console.warn(`Nexus Doctor: Paro cardíaco en ${station.label}.`);
        triggerResurrection(station);
    }, 10000);
}

function triggerResurrection(station: Station) {
    if (heartbeatTimeout) {clearTimeout(heartbeatTimeout);}
    updateStatusBar("loading", station.label, "Señal inestable (Reconectando...)", undefined, station.gradient);
    
    if (currentStation) {currentStation.kill();}
    // Reintentamos en 2s
    setTimeout(() => {
        crossfadeTransition(station);
    }, 2000);
}

// Actualizada para manejar estado "paused"
function updateStatusBar(
    status: "playing" | "off" | "loading" | "paused", // <--- Aceptamos "paused"
    stationName?: string, 
    songInfo?: string,
    rawStationName?: string,
    gradient?: string
) {
    if (status === "playing") {
        const displayText = songInfo ? `${stationName} | 🎵 ${songInfo}` : `${stationName}`;
        statusBarItem.text = `$(pulse) ${displayText}`;
    } else if (status === "paused") {
        // Icono de pausa en la barra inferior
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
            status: status, // Enviamos "paused" o "playing" al frontend
            station: rawStationName || stationName || "Sin Señal",
            song: songInfo || "...",
            gradient: gradient || ""
        });
    }
}

export function deactivate() {
    killCurrentStation(true);
}