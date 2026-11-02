// A fake of this computer's part (`LocalPort`, finding 72): its state set by the test, its intents recorded.
import type { LocalPort, LocalViewPort, StarterFilePort, WorkerOsPort } from '../../../src/admin/worker/worker-port.js';

export class FakeLocal implements LocalPort {
    readonly calls: string[] = [];
    readonly #listeners = new Set<(state: LocalViewPort) => void>();
    state: LocalViewPort = { os: 'linux', phase: 'none', code: null };
    /** What Use this computer and Stop using this computer give (null: the file could not be made). */
    file: StarterFilePort | null = { name: 'hcm-worker.sh', text: "HCM_CITY='bucharest'\n" };

    readonly intents = {
        setOs: (os: WorkerOsPort): void => {
            this.calls.push(`setOs ${os}`);
            this.set({ os });
        },
        use: (): Promise<StarterFilePort | null> => {
            this.calls.push('use');
            return Promise.resolve(this.file);
        },
        stop: (): Promise<StarterFilePort | null> => {
            this.calls.push('stopUsing');
            return Promise.resolve(this.file);
        },
        command: (): Promise<void> => {
            this.calls.push('command');
            this.set({ code: 'abcdefghijklmnopqrstuvwxyz' });
            return Promise.resolve();
        },
    };

    subscribe(listener: (state: LocalViewPort) => void): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    start(): void {
        this.calls.push('start');
    }

    stop(): void {
        this.calls.push('stop');
    }

    set(changes: Partial<LocalViewPort>): void {
        this.state = { ...this.state, ...changes };
        for (const listener of this.#listeners) {
            listener(this.state);
        }
    }
}
