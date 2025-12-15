import * as vscode from 'vscode';
import { MpvController } from './mpvController';
import { STATIONS, Station } from './stations';
import { SidebarProvider } from './SidebarProvider';

// Estado Global
let currentStation: MpvController | undefined;
let currentStationData: Station | undefined;
let statusBarItem: vscode.StatusBarItem;
let sidebarProvider: SidebarProvider;

// Constante de animación (25Hz)
const TICK_RATE_MS = 40; 

export function activate(context: vscode.ExtensionContext) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'nexus-radio.play';
    context.subscriptions.push(statusBarItem);

    // 1. INICIALIZAMOS EL PANEL
    sidebarProvider = new SidebarProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            "nexusRadio.sidebarView",
            sidebarProvider
        )
    );

    // --- COMANDOS PÚBLICOS ---
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

    // --- COMANDOS INTERNOS (Webview) ---
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

    // ESCUDO ANTI-ZOMBIES
    context.subscriptions.push({
        dispose: () => {
            killCurrentStation(true);
        }
    });

    updateStatusBar("off");
}

function killCurrentStation(intentional: boolean) {
    if (currentStation) {
        if (intentional) {currentStation.kill();}
        else {currentStation.kill();} 
        
        currentStation = undefined;
        if (intentional) {currentStationData = undefined;}
    }
}

async function crossfadeTransition(station: Station) {
    // Gradiente al estado de carga
    updateStatusBar("loading", "Sintonizando...", undefined, station.label, station.gradient);

    const config = vscode.workspace.getConfiguration('nexusRadio');
    const durationSec = config.get<number>('transitionDuration') || 1.5;
    const durationMs = durationSec * 1000;
    const totalSteps = Math.ceil(durationMs / TICK_RATE_MS);
    const volumeStep = 100 / totalSteps;

    const newRadio = new MpvController();

    newRadio.onMetadataChange((songTitle) => {
        if (!songTitle || songTitle.trim() === "-") {return;}
        if (currentStation === newRadio) {
            // Gradiente al actualizar canción
            updateStatusBar("playing", station.label, songTitle, undefined, station.gradient);
        }
    });

    newRadio.onUnexpectedExit((code) => {
        if (currentStation === newRadio) {
            console.warn(`Nexus Alert: Señal perdida. Reconectando...`);
            // Gradiente al reconectar
            updateStatusBar("loading", station.label, "Reconectando señal...", undefined, station.gradient);
            setTimeout(() => {
                if (currentStation === newRadio) {
                    crossfadeTransition(station);
                }
            }, 2000);
        }
    });

    try {
        await newRadio.spawn(station.url, 0); 
    } catch (error) {
        vscode.window.showErrorMessage(`Error de conexión: ${station.label}`);
        newRadio.kill();
        return;
    }

    const oldRadio = currentStation;
    currentStation = newRadio;
    currentStationData = station; 
    
    // Gradiente al estado de buffering
    updateStatusBar("playing", station.label, "Buffering...", undefined, station.gradient);

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

// --- ACTUALIZADA PARA ACEPTAR GRADIENTE ---
function updateStatusBar(
    status: "playing" | "off" | "loading", 
    stationName?: string, 
    songInfo?: string,
    rawStationName?: string,
    gradient?: string
) {
    if (status === "playing") {
        const displayText = songInfo 
            ? `${stationName}  |  🎵 ${songInfo}` 
            : `${stationName}`;
        statusBarItem.text = `$(pulse) ${displayText}`;
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