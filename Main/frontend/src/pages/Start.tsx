import { Link } from "react-router-dom";

export default function Start() {
  return (
    <div className="w-200 ">
      <div className="w-full flex gap-10">
        <Link to={"/create-space"}>
          <button>Create Your space</button>
        </Link>
        <Link to={"/join-space"}>
          <button>Join space</button>
        </Link>
      </div>
    </div>
  );
}
