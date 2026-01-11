import { useState } from "react";
import { useSocket } from "../context/SocketProvider";
import { useNavigate } from "react-router-dom";

export const JoinRoom = () => {
  const [roomName, setRoomName] = useState<string>("");
  const socket = useSocket();
  const navigate = useNavigate();
  const handleJoinRoom = async () => {
    navigate(`/space/${roomName}`, { state: roomName });
  };
  return (
    <div className="flex-col mx-130 my-50">
      <h1>Insert the roomname</h1>
      <div className="flex justify-center items-baseline">
        <input
          onChange={(e) => setRoomName(e.target.value)}
          className="border-black bg-gray-200 text-black text-2xl cursor-text mt-10"
          placeholder="Enter here"
          type="text"
        />
        <button className="m-5" onClick={() => handleJoinRoom()}>
          Join Room
        </button>
      </div>

      <h3 className="text-2xl mt-12">
        Your are joining room
        <p
          className={` ${
            roomName ? "text-red-400 inline p-2 bg-black" : "inline p-2"
          }`}
        >
          {roomName ? `"${roomName}"` : "..."}
        </p>
      </h3>
    </div>
  );
};
