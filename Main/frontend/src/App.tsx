import { BrowserRouter, Route, Routes } from "react-router-dom";
import Start from "./pages/Start";
import { CreateRoom } from "./pages/CreateRoom";
// import ProviderVideo from "./pages/ProviderVideo";
// import ReceiverVideo from "./pages/ReceiverVideo";
import { SocketProvider } from "./context/SocketProvider";
import { Space } from "./pages/Space";
import { JoinRoom } from "./pages/JoinRoom";

function App() {
  return (
    <SocketProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Start />} />
          <Route path="/create-space" element={<CreateRoom />} />
          <Route path="/join-space" element={<JoinRoom />} />
          <Route path="/space/:roomName" element={<Space />} />
        </Routes>
      </BrowserRouter>
    </SocketProvider>
  );
}

export default App;
