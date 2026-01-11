// Client to server message types
interface SocketRequest {
    requestId: string;
    type: string;
    data?: any;
}

// Coming from server messaget types
interface SocketResponse {
    type: string,
    requestId: string;
    data?: any;
    error?: string;
}

// Type for the promise functions stored in the Map
interface PendingRequest {
    resolve: (data: any) => void;
    reject: (reason: any) => void;
}

class SocketService {
    private socket: WebSocket | null = null;
    private pendingRequests = new Map<string, PendingRequest>();
    private existingProducersHelper: ((data: any[]) => void)[] = [];
    private newProducerArrivesHelper: ((data: any[]) => void)[] = [];
    private producerClosedHelper: ((data: any[]) => void)[] = [];
    private producerPausedHelper: ((data: any[]) => void)[] = [];
    private producerResumedHelper: ((data: any[]) => void)[] = [];


    public connect(url: string): void {
        if (this.socket) return; // Prevent double connection

        this.socket = new WebSocket(url);

        this.socket.onopen = () => {
            console.log('WebSocket Connected');
        };

        this.socket.onmessage = (event: MessageEvent) => {
            //this logic runs when the server sends something
            try {
                const msg: SocketResponse = JSON.parse(event.data);

                if (msg.requestId && this.pendingRequests.has(msg.requestId)) {
                    const { resolve, reject } = this.pendingRequests.get(msg.requestId)!;

                    if (msg.error) {
                        reject(new Error(msg.error));
                    } else {
                        resolve(msg.data);
                    }

                    this.pendingRequests.delete(msg.requestId);
                } else {
                    // Messages for which i am not listening on main ui.
                    console.log("Received Push Notification:", msg);
                    if (msg.type == "connection-success") {
                        console.log("Woahhh")
                    } else if (msg.type == "existing-producers") {
                        console.log(msg.data)
                        this.existingProducersHelper.forEach(cb => cb(msg.data))
                    } else if (msg.type == "new-producer") {
                        this.newProducerArrivesHelper.forEach(cb => cb(msg.data))
                    } else if (msg.type == "producer-closed") {
                        this.producerClosedHelper.forEach(cb => cb(msg.data))
                    } else if (msg.type == "producer-paused") {
                        this.producerPausedHelper.forEach(cb => cb(msg.data))
                    } else if (msg.type == "producer-resumed") {
                        this.producerResumedHelper.forEach(cb => cb(msg.data))
                    }
                }
            } catch (err) {
                console.error("Error parsing WebSocket message", err);
            }
        };

        this.socket.onclose = () => {
            console.log("WebSocket Disconnected");
            this.socket = null;
        };
    }

    public onExistingProducers(cb: (data: any) => void) {
        this.existingProducersHelper.push(cb);
        //returning unsubscribe for clean up
        return () => {
            this.existingProducersHelper = this.existingProducersHelper.filter(fn => fn !== cb);
        }
    }
    public onNewProducerArrives(cb: (data: any) => void) {
        this.newProducerArrivesHelper.push(cb);

        return () => {
            this.newProducerArrivesHelper = this.newProducerArrivesHelper.filter(fn => fn !== cb)
        }
    }
    public onProducerClosed(cb: (data: any) => void) {
        this.producerClosedHelper.push(cb);

        return () => {
            this.producerClosedHelper = this.producerClosedHelper.filter(fn => fn !== cb)
        }
    }

    public onProducerPaused(cb: (data: any) => void) {
        this.producerPausedHelper.push(cb);
        return () => {
            this.producerPausedHelper = this.producerPausedHelper.filter(fn => fn !== cb)
        }
    }
    public onProducerResumed(cb: (data: any) => void) {
        this.producerResumedHelper.push(cb);
        return () => {
            this.producerResumedHelper = this.producerResumedHelper.filter(fn => fn !== cb)
        }
    }



    //send request logic
    public sendRequest<T>(type: string, data: any = {}): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            // 1. Handle case where connect() hasn't been called yet
            if (!this.socket) {
                return reject(new Error("Socket not initialized. Connection logic hasn't run yet."));
            }

            // Helper to send the message once safe
            const send = () => {
                const id = crypto.randomUUID();
                this.pendingRequests.set(id, { resolve, reject });

                const requestPayload: SocketRequest = { type, data, requestId: id };

                // Check if socket is still valid before sending
                if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                    this.socket.send(JSON.stringify(requestPayload));
                } else {
                    reject(new Error("Socket closed before sending"));
                }

                // Timeout safety
                setTimeout(() => {
                    if (this.pendingRequests.has(id)) {
                        this.pendingRequests.delete(id);
                        reject(new Error(`Request ${type} timed out`));
                    }
                }, 5000);
            };

            // 2. Handle Connection States
            if (this.socket.readyState === WebSocket.OPEN) {
                send();
            } else if (this.socket.readyState === WebSocket.CONNECTING) {
                // FIX: Wait for the 'open' event instead of failing
                const onOpen = () => {
                    this.socket?.removeEventListener('open', onOpen); // Cleanup listener
                    send();
                };
                this.socket.addEventListener('open', onOpen);
            } else {
                reject(new Error("Socket is closed."));
            }
        });
    }

}

// Export Singleton
const socketService = new SocketService();
export default socketService;