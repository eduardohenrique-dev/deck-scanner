import { usePath } from "./lib/router";
import Home from "./pages/Home";
import SessionPage from "./pages/SessionPage";

export default function App() {
  const path = usePath();
  const match = path.match(/^\/s\/([a-f0-9]+)/);
  if (match) return <SessionPage key={match[1]} id={match[1]} />;
  return <Home />;
}
