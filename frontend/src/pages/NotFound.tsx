import { D20 } from "../components/icons";
import { Board, Button, EmptyState } from "../components/ui";
import { navigate } from "../lib/router";

export default function NotFound() {
  return (
    <Board className="mx-auto max-w-xl">
      <EmptyState art={<D20 size={44} />} title="Rolou um 1 natural" action={<Button variant="primary" onClick={() => navigate("/")}>Voltar para a taverna</Button>}>
        Essa página não existe (ou foi apagada). Nada de errado com as suas cartas.
      </EmptyState>
    </Board>
  );
}
