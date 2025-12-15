import * as cp from 'child_process';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class MpvController {
    private process: cp.ChildProcess | undefined;
    private socket: net.Socket | undefined;
    private pipeName: string;
    
    public isAlive: boolean = false;
    
    private buffer: string = "";
    private metadataCallback: ((title: string) => void) | undefined;
    private exitCallback: ((code: number | null) => void) | undefined;
    private heartbeatCallback: (() => void) | undefined;
    
    // NUEVO: Callback para cambios de pausa
    private pauseCallback: ((paused: boolean) => void) | undefined;

    constructor() {
        const id = Math.random().toString(36).substring(7);
        this.pipeName = process.platform === 'win32' 
            ? `\\\\.\\pipe\\nexus-radio-${id}` 
            : path.join(os.tmpdir(), `nexus-radio-${id}`);
    }

    public onMetadataChange(callback: (title: string) => void) {
        this.metadataCallback = callback;
    }

    public onUnexpectedExit(callback: (code: number | null) => void) {
        this.exitCallback = callback;
    }

    public onHeartbeat(callback: () => void) {
        this.heartbeatCallback = callback;
    }

    // NUEVO: Permite escuchar si el usuario pausó
    public onPauseChange(callback: (paused: boolean) => void) {
        this.pauseCallback = callback;
    }

    public async spawn(url: string, startVolume: number): Promise<void> {
        return new Promise(async (resolve, reject) => {
            try {
                const args = [
                    '--no-video',
                    `--input-ipc-server=${this.pipeName}`, 
                    `--volume=${startVolume}`,
                    '--cache=yes',
                    '--cache-secs=20',
                    '--loop-playlist=force',
                    url
                ];

                this.process = cp.spawn('mpv.com', args);
                this.isAlive = true; 

                this.process.on('close', (code) => {
                    if (this.isAlive && this.exitCallback) {
                        this.exitCallback(code);
                    }
                });

                for (let i = 0; i < 10; i++) {
                    await sleep(200);
                    if (await this.tryConnect()) {
                        resolve();
                        return;
                    }
                }
                this.isAlive = false; 
                reject(new Error("No se pudo conectar al canal IPC"));

            } catch (e) {
                this.isAlive = false;
                reject(e);
            }
        });
    }

    private tryConnect(): Promise<boolean> {
        return new Promise((resolve) => {
            const client = net.createConnection(this.pipeName);
            
            client.on('connect', () => {
                this.socket = client;
                this.sendCommand(["observe_property", 1, "media-title"]);
                this.sendCommand(["observe_property", 2, "time-pos"]);
                // NUEVO: Observamos el estado de pausa (ID 3)
                this.sendCommand(["observe_property", 3, "pause"]);
                resolve(true);
            });

            client.on('data', (data) => {
                this.handleDataChunk(data);
            });

            client.on('error', () => resolve(false));
        });
    }

    private handleDataChunk(data: Buffer) {
        this.buffer += data.toString();
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || "";

        for (const line of lines) {
            if (!line.trim()) {continue;}
            try {
                const json = JSON.parse(line);
                
                if (json.event === 'property-change') {
                    
                    if (json.name === 'media-title') {
                        const newTitle = json.data;
                        if (this.metadataCallback && newTitle) {
                            this.metadataCallback(newTitle);
                        }
                    }
                    
                    if (json.name === 'time-pos') {
                        if (this.heartbeatCallback) {
                            this.heartbeatCallback();
                        }
                    }

                    // NUEVO: Detectar cambio de pausa
                    if (json.name === 'pause') {
                        const isPaused = json.data === true;
                        if (this.pauseCallback) {
                            this.pauseCallback(isPaused);
                        }
                    }
                }
            } catch (e) {}
        }
    }

    public sendCommand(command: any[]) {
        if (this.socket && !this.socket.destroyed) {
            try {
                const message = JSON.stringify({ command }) + '\n';
                this.socket.write(message);
            } catch (e) {}
        }
    }

    public setVolume(vol: number) {
        this.sendCommand(["set_property", "volume", vol]);
    }

    public togglePause() {
        this.sendCommand(["cycle", "pause"]);
    }

    public kill() {
        this.isAlive = false;
        
        if (this.socket) {
            try {
                this.socket.end(); 
                this.socket.destroy();
            } catch (e) {}
        }

        if (this.process && this.process.pid) {
            if (process.platform === 'win32') {
                try {
                    cp.execSync(`taskkill /pid ${this.process.pid} /T /F`);
                } catch (e) {}
            } else {
                this.process.kill();
            }
        }
    }
}