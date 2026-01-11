import express from 'express'
import http from 'http'
import * as ws from 'ws'
import { WebSocket } from 'ws'
import { type Consumer, type DtlsParameters, type Producer, type Router, type RouterRtpCodecCapability, type RtpCapabilities, type WebRtcTransport, type Worker } from 'mediasoup/types'
import * as mediasoup from 'mediasoup'
import { randomUUID } from 'crypto'
const app = express()
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
const wss = new ws.WebSocketServer({ server: server })
let worker: Worker;

const mediaCodecs: RouterRtpCodecCapability[] = [
    {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
    },
    {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
            'x-google-start-bitrate': 1000
        },
    },
]

interface roomMapType {
    router: Router,
    peers: Map<string, peersMapType>, //socketId, {peerinfo}
    producers: Map<string, producerRoomObject> //producerId, {real producer and it's peer}
}

interface peersMapType {
    socket: WebSocket | null,
    producers: Map<string, Producer>, //producerId, Producer
    consumers: Map<string, Consumer>, //consumerId, Consumer
    transports: {
        senderTransport: WebRtcTransport | null,
        receiverTransport: WebRtcTransport | null,
    }
    /** Peer
    ├── sendTransport
    │    ├── Producer(video)
    │    ├── Producer(audio)
    │    └── Producer(screen)
    │
    └── recvTransport
      ├── Consumer(peerA video)
      ├── Consumer(peerA audio)
      ├── Consumer(peerB video)
      └── Consumer(peerC screen)
    **/
}

interface producerRoomObject {
    producer: Producer,
    ownerPeerId: string
}

let rooms = new Map<string, roomMapType>();

const socketRoomMap = new Map<string, string>();

const initWorker = async () => {
    worker = await mediasoup.createWorker();
}

await initWorker();

wss.on('connection', async (socket: WebSocket) => {
    const socketId = randomUUID();
    socket.on('error', () => {
        console.error('Error occurred')
    })

    socket.on('close', () => {
        const peerRoomId = socketRoomMap.get(socketId);
        const peerRoom = rooms.get(peerRoomId!)
        const peer = peerRoom?.peers.get(socketId)

        //if user leave iwill tell every other peer that he/she left
        peer?.producers.forEach((eachProducer) => {
            peerRoom?.peers.forEach((eachPeer, eachPeerId) => {
                if (eachPeerId !== socketId) {
                    eachPeer?.socket?.send(JSON.stringify({
                        "type": "producer-closed",
                        "data": {
                            "producerId": eachProducer.id
                        }
                    }))
                }
            })
        })


        //closing all consumers
        peer?.consumers.forEach((eachConsumer) => {
            eachConsumer.close();
        })
        peer?.consumers.clear()

        //closing all producers
        peer?.producers.forEach((eachProducer) => {
            eachProducer.close();
            peerRoom?.producers.delete(eachProducer.id);
        })

        //closing the transports
        peer?.transports.senderTransport?.close();
        peer?.transports.receiverTransport?.close();

        //removing peer from the room
        peerRoom?.peers.delete(socketId)
        socketRoomMap.delete(socketId)

        if (peerRoom?.peers.size == 0) {
            peerRoom.router.close();
            rooms.delete(peerRoomId!);
        }
    })

    socket.send(JSON.stringify({
        type: "connection-success",
        data: {
            message: "Server connection successful",
            socketId
        }
    }))

    socket.on('message', async (data: string) => {
        const DATA = JSON.parse(data.toString());

        if (DATA.type == "join-room") {
            if (rooms.has(DATA.data.roomId)) {
                handleUserJoinRoomRequest(DATA, socketId, socket);
            } else {
                const result = await handleNewRoomRequest(DATA, socketId, socket)
                if (!result) {
                    socket.send(JSON.stringify({
                        type: 'room-join-request',
                        data: {
                            "message": "Worker error occured"
                        },
                        id: DATA.requestId
                    }))
                    return;
                }
            }
            socket.send(JSON.stringify({
                type: 'room-join-request',
                data: {
                    "message": "The User Joined in the room",
                    "UsersInRoom": rooms.get(DATA.data.roomId)?.peers.size,
                },
                requestId: DATA.requestId
            }))
        }
        else if (DATA.type == "getRtpCapabilities") {
            handleGetRtpCapabilities(socketId, socket, DATA.requestId);
        } else if (DATA.type == "createWebRtcTransport") {
            const peer = rooms.get(socketRoomMap.get(socketId)!)?.peers.get(socketId);
            if (DATA.data.sender == true) {
                console.log(DATA)
                const senderTransport: WebRtcTransport | undefined = await handleCreateWebRtcTransport(socketId, socket, DATA.requestId);
                if (senderTransport == undefined) {
                    console.log(senderTransport) //I am gettign thsi undefined
                    return
                }
                peer!.transports.senderTransport = senderTransport;
            } else {
                const receiverTransport: WebRtcTransport | undefined = await handleCreateWebRtcTransport(socketId, socket, DATA.requestId);
                if (!receiverTransport) {
                    console.error("Error occurred");
                    return;
                }
                peer!.transports.receiverTransport = receiverTransport;
            }
        } else if (DATA.type == "transport-connect") {
            console.log("Sender Client's DTls parameters: ", { DATA });
            await handleTransportConnect(true, socketId, DATA.requestId, DATA.data.dtlsParameters, socket);
        } else if (DATA.type == "transport-produce") {
            /**
             * {
              kind: parameters.kind,
              rtpParameters: parameters.rtpParameters,
              appData: parameters.appData,
            }
             */

            await handleProduceTransport(DATA.data, socket, socketId, DATA.requestId)
        } else if (DATA.type == "transport-recv-connect") {
            console.log("Reciever Client's DTLS parameters: ", { DATA })
            await handleTransportConnect(false, socketId, DATA.requestId, DATA.data.dtlsParameters, socket);
        } else if (DATA.type == "consume") {
            //rtpCapabitlities and producerId(this tells us which producer to consume.)
            console.log(DATA)
            await handleConsume(DATA.data.rtpCapabilities, DATA.data.producerId, socketId, socket, DATA.requestId)
        } else if (DATA.type == "consumer-resume") {
            console.log("hI")
            await handleConsumerResume(socket, DATA.data.consumerId, socketId, DATA.requestId);
        } else if (DATA.type == "producer-pause") {
            const peer = rooms.get(socketRoomMap.get(socketId)!)?.peers.get(socketId);
            const producer = peer?.producers.get(DATA.data.producerId);

            if (producer) {
                await producer.pause();

                //Notify all other peers that this producer is paused

                const peerRoom = rooms.get(socketRoomMap.get(socketId)!);
                peerRoom?.peers.forEach((eachPeer, eachPeerId) => {
                    if (eachPeerId !== socketId) {
                        eachPeer.socket?.send(JSON.stringify({
                            type: "producer-pause",
                            data: {
                                producerId: DATA.data.producerId
                            }
                        }));
                    }
                });
            }
            socket.send(JSON.stringify({
                requestId: DATA.requestId,
                data: {}
            }))
        } else if (DATA.type == "producer-resume") {
            const peer = rooms.get(socketRoomMap.get(socketId)!)?.peers.get(socketId);
            const producer = peer?.producers.get(DATA.data.producerId);

            if (producer) {
                await producer.resume();

                //Notify all the other pers that his producer is resumed
                const peerRoom = rooms.get(socketRoomMap.get(socketId)!);
                peerRoom?.peers.forEach((eachPeer, eachPeerId) => {
                    if (eachPeerId !== socketId) {
                        eachPeer.socket?.send(JSON.stringify({
                            type: "producer-resumed",
                            data: {
                                producerId: DATA.data.producerId
                            }
                        }))
                    }
                })
            }

            socket.send(JSON.stringify({
                requestId: DATA.requestId,
                data: {}
            }))
        }
    })
})

const handleConsumerResume = async (socket: WebSocket, consumerId: any, socketId: string, requestId: string) => {
    const peer = rooms.get(socketRoomMap.get(socketId)!)?.peers.get(socketId);

    await peer?.consumers.get(consumerId)?.resume();

    socket.send(JSON.stringify({
        requestId,
        data: {}
    }))

}

const handleConsume = async (rtpCapabilities: RtpCapabilities, producerId: any, socketId: string, socket: WebSocket, requestId: string) => {
    try {

        const peerRoom = rooms?.get(socketRoomMap.get(socketId)!);
        const peer = peerRoom?.peers.get(socketId)
        if (!peer || !peer.transports.receiverTransport) return;

        if (!peerRoom || peerRoom?.producers.size! <= 0) {
            console.error("There are no producers to consume")
            socket.send(JSON.stringify({
                requestId,
                data: {
                    error: "There is nothing to consume"
                }
            }))
            return;
        }

        // router issues
        if (!peerRoom.router.canConsume({
            producerId: producerId,
            rtpCapabilities
        })) {
            return socket.send(JSON.stringify({
                requestId,
                data: {
                    message: "Unable to consume this producer."
                }
            }))
        }
        else {

            const consumer = await peer.transports.receiverTransport.consume({
                producerId: producerId,
                rtpCapabilities,
                paused: true,
            })

            //adding the consumer to the peer information :- 
            const consumerId = consumer.id;
            peer.consumers.set(consumerId, consumer);

            consumer.on('transportclose', () => {
                console.log("Transport close from customer")
            })

            consumer.on('producerclose', () => {
                console.log("Producer close")
            })

            const response = {
                requestId,
                data: {
                    id: consumer.id,
                    producerId: producerId,
                    kind: consumer.kind,
                    rtpParameters: consumer.rtpParameters
                }
            }

            socket.send(JSON.stringify(response))
        }
    } catch (error) {
        console.log(error);
        socket.send(JSON.stringify({
            requestId,
            error: error || "Internal Server Error"
        }))
    }
}

const handleProduceTransport = async (data: any, socket: WebSocket, socketId: string, requestId: string) => {
    try {

        const peerRoom = rooms?.get(socketRoomMap.get(socketId)!);
        const peer = peerRoom?.peers.get(socketId);

        let producer: Producer | undefined = await peer?.transports.senderTransport?.produce({
            kind: data.kind,
            rtpParameters: data.rtpParameters
        })

        if (!producer) {
            console.error("Producer creation error in produceTransport");
            return;
        }

        let producerId = producer?.id;
        //adding the producer in the peers producers list.
        peer?.producers.set(producerId, producer);
        //adding the producer in the producer list of room
        const roomProducer: producerRoomObject = {
            producer: producer,
            ownerPeerId: socketId
        }
        peerRoom?.producers.set(producerId, roomProducer);

        //notifying all the peers that we have a new producer
        peerRoom?.peers.forEach((eachPeer, eachPeerId) => {
            if (eachPeerId !== socketId) {
                eachPeer.socket?.send(JSON.stringify({
                    type: 'new-producer',
                    data: { producerId, kind: producer.kind }
                }))
            }
        })

        //--

        //if the producer get close so on it's transport close we will notify all the peers that this producer is no longer producing.
        producer.on('transportclose', () => {
            console.log('Transport for this producer closed')
            peerRoom?.peers.forEach((eachPeer, eachPeerId) => {
                if (eachPeerId !== socketId) {
                    eachPeer?.socket?.send(JSON.stringify({
                        "type": "producer-closed",
                        "data": {
                            "producerId": producer.id
                        }
                    }))
                }
            })
            producer.close();
        })


        //sending the id to the client for callback()
        const response = {
            requestId,
            data: {
                id: producer.id,
            }
        }
        socket.send(JSON.stringify(response))

    } catch (error) {
        console.error(error);
        socket.send(JSON.stringify({
            requestId,
            data: {
                error: error
            }
        }))
    }
}


const handleTransportConnect = async (isSender: boolean, socketId: string, requestId: string, dtlsParameters: DtlsParameters, socket: WebSocket) => {
    const peer = rooms.get(socketRoomMap.get(socketId)!)?.peers.get(socketId);
    if (isSender) {
        await peer?.transports.senderTransport?.connect({ dtlsParameters })
    } else {
        await peer?.transports.receiverTransport?.connect({ dtlsParameters })
    }

    const response = {
        requestId,
        data: {}
    }
    socket.send(JSON.stringify(response))
    return true;
}

const handleCreateWebRtcTransport = async (socketId: string, socket: WebSocket, requestId: string) => {
    try {
        const webRtcTransport_options = {
            listenIps: [
                {
                    ip: process.env.IP || "0.0.0.0",
                    announcedIp: process.env.ANNOUNCEDIP || "mediasoup-app.onrender.com",
                },

            ],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true
        }

        let peerRoom: string | undefined = socketRoomMap.get(socketId);
        let router: Router | undefined = rooms.get(peerRoom!)?.router;
        let transport: WebRtcTransport | undefined = await router?.createWebRtcTransport(webRtcTransport_options);

        transport?.on('dtlsstatechange', dtlsState => {
            if (dtlsState === 'closed') {
                transport.close();
            }
        })

        transport?.on('@close', () => {
            console.log('transport closed')
        })

        const response = {
            data: {
                id: transport?.id,
                iceParameters: transport?.iceParameters,
                iceCandidates: transport?.iceCandidates,
                dtlsParameters: transport?.dtlsParameters
            },
            requestId: requestId
        }

        socket.send(JSON.stringify(response));
        return transport;

    } catch (error) {
        socket.send(JSON.stringify({
            data: {
                error: error
            },
            requestId
        }))

        return;
    }
}

const handleGetRtpCapabilities = (socketId: string, socket: WebSocket, requestId: string) => {
    const userRoomId = socketRoomMap.get(socketId);
    console.log(userRoomId)
    const rtpCapabilities = rooms.get(userRoomId!)?.router.rtpCapabilities;
    console.log("Client requested RTPCapabilities", rtpCapabilities);

    const response = {
        data: rtpCapabilities,
        requestId: requestId
    }

    socket.send(JSON.stringify(response))
}

const handleUserJoinRoomRequest = (DATA: { type: string; data: { roomId: string }, requestId: string }, socketId: string, socket: WebSocket) => {
    //set the user in the room.
    rooms.get(DATA.data.roomId)?.peers.set(socketId, {
        socket: socket,
        producers: new Map(),
        consumers: new Map(),
        transports: {
            senderTransport: null,
            receiverTransport: null
        }
    })
    //mapping this user to it's room.
    socketRoomMap.set(socketId, DATA.data.roomId)


    const allProducersInRoom = rooms.get(DATA.data.roomId)?.producers;
    const producersList = Array.from(allProducersInRoom?.entries() || []).map(([producerId, producerObj]) => ({
        producerId,
        kind: producerObj.producer.kind
    }));

    socket.send(JSON.stringify({
        type: "existing-producers",
        data: producersList,
        roomId: DATA.data.roomId
    }))
}

const handleNewRoomRequest = async (DATA: { type: string; data: { roomId: string }, requestId: string }, socketId: string, socket: WebSocket) => {
    //this will create the new room.
    if (!worker) {
        return false;
    }

    rooms.set(DATA.data.roomId, {
        router: await worker.createRouter({ mediaCodecs }),
        peers: new Map(),
        producers: new Map()
    })

    //now we will add the guy who requested for this room.
    rooms.get(DATA.data.roomId)?.peers.set(socketId, {
        socket: socket,
        producers: new Map(),
        consumers: new Map(),
        transports: {
            senderTransport: null,
            receiverTransport: null
        }
    })

    //mapping this user to it's room.
    socketRoomMap.set(socketId, DATA.data.roomId)

    const allProducersInRoom = rooms.get(DATA.data.roomId)?.producers;
    const producersList = Array.from(allProducersInRoom?.entries() || []).map(([producerId, producerObj]) => ({
        producerId,
        kind: producerObj.producer.kind
    }));

    socket.send(JSON.stringify({
        type: "existing-producers",
        data: producersList || [],
        roomId: DATA.data.roomId
    }))

    return true;

}

server.listen(PORT, () => {
    console.log("Server is listening")
})
