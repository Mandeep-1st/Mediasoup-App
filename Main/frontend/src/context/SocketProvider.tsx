// context/SocketProvider.tsx
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import socketService from "../services/SocketService";

type SocketServiceType = typeof socketService;

const SocketContext = createContext<SocketServiceType>(socketService);

interface ProviderProps {
  children: ReactNode;
}

export const SocketProvider: React.FC<ProviderProps> = ({ children }) => {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // 1. Initialize the connection
    socketService.connect("wss://192.168.29.157:3000");
    // 2. Mark as ready immediately after (since socketService.socket is now defined)
    setIsReady(true);
  }, []);

  if (!isReady) {
    return (
      <div className="flex h-screen items-center justify-center">
        <h1>Connecting to server...</h1>
      </div>
    );
  }

  return (
    <SocketContext.Provider value={socketService}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = (): SocketServiceType => useContext(SocketContext);
