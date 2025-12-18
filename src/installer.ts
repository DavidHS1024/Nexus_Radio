import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import * as seven from 'node-7z';
import * as sevenBin from '7zip-bin';

// URLs de Descarga Directa (Repositorios Estables)
const MPV_URLS = {
    win32: "https://sourceforge.net/projects/mpv-player-windows/files/latest/download", // Descarga .7z
    darwin: "https://laboratory.stolendata.net/~djinn/mpv_osx/mpv-latest.tar.gz",      // Descarga .tar.gz
    linux: "https://github.com/pkgforge-dev/mpv-AppImage/releases/download/continuous/mpv-x86_64.AppImage" // Binario directo
};

export class MpvInstaller {
    private storagePath: string;
    private mpvPath: string;

    constructor(context: vscode.ExtensionContext) {
        // Usamos la carpeta globalStorage para guardar el portable
        this.storagePath = context.globalStorageUri.fsPath;
        
        // Definimos ruta del ejecutable según SO
        const binName = process.platform === 'win32' ? 'mpv.exe' : 'mpv';
        this.mpvPath = path.join(this.storagePath, binName);
        
        // En Mac, a veces viene dentro de mpv.app, ajustaremos post-extracción si es necesario
    }

    public getMpvPath(): string | null {
        return fs.existsSync(this.mpvPath) ? this.mpvPath : null;
    }

    public async checkAndInstall(): Promise<string | null> {
        // 1. Verificar si ya existe localmente
        if (fs.existsSync(this.mpvPath)) {
            return this.mpvPath;
        }

        // 2. Verificar si existe globalmente (PATH)
        // (Retornamos "mpv" para que el controlador use el comando global)
        if (await this.isGlobalMpvAvailable()) {
            return "mpv"; // Usar comando global
        }

        // 3. Si no existe, preguntar al usuario
        const selection = await vscode.window.showInformationMessage(
            "Nexus Radio requiere el motor de audio MPV. ¿Deseas descargarlo automáticamente?",
            "Instalar MPV (Recomendado)", "Cancelar"
        );

        if (selection === "Instalar MPV (Recomendado)") {
            return await this.downloadMpv();
        }

        return null;
    }

    private async downloadMpv(): Promise<string | null> {
        const platform = process.platform;
        let url = "";
        
        if (platform === 'win32') {url = MPV_URLS.win32;}
        else if (platform === 'darwin') {url = MPV_URLS.darwin;}
        else if (platform === 'linux') {url = MPV_URLS.linux;}
        else {
            vscode.window.showErrorMessage("Tu sistema operativo no soporta la instalación automática.");
            return null;
        }

        // Crear carpeta si no existe
        if (!fs.existsSync(this.storagePath)) {
            fs.mkdirSync(this.storagePath, { recursive: true });
        }

        const fileName = platform === 'win32' ? 'mpv_pkg.7z' : (platform === 'linux' ? 'mpv' : 'mpv_pkg.tar.gz');
        const downloadDest = path.join(this.storagePath, fileName);

        return await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Descargando Motor de Audio (MPV)...",
            cancellable: false
        }, async (progress) => {
            try {
                // PASO 1: DESCARGA
                const response = await axios({
                    method: 'GET',
                    url: url,
                    responseType: 'stream'
                });

                const writer = fs.createWriteStream(downloadDest);
                
                // Cálculo simple de progreso (si el servidor da Content-Length)
                const totalLength = response.headers['content-length'];
                let downloaded = 0;

                response.data.on('data', (chunk: any) => {
                    downloaded += chunk.length;
                    if (totalLength) {
                        const pct = Math.round((downloaded / totalLength) * 100);
                        progress.report({ message: `${pct}%`, increment: 0 });
                    }
                });

                response.data.pipe(writer);

                await new Promise<void>((resolve, reject) => {
                    writer.on('finish', () => resolve());
                    writer.on('error', reject);
                });

                // PASO 2: INSTALACIÓN / EXTRACCIÓN
                progress.report({ message: "Instalando..." });

                if (platform === 'linux') {
                    // Linux (AppImage): Solo dar permisos
                    fs.chmodSync(downloadDest, '755');
                    this.mpvPath = downloadDest; // El archivo descargado ES el ejecutable
                } 
                else {
                    // Windows (7z) y Mac (tar.gz): Descomprimir usando 7zip-bin
                    const myStream = seven.extractFull(downloadDest, this.storagePath, {
                        $bin: sevenBin.path7za, // Usamos el binario portable incluido
                        $progress: true
                    });

                    await new Promise<void>((resolve, reject) => {
                        myStream.on('end', () => resolve());
                        myStream.on('error', reject);
                    });

                    // Limpieza: Borrar el comprimido
                    fs.unlinkSync(downloadDest);

                    // Ajuste Mac: El binario suele estar dentro de mpv.app/Contents/MacOS/mpv
                    if (platform === 'darwin') {
                        // Buscamos recursivamente el binario si no está en la raíz
                        if (!fs.existsSync(this.mpvPath)) {
                            const macBinary = path.join(this.storagePath, 'mpv.app', 'Contents', 'MacOS', 'mpv');
                            if (fs.existsSync(macBinary)) {
                                this.mpvPath = macBinary;
                            }
                        }
                    }
                }

                vscode.window.showInformationMessage("Nexus Radio: Motor de audio instalado correctamente.");
                return this.mpvPath;

            } catch (error) {
                vscode.window.showErrorMessage(`Error instalando MPV: ${error}`);
                return null;
            }
        });
    }

    private isGlobalMpvAvailable(): Promise<boolean> {
        return new Promise((resolve) => {
            const cmd = process.platform === 'win32' ? 'where mpv' : 'which mpv';
            const exec = require('child_process').exec;
            exec(cmd, (err: any) => {
                resolve(!err);
            });
        });
    }
}